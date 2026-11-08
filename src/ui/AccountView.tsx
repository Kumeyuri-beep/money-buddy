import { useEffect, useState } from 'react';
import { cooldownState, deleteMyAccount, formatRemaining } from '../app/account';
import { accountApi, loadPasswordChangedAt, supabase } from '../storage/supabase';
import { useAccount } from './AuthContext';
import { downloadBackup } from './backup';
import { ChangePasswordForm } from './ChangePasswordForm';
import { usePasswordPrompt } from './PasswordPrompt';
import { PolicyText } from './PolicyText';
import { useRepository } from './RepositoryContext';

/** หน้าโปรไฟล์: ชื่อผู้ใช้ เปลี่ยนรหัสผ่าน ออกจากระบบ (หัวหน้าหลักของแอปเป็น h1 แล้ว หน้านี้ใช้ h2) */
export function AccountView() {
  const { username, signOut } = useAccount();
  const repo = useRepository();
  const requestPassword = usePasswordPrompt();
  const [exportNote, setExportNote] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteNote, setDeleteNote] = useState('');
  // cooldown 24 ชม. หลังเปลี่ยนรหัสผ่าน (ฐานข้อมูลบังคับ · ที่นี่บอกเวลาที่เหลือและปิดปุ่มล่วงหน้า)
  const [changedAt, setChangedAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let cancelled = false;
    if (supabase) void loadPasswordChangedAt(supabase).then((v) => !cancelled && setChangedAt(v));
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const cooling = cooldownState(changedAt, now);
  const doExport = async () => {
    setExportNote('');
    try {
      await downloadBackup(repo);
      setExportNote('ดาวน์โหลดแล้ว เก็บไฟล์นี้ไว้ในที่ปลอดภัย (มีข้อมูลการเงินของคุณทั้งหมด)');
    } catch {
      setExportNote('ดาวน์โหลดไม่สำเร็จ ลองอีกครั้ง');
    }
  };

  const doDelete = async () => {
    if (!ack || busy || !accountApi || cooling) return;
    setDeleteNote('');
    const password = await requestPassword('ลบบัญชี ' + username + ' และข้อมูลการเงินออนไลน์ทั้งหมดถาวร ย้อนกลับไม่ได้ ควรดาวน์โหลดข้อมูลของคุณไว้ก่อน', 'ลบบัญชีถาวร');
    if (password === null) {
      setDeleteNote('ยกเลิกแล้ว ไม่ได้ลบอะไร');
      return;
    }
    setBusy(true);
    const result = await deleteMyAccount(accountApi, password);
    setBusy(false);
    if (!result.ok) {
      setDeleteNote(result.message);
      return;
    }
    try {
      window.sessionStorage.setItem('mb.accountDeleted', '1');
    } catch {
      /* แจ้งผลไม่ได้ก็ไม่เป็นไร บัญชีถูกลบแล้ว */
    }
    await signOut();
  };

  return (
    <>
      <section className="solid card" aria-labelledby="account-title">
        <h2 id="account-title" className="page-title">
          โปรไฟล์
        </h2>
        <p>
          ชื่อผู้ใช้: <strong>{username}</strong>
        </p>
        <p className="muted small">
          ข้อมูลการเงินของคุณเก็บในบัญชีออนไลน์ของคุณ แยกจากผู้ใช้คนอื่น (ผู้ดูแลระบบอ่านได้ทางเทคนิค ดูนโยบายด้านล่าง) ข้อมูลเดิมที่เคยเก็บในเบราว์เซอร์นี้ (ถ้ามี) ยังอยู่และไม่ถูกลบ ควรสำรองข้อมูลเป็นประจำ
        </p>
        <button className="btn btn-ghost" onClick={() => void signOut()}>
          ออกจากระบบ
        </button>
      </section>
      <section className="solid card" aria-labelledby="change-pw-title">
        <h2 id="change-pw-title">เปลี่ยนรหัสผ่าน</h2>
        <ChangePasswordForm username={username} onDone={() => undefined} />
      </section>
      <section className="solid card account-privacy" aria-labelledby="privacy-title">
        <h2 id="privacy-title">ข้อมูลและความเป็นส่วนตัว</h2>
        <p>ข้อมูลของคุณเป็นของคุณ ดาวน์โหลดได้ตลอด และลบบัญชีพร้อมข้อมูลทั้งหมดได้เอง</p>
        <div className="actions">
          <button className="btn btn-primary" type="button" onClick={() => void doExport()}>
            ดาวน์โหลดข้อมูลของฉัน
          </button>
        </div>
        <div role="status" className="auth-ok">
          {exportNote}
        </div>
        <details className="policy-details">
          <summary>อ่านนโยบายความเป็นส่วนตัว</summary>
          <PolicyText />
        </details>
      </section>
      <section className="solid card account-danger" aria-labelledby="delete-title">
        <h2 id="delete-title">⚠ ลบบัญชีและข้อมูลทั้งหมด</h2>
        <p>
          ลบบัญชี <strong>{username}</strong> ถาวร <strong>ย้อนกลับไม่ได้</strong> ต้องยืนยันด้วยรหัสผ่าน ควรดาวน์โหลดข้อมูลของคุณไว้ก่อน
        </p>
        <ul className="migrate-list">
          <li>ถูกลบ: บัญชีผู้ใช้ และข้อมูลการเงินออนไลน์ทั้งหมด (กระเป๋า รายการ บิล ค่าตั้งค่า)</li>
          <li>ไม่ถูกลบ: ข้อมูลเก่าที่เก็บในเบราว์เซอร์นี้ (ถ้ามี) และไฟล์ที่คุณดาวน์โหลดไว้</li>
          <li>ลบไม่ได้ภายใน 24 ชั่วโมงหลังเปลี่ยนรหัสผ่าน (กันผู้อื่นที่ได้ session ไปเปลี่ยนรหัสแล้วลบข้อมูล)</li>
        </ul>
        {cooling && (
          <p id="delete-cooldown" className="slip-warn" role="status">
            เพิ่งเปลี่ยนรหัสผ่าน จึงยังลบบัญชีไม่ได้ ลบได้อีก {formatRemaining(cooling.remainingMs)} (หลังเวลา{' '}
            {cooling.until.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })})
          </p>
        )}
        {!ack && !cooling && (
          <p id="delete-reason" className="muted small">
            ติ๊กช่อง "ฉันเข้าใจว่าลบแล้วกู้คืนไม่ได้" ก่อน ปุ่มลบจึงจะกดได้
          </p>
        )}
        <label className="migrate-check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>ฉันเข้าใจว่าลบแล้วกู้คืนไม่ได้</span>
        </label>
        <div className="actions">
          <button className="btn btn-danger" type="button" disabled={!ack || busy || cooling !== null} onClick={() => void doDelete()} aria-describedby={cooling ? 'delete-cooldown' : ack ? undefined : 'delete-reason'}>
            {busy ? 'กำลังลบ...' : 'ลบบัญชีและข้อมูลทั้งหมด'}
          </button>
        </div>
        {deleteNote && (
          <div role={deleteNote.startsWith('ยกเลิก') ? 'status' : 'alert'} className="auth-error">
            {deleteNote}
          </div>
        )}
      </section>
    </>
  );
}
