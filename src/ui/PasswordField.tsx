import { forwardRef, useState, type InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: string;
  /** ข้อความช่วยใต้ช่อง (เชื่อมด้วย aria-describedby) */
  hint?: string;
}

/** ช่องรหัสผ่านพร้อมปุ่มแสดง/ซ่อน (รหัสยาว 10+ ตัวพิมพ์ผิดง่าย) */
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField({ id, label, hint, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-row">
        <input id={id} ref={ref} type={shown ? 'text' : 'password'} aria-describedby={hintId} {...rest} />
        <button type="button" className="btn btn-ghost" aria-pressed={shown} onClick={() => setShown((v) => !v)}>
          {shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
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
