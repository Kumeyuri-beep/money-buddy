import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { chooseDataSource, readMigrationFlag } from '../app/dataSource';
import { localDataAccess } from '../app/localOwner';
import { db } from '../storage/instance';
import { getLocalOwner, hasLocalData, setLocalOwner } from '../storage/localOwner';
import { StorageError } from '../storage/repository';
import { supabase } from '../storage/supabase';
import { createSupabaseRepository } from '../storage/supabaseRepository';
import { useAccount } from './AuthContext';
import { RESET_CANCELLED_MESSAGE } from '../app/migrate';
import { MigrationWizard } from './MigrationWizard';
import { usePasswordPrompt } from './PasswordPrompt';
import { RepositoryProvider, setActiveLedgerRepository } from './RepositoryContext';

type State = 'checking' | 'online' | 'migrate' | 'verify' | 'ask-bind' | 'error';

/**
 * ด่านเลือกแหล่งข้อมูลหลังล็อกอิน (M2-D2 แทน LocalDataGate)
 * - ออนไลน์มีข้อมูลแล้ว -> ใช้บัญชีออนไลน์ (ข้อมูลเดิมในเครื่องไม่ถูกแตะ)
 * - ออนไลน์ว่าง + มีข้อมูลเดิมของบัญชีนี้ในเครื่อง -> หน้าย้ายข้อมูล · ยังไม่มีเจ้าของ -> ถามก่อนผูก
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

  const bind = async () => {
    try {
      // ผูกเฉพาะเมื่อยังไม่มีเจ้าของจริงๆ (กันแท็บอื่นผูกไปก่อนแล้วเราทับ)
      const decision = localDataAccess({ ownerId: await getLocalOwner(db), userId, hasData: await hasLocalData(db) });
      if (decision === 'ask' || decision === 'bind') await setLocalOwner(db, userId);
      recheck();
    } catch {
      setState('error');
    }
  };

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
    case 'ask-bind':
      return (
        <main className="auth-page">
          <section className="solid card auth-card" aria-labelledby="bind-title">
            <h1 id="bind-title">ข้อมูลในเครื่องนี้เป็นของคุณหรือไม่?</h1>
            <p>
              เบราว์เซอร์นี้มีข้อมูลการเงินที่บันทึกไว้เดิม ถ้าเป็นข้อมูลของคุณ กดยืนยันเพื่อย้ายขึ้นบัญชีออนไลน์ของ <strong>{username}</strong>
            </p>
            <p className="muted">ข้อมูลเดิมจะไม่ถูกลบหรือแก้ไข หลังยืนยันแล้วบัญชีอื่นที่ล็อกอินบนเบราว์เซอร์นี้จะไม่ถูกเสนอให้ย้ายข้อมูลชุดนี้</p>
            <div className="actions">
              <button className="btn btn-primary" onClick={() => void bind()}>
                ยืนยันว่าข้อมูลนี้เป็นของฉัน ({username})
              </button>
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                ไม่ใช่ของฉัน ออกจากระบบ
              </button>
            </div>
          </section>
        </main>
      );
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
