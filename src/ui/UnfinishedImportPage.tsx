import { useEffect, useRef, useState } from 'react';
import { StorageError } from '../storage/repository';
import type { LedgerRepository } from '../storage/ledgerRepository';
import { useAccount } from './AuthContext';

/**
 * การนำเข้าไฟล์ใหญ่ (แบ่งก้อน) ค้างอยู่ยังไม่ครบ (เช่นปิดแท็บหรือเน็ตหลุดกลางทาง) · แอปไม่ให้ใช้งานด้วยข้อมูลที่นำเข้าได้ครึ่งเดียว
 * ปุ่มล้างใช้ได้เฉพาะขณะมีการนำเข้าค้าง (ฐานข้อมูลตรวจเอง ไม่ถามรหัสผ่าน) ไฟล์สำรองในเครื่องของคุณไม่ถูกแตะ
 */
export function UnfinishedImportPage({ online, onCleared }: { online: LedgerRepository; onCleared: () => void }) {
  const { signOut } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await online.abortUnfinishedImport();
      onCleared();
    } catch (e) {
      setError(e instanceof StorageError ? e.message : 'ล้างไม่สำเร็จ ลองอีกครั้ง');
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="solid card auth-card" aria-labelledby="unfinished-title">
        <h1 id="unfinished-title" ref={headingRef} tabIndex={-1}>
          การนำเข้าครั้งก่อนยังไม่เสร็จ
        </h1>
        <p>การนำเข้าไฟล์สำรองครั้งก่อนหยุดกลางทาง จึงมีข้อมูลเข้ามาแค่บางส่วน เพื่อกันตัวเลขผิด จึงยังเปิดใช้งานไม่ได้จนกว่าจะนำเข้าครบ</p>
        <p id="unfinished-warn" className="slip-warn">
          ปุ่มด้านล่างจะลบข้อมูลที่นำเข้าค้างไว้ในบัญชีนี้ <strong>ทั้งหมด</strong> (ไม่กระทบไฟล์สำรองในเครื่องของคุณ) หลังล้างให้เลือกไฟล์สำรองมานำเข้าใหม่ทั้งไฟล์
        </p>
        <div className="actions">
          <button className="btn btn-danger" type="button" onClick={() => void clear()} aria-disabled={busy} aria-describedby="unfinished-warn">
            {busy ? 'กำลังล้าง...' : 'ล้างส่วนที่นำเข้าค้าง'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
            ออกจากระบบ
          </button>
        </div>
        <p className="muted small">ถ้าออกจากระบบตอนนี้ ข้อมูลที่ค้างยังอยู่ ต้องกลับมาล้างก่อนจึงจะใช้งานได้</p>
        {error && (
          <p role="alert" className="auth-error">
            {error} ข้อมูลเดิมยังอยู่ ลองอีกครั้งได้
          </p>
        )}
        <p role="status" className="sr-only">
          {busy ? 'กำลังล้าง' : ''}
        </p>
      </section>
    </main>
  );
}
