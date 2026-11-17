import { ComingSoonPage } from '../ComingSoonPage';

/** portfolio/goal · (invest-v2 wave2: worker แทนที่ไฟล์นี้) · ตอนนี้ยังเป็น Coming soon */
export function GoalPage({ onHome }: { onHome: () => void }) {
  return <ComingSoonPage page="portfolio/goal" onHome={onHome} />;
}
