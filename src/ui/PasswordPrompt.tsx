import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PasswordField } from './PasswordField';

type Request = { message: string; confirmLabel: string; resolve: (password: string | null) => void };
type Prompt = (message: string, confirmLabel?: string) => Promise<string | null>;

const PromptContext = createContext<Prompt | null>(null);

/** ขอรหัสผ่านจากผู้ใช้ด้วย dialog (ใช้ยืนยันการล้างข้อมูลออนไลน์) · คืน null ถ้ากดยกเลิก · รหัสไม่ถูกเก็บที่ใดนอกจากส่งต่อให้ผู้เรียก */
export function PasswordPromptProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);

  const prompt = useCallback<Prompt>((message, confirmLabel = 'ยืนยัน') => {
    // คำขอซ้อน: ปฏิเสธคำขอเก่าเป็นยกเลิก
    pending.current?.resolve(null);
    return new Promise<string | null>((resolve) => {
      const next = { message, confirmLabel, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);

  const finish = useCallback((value: string | null) => {
    const current = pending.current;
    pending.current = null;
    setRequest(null);
    current?.resolve(value);
  }, []);

  const value = useMemo(() => prompt, [prompt]);
  return (
    <PromptContext.Provider value={value}>
      {children}
      {request ? <PasswordDialog message={request.message} confirmLabel={request.confirmLabel} onDone={finish} /> : null}
    </PromptContext.Provider>
  );
}

export function usePasswordPrompt(): Prompt {
  const value = useContext(PromptContext);
  if (!value) throw new Error('usePasswordPrompt ต้องอยู่ภายใต้ PasswordPromptProvider');
  return value;
}

function PasswordDialog({ message, confirmLabel, onDone }: { message: string; confirmLabel: string; onDone: (value: string | null) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password === '') {
      inputRef.current?.focus();
      return;
    }
    const value = password;
    setPassword('');
    onDone(value);
  };

  return (
    <dialog ref={dialogRef} className="entry-dialog" aria-labelledby="pw-prompt-title" onCancel={() => onDone(null)} onClose={() => onDone(null)}>
      <form className="entry-form" onSubmit={submit}>
        <h2 id="pw-prompt-title">ยืนยันด้วยรหัสผ่าน</h2>
        <p>{message}</p>
        <PasswordField
          id="pw-prompt"
          label="รหัสผ่านของคุณ"
          ref={inputRef}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onDone(null)}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-danger">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
