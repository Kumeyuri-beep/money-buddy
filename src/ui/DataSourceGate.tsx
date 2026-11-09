import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { chooseDataSource, readMigrationFlag } from '../app/dataSource';
import { db } from '../storage/instance';
import { getLocalOwner, hasLocalData } from '../storage/localOwner';
import { StorageError } from '../storage/repository';
import { supabase } from '../storage/supabase';
import { createSupabaseRepository } from '../storage/supabaseRepository';
import { useAccount } from './AuthContext';
import { RESET_CANCELLED_MESSAGE } from '../app/migrate';
import { MigrationWizard } from './MigrationWizard';
import { UnfinishedImportPage } from './UnfinishedImportPage';
import { usePasswordPrompt } from './PasswordPrompt';
import { RepositoryProvider, setActiveLedgerRepository } from './RepositoryContext';

type State = 'checking' | 'online' | 'migrate' | 'verify' | 'unfinished' | 'error';

/**
 * ด่านเลือกแหล่งข้อมูลหลังล็อกอิน (M2-D2 แทน LocalDataGate)
 * - ออนไลน์มีข้อมูลแล้ว -> ใช้บัญชีออนไลน์ (ข้อมูลเดิมในเครื่องไม่ถูกแตะ)
 * - ออนไลน์ว่าง + มีข้อมูลเดิมของบัญชีนี้ในเครื่อง -> หน้าย้ายข้อมูล
 * - นำเข้าแล้วแต่ยังไม่ยืนยันยอด -> หน้าตรวจยอดต่อ
 * - ข้อมูลเดิมในเครื่องของบัญชีอื่นไม่ถูกเสนอให้ผู้ใช้นี้ (ตั้งต้นออนไลน์ใหม่) · ไม่มีโค้ดส่วนไหนลบข้อมูลในเครื่อง
 */
export function DataSourceGate({ userId, children }: { userId: string; children: ReactNode }) {
  const { username, signOut } = useAccount();
  const requestPassword = usePasswordPrompt();
  const [state, setState] = useState<State>('checking');
  const [attempt, setAttempt] = useState(0);

  const online = useMemo(
    () =>
      supabase
        ? createSupabaseRepository(supabase, userId, {
            getPasswordForReset: async () => {
              const password = await requestPassword('ล้างข้อมูลออนไลน์ทั้งหมดของบัญชีนี้ ต้องยืนยันด้วยรหัสผ่านของคุณ การกระทำนี้ย้อนกลับไม่ได้ (ข้อมูลเดิมที่เก็บในเบราว์เซอร์ไม่ถูกลบ)', 'ล้างข้อมูลออนไลน์');
              if (password === null) throw new StorageError(RESET_CANCELLED_MESSAGE);
              return password;
            },
          })
        : null,
    [userId, requestPassword],
  );

  useEffect(() => {
    if (!online) {
      setState('error');
      return;
    }
    let cancelled = false;
    setState('checking');
    void (async () => {
      try {
        // นำเข้าแบบแบ่งก้อนที่ค้างอยู่ (ปิดแท็บ/เน็ตหลุดกลางทาง) ต้องมาก่อนทุกอย่าง: ห้ามปล่อยเข้าแอปด้วยข้อมูลครึ่งเดียว
        // ถามไม่ได้ (เช่นฐานข้อมูลยังไม่มีฟังก์ชันนี้ระหว่างอัปเดต) = ถือว่าไม่ค้าง ไม่ล็อกทุกคนออกจากแอป · ถ้าเครือข่ายล่มจริง isEmpty ด้านล่างจะล้มเอง
        const unfinished = await online.hasUnfinishedImport().catch(() => false);
        if (unfinished) {
          if (!cancelled) setState('unfinished');
          return;
        }
        const [onlineEmpty, localData, localOwner] = await Promise.all([online.isEmpty(), hasLocalData(db), getLocalOwner(db)]);
        if (cancelled) return;
        const flag = readMigrationFlag(window.localStorage, userId);
        setState(chooseDataSource({ userId, onlineEmpty, localHasData: localData, localOwner, flag }));
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, userId, attempt]);

  // ให้โค้ดนอก React (ErrorBoundary) สำรองข้อมูลจากแหล่งเดียวกับที่ผู้ใช้เห็น · ไม่ล้างตอน unmount (แอปล้มแล้ว subtree ถูกถอด ปุ่มสำรองยังต้องใช้ได้)
  // ล้างตอนออกจากระบบที่ AuthGate แทน
  useEffect(() => {
    if (state === 'online' && online) setActiveLedgerRepository(online);
  }, [state, online]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);

  switch (state) {
    case 'checking':
      return (
        <main className="auth-page">
          <p className="muted" role="status">
            กำลังเปิดข้อมูลของคุณ...
          </p>
        </main>
      );
    case 'online':
      return online ? <RepositoryProvider repository={online}>{children}</RepositoryProvider> : null;
    case 'migrate':
    case 'verify':
      return online ? <MigrationWizard key={state} userId={userId} online={online} mode={state} onDone={recheck} /> : null;
    case 'unfinished':
      return online ? <UnfinishedImportPage online={online} onCleared={recheck} /> : null;
    case 'error':
      return (
        <main className="auth-page">
          <section className="solid card auth-card">
            <h1>เปิดข้อมูลไม่สำเร็จ</h1>
            <p role="alert">กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่ ข้อมูลของคุณไม่ได้รับผลกระทบ</p>
            <div className="actions">
              <button className="btn btn-primary" onClick={recheck}>
                ลองอีกครั้ง
              </button>
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                ออกจากระบบ
              </button>
            </div>
          </section>
        </main>
      );
  }
}
