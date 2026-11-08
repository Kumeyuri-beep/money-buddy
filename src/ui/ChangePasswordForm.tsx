import { useRef, useState, type FormEvent } from 'react';
import { changePassword } from '../app/auth';
import { MIN_PASSWORD_LENGTH, PASSWORD_RULES_TEXT } from '../domain/auth/credentials';
import { authApi } from '../storage/supabase';
import { PasswordField } from './PasswordField';

interface Props {
  username: string;
  /** เรียกเมื่อเปลี่ยนรหัสสำเร็จ */
  onDone: () => void | Promise<void>;
}

/** ฟอร์มเปลี่ยนรหัสผ่าน: ใช้ทั้งหน้าบังคับเปลี่ยนครั้งแรกและหน้าโปรไฟล์ */
export function ChangePasswordForm({ username, onDone }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setDone(false);
    if (!authApi) {
      setError('ยังไม่ได้ตั้งค่าการเชื่อมต่อเซิร์ฟเวอร์');
      return;
    }
    if (next !== confirm) {
      setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      confirmRef.current?.focus();
      return;
    }
    setBusy(true);
    const result = await changePassword(authApi, { username, current, next });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      currentRef.current?.focus();
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setDone(true);
    await onDone();
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
      {/* ให้โปรแกรมจัดการรหัสผ่านรู้ว่าเปลี่ยนรหัสของบัญชีไหน */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      <PasswordField
        id="pw-current"
        label="รหัสผ่านปัจจุบัน"
        ref={currentRef}
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
      <PasswordField
        id="pw-new"
        label="รหัสผ่านใหม่"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        required
        minLength={MIN_PASSWORD_LENGTH}
        hint={`${PASSWORD_RULES_TEXT} (เช่น ประโยคสั้นๆ ที่ผสมตัวพิมพ์ใหญ่และตัวเลข)`}
      />
      <PasswordField
        id="pw-confirm"
        label="พิมพ์รหัสผ่านใหม่อีกครั้ง"
        ref={confirmRef}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      <div role="alert" className="auth-error">
        {error ? `⚠ ${error}` : ''}
      </div>
      <div role="status" className="auth-ok">
        {done ? '✓ เปลี่ยนรหัสผ่านแล้ว เครื่องอื่นที่เข้าสู่ระบบอยู่ถูกออกจากระบบแล้ว' : ''}
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'กำลังเปลี่ยนรหัสผ่าน...' : 'เปลี่ยนรหัสผ่าน'}
      </button>
    </form>
  );
}
