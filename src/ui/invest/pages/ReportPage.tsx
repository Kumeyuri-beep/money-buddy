import { ComingSoonPage } from '../ComingSoonPage';

/** analytics/report · (invest-v2 wave2: worker แทนที่ไฟล์นี้) · ตอนนี้ยังเป็น Coming soon */
export function ReportPage({ onHome }: { onHome: () => void }) {
  return <ComingSoonPage page="analytics/report" onHome={onHome} />;
}
