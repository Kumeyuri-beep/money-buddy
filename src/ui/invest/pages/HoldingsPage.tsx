import { TransactionsTab } from '../TransactionsTab';

/** Portfolio → Holdings · (invest-v2 รอบ 1: worker "Holdings" แทนที่ไฟล์นี้) · ตอนนี้ใช้หน้าหุ้นสหรัฐเดิม */
export function HoldingsPage({ addSignal }: { addSignal: number }) {
  return <TransactionsTab key={addSignal} section="us" />;
}
