/**
 * โคมไฟทองแบบกระจก (Aurora Glass) บนหน้าล็อกอิน · ปุ่มเปิด/ปิดไฟ (กด/แตะ/Enter/Space)
 * วาดด้วย SVG + CSS ล้วน ไม่มีไลบรารี · อนิเมชันใช้เฉพาะ transform/opacity · หยุดเมื่อผู้ใช้ตั้งลดการเคลื่อนไหว (ดู styles.css)
 * ตกแต่งอย่างเดียว: ฟอร์มล็อกอินมองเห็นและใช้งานได้เสมอไม่ว่าไฟเปิดหรือปิด
 */
export function LoginLamp({ lit, onToggle }: { lit: boolean; onToggle: () => void }) {
  return (
    <div className="login-lamp-wrap">
      <button type="button" className="login-lamp" aria-pressed={lit} aria-label="ไฟบนหน้านี้" onClick={onToggle}>
        <svg viewBox="0 0 120 160" width="100%" height="100%" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="lamp-shade" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--lamp-shade-a)' }} />
              <stop offset="1" style={{ stopColor: 'var(--lamp-shade-b)' }} />
            </linearGradient>
            <linearGradient id="lamp-cone-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--lamp-cone)' }} />
              <stop offset="1" style={{ stopColor: 'var(--lamp-cone)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <rect x="48" y="-6" width="24" height="5" rx="2.5" className="lamp-rim" />
          <g className="lamp-swing">
            <line x1="60" y1="-2" x2="60" y2="30" className="lamp-cord" />
            <polygon className="lamp-cone" fill="url(#lamp-cone-fade)" points="26,100 94,100 120,160 0,160" />
            <rect x="54" y="28" width="12" height="9" rx="2.5" className="lamp-rim" />
            <path d="M30 98 L43 40 Q60 33 77 40 L90 98 Z" fill="url(#lamp-shade)" />
            <path d="M40 90 L48 52" className="lamp-shine" />
            <rect x="26" y="96" width="68" height="9" rx="4.5" className="lamp-rim" />
            <circle cx="60" cy="113" r="9" className="lamp-bulb" />
            <line x1="100" y1="98" x2="100" y2="126" className="lamp-cord" />
            <circle cx="100" cy="130" r="5" className="lamp-pull" />
          </g>
        </svg>
      </button>
      <span className="login-lamp-hint" aria-hidden="true">
        แตะโคมเพื่อเปิด/ปิดไฟ
      </span>
    </div>
  );
}
