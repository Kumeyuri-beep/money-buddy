import type { SlipOcrPhase } from '../ocr/readSlip';

interface ScanStatusProps {
  /** 0..1 ของขั้นปัจจุบัน */
  progress: number;
  phase: SlipOcrPhase;
}

const PHASE_TEXT: Record<SlipOcrPhase, string> = {
  preparing: 'กำลังเตรียมรูป',
  loading: 'กำลังเตรียมตัวอ่าน… ครั้งแรกอาจช้า',
  reading: 'กำลังอ่านข้อความ',
};

/** แถบสถานะตอนกำลังอ่านสลิป: ข้อความคงที่ใน live region (ไม่อ่านซ้ำทุกเปอร์เซ็นต์) ส่วนเลข % ให้สายตาดูอย่างเดียว */
export function ScanStatus({ progress, phase }: ScanStatusProps) {
  const percent = Math.min(100, Math.max(0, Math.floor(progress * 100)));
  const determinate = phase === 'reading';
  return (
    <div className="toast scan-status">
      <span role="status" id="scan-status-text">
        กำลังอ่านสลิป
      </span>
      <span aria-hidden="true">
        {PHASE_TEXT[phase]}
        {determinate ? ` ${percent}%` : ''}
      </span>
      <progress max={100} value={determinate ? percent : undefined} aria-labelledby="scan-status-text" aria-hidden="true" />
    </div>
  );
}
