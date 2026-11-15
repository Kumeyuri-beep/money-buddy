import { WealthPanel } from '../overview/WealthPanel';
import { UsOverview } from '../UsOverview';
import { useInvest } from './InvestContext';

/**
 * แท็บ "แดชบอร์ด" — โครงที่ GM วางไว้ให้ลูกน้อง 1 (ดูบรีฟ docs/plans/brief-invest-dashboard.md)
 * ระหว่างรอ: แสดงการ์ดเดิมของ A3-2 (ความมั่งคั่งรวม + สรุปหุ้นสหรัฐ) ที่ย้ายมาจากหน้าภาพรวม เพื่อไม่ให้ฟีเจอร์หาย
 * ลูกน้อง 1 แทนที่ทั้งแท็บนี้ด้วยแดชบอร์ดเต็ม (ไฟล์นี้และโฟลเดอร์ src/ui/invest/dashboard/ เป็นของลูกน้อง 1)
 */
export function DashboardTab() {
  const { today, accounts, entries } = useInvest();
  return (
    <div className="invest-tab invest-dashboard">
      <p className="muted small" role="note">
        แดชบอร์ดเต็มรูปแบบกำลังพัฒนา ตอนนี้แสดงสรุปเดิม
      </p>
      <WealthPanel accounts={accounts} entries={entries} today={today} />
      <UsOverview today={today} accounts={accounts} entries={entries} />
    </div>
  );
}
