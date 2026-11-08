import { forwardRef, useState, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: string;
  /** ข้อความช่วยใต้ช่อง (เชื่อมด้วย aria-describedby) */
  hint?: string;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

/** ช่องรหัสผ่านพร้อมปุ่มแสดง/ซ่อนเป็นไอคอนอยู่ในช่อง (รหัสยาว 10+ ตัวพิมพ์ผิดง่าย) */
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField({ id, label, hint, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-row">
        <input id={id} ref={ref} type={shown ? 'text' : 'password'} aria-describedby={hintId} {...rest} />
        <button
          type="button"
          className="password-toggle"
          aria-label={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          title={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          onClick={() => setShown((v) => !v)}
        >
          <EyeIcon off={shown} />
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="muted small">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
