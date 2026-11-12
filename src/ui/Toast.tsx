interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** ข้อความผิดพลาดใช้ role=alert (อ่านทันที) ข้อความทั่วไปใช้ role=status */
  tone?: 'error';
  /** หยุด/เดินนับเวลาปิดอัตโนมัติ: true เมื่อเมาส์อยู่บนแถบหรือโฟกัสอยู่ในแถบ (WCAG 2.2.1) */
  onHold?: (held: boolean) => void;
}

/** แถบแจ้งผลด้านล่างจอ (โปรแกรมอ่านหน้าจอจะอ่านให้ฟังเพราะเป็น role="status") */
export function Toast({ message, actionLabel, onAction, onDismiss, tone, onHold }: ToastProps) {
  return (
    <div className="toast" role={tone === 'error' ? 'alert' : 'status'} onMouseEnter={() => onHold?.(true)} onMouseLeave={() => onHold?.(false)} onFocus={() => onHold?.(true)} onBlur={() => onHold?.(false)}>
      <span>{message}</span>
      <div className="toast-actions">
        {actionLabel && onAction && (
          <button className="btn btn-ghost toast-btn" onClick={onAction}>
            {actionLabel}
          </button>
        )}
        <button className="btn btn-ghost toast-btn" aria-label="ปิดข้อความ" onClick={onDismiss}>
          ปิด
        </button>
      </div>
    </div>
  );
}
