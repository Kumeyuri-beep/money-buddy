interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

/** แถบแจ้งผลด้านล่างจอ (โปรแกรมอ่านหน้าจอจะอ่านให้ฟังเพราะเป็น role="status") */
export function Toast({ message, actionLabel, onAction, onDismiss }: ToastProps) {
  return (
    <div className="toast" role="status">
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
