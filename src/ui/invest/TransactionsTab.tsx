import PortfolioPage from '../PortfolioPage';
import { useInvest } from './InvestContext';

/**
 * แท็บ "รายการ": ฟังก์ชันเดิมของ A3-2 ครบทุกอย่าง (ซื้อ/ขาย/ปันผล แลกเงิน ราคา/อัตรา โอนเข้า-ออกพอร์ต กองทุนบาท) ย้ายมาไว้ที่นี่โดยไม่เปลี่ยนการทำงาน
 * ภายในมีแท็บย่อยเดิม "ภาพรวมพอร์ต" (กองทุน/หุ้นบาท + โอนเข้า-ออกพอร์ต) และ "หุ้นสหรัฐ"
 */
export function TransactionsTab({ startTab }: { startTab?: 'overview' | 'us' }) {
  const { today, accounts, entries, wallets, onLedgerChanged, reload } = useInvest();
  return (
    <div className="invest-tab invest-transactions">
      <PortfolioPage
        startTab={startTab}
        today={today}
        accounts={accounts}
        entries={entries}
        wallets={wallets}
        onLedgerChanged={() => {
          void reload();
          onLedgerChanged();
        }}
      />
    </div>
  );
}
