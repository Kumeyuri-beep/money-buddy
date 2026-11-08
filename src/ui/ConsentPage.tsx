import { useEffect, useRef, useState } from 'react';
import { recordConsent } from '../app/account';
import { PRIVACY_SUMMARY } from '../domain/privacy/policy';
import { accountApi } from '../storage/supabase';
import { PolicyText } from './PolicyText';

interface Props {
  username: string;
  /** บันทึกการยอมรับสำเร็จแล้ว (ให้ด่านอ่านสถานะบัญชีใหม่) */
  onAccepted: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

/** หน้าขอความยินยอมก่อนใช้ข้อมูล (PDPA) · ไม่ยอมรับ = ออกจากระบบ · ฐานข้อมูลตั้งเวลาเอง และ RLS บล็อกข้อมูลจนกว่าจะเปลี่ยนรหัสผ่าน */
export function ConsentPage({ username, onAccepted, onSignOut }: Props) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const accept = async () => {
    if (!agree || busy || !accountApi) return;
    setBusy(true);
    setError('');
    const result = await recordConsent(accountApi);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    await onAccepted();
    setBusy(false);
  };

  return (
    <main className="auth-page">
      <section className="solid card auth-card migrate-card" aria-labelledby="consent-title">
        <h1 id="consent-title" ref={headingRef} tabIndex={-1} className="migrate-heading-h1">
          นโยบายความเป็นส่วนตัว
        </h1>
        <p className="muted">
          บัญชี <strong>{username}</strong> · โปรดอ่านก่อนเริ่มใช้งาน
        </p>
        <ul className="migrate-list">
          {PRIVACY_SUMMARY.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <details className="policy-details">
          <summary>อ่านนโยบายฉบับเต็ม</summary>
          <PolicyText headingLevel={2} />
        </details>
        <label className="migrate-check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>ฉันอ่านและยอมรับนโยบายความเป็นส่วนตัวนี้</span>
        </label>
        {!agree && (
          <p id="consent-reason" className="muted small">
            ติ๊กช่อง "ฉันอ่านและยอมรับ" ก่อน ปุ่ม "ยอมรับและเริ่มใช้งาน" จึงจะกดได้
          </p>
        )}
        <div className="actions">
          <button className="btn btn-primary" type="button" disabled={!agree || busy} onClick={() => void accept()} aria-describedby={agree ? undefined : 'consent-reason'}>
            {busy ? 'กำลังบันทึก...' : 'ยอมรับและเริ่มใช้งาน'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void onSignOut()}>
            ไม่ยอมรับ ออกจากระบบ
          </button>
        </div>
        {error && (
          <div role="alert" className="auth-error">
            ⚠ {error}
          </div>
        )}
      </section>
    </main>
  );
}
