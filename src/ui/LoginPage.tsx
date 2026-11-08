import { useRef, useState, type FormEvent } from 'react';
import { signIn } from '../app/auth';
import { authApi } from '../storage/supabase';
import { PasswordField } from './PasswordField';

/** หน้าเข้าสู่ระบบ: ไม่มีปุ่มสมัคร/ลืมรหัสทางอีเมล (เจ้าของสร้างบัญชีและรีเซ็ตรหัสให้) */
export function LoginPage({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  // ลบบัญชีสำเร็จแล้วถูกพามาหน้านี้: แจ้งผลครั้งเดียว
  const [deletedNote] = useState(() => {
    try {
      const was = window.sessionStorage.getItem('mb.accountDeleted') === '1';
      if (was) window.sessionStorage.removeItem('mb.accountDeleted');
      return was;
    } catch {
      return false;
    }
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !authApi) return;
    setBusy(true);
    setError(null);
    const result = await signIn(authApi, username, password);
    if (!result.ok) {
      setBusy(false);
      setPassword('');
      setError(result.message);
      passwordRef.current?.focus(); // ให้ผู้ใช้คีย์บอร์ดพิมพ์ต่อได้ทันที
      return;
    }
    setPassword('');
    await onSignedIn();
    setBusy(false);
  };

  return (
    <main className="auth-page">
      <section className="solid card auth-card" aria-labelledby="login-title">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            MB
          </span>
          <div>
            <div className="brand-name">Money Buddy</div>
            <div className="muted brand-tagline">เกษียณเป็นเรื่องของคนวางแผน</div>
          </div>
        </div>
        <h1 id="login-title">เข้าสู่ระบบ</h1>
        {deletedNote && (
          <p role="status" className="auth-ok">
            ✓ ลบบัญชีและข้อมูลออนไลน์ทั้งหมดแล้ว
          </p>
        )}
        <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
          <div className="field">
            <label htmlFor="login-username">ชื่อผู้ใช้</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <PasswordField
            id="login-password"
            label="รหัสผ่าน"
            ref={passwordRef}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div role="alert" className="auth-error">
            {error ? `⚠ ${error}` : ''}
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
        <p className="muted small">
          ระบบนี้ยังไม่เปิดให้สมัครเอง หากต้องการบัญชีหรือลืมรหัสผ่าน โปรดแจ้งผู้ดูแลระบบที่ให้บัญชีคุณ
        </p>
      </section>
    </main>
  );
}
