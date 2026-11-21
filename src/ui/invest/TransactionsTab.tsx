import PortfolioPage from '../PortfolioPage';
import { useInvest } from './InvestContext';

/**
 * หน้า Portfolio → Holdings (section 'us': หุ้นสหรัฐ ฟอร์มซื้อขาย/ปันผล/แลกเงิน/ราคา) และ Portfolio → Transactions (section 'overview': กองทุน/หุ้นบาท + โอนเข้า-ออกพอร์ต)
 * ฟังก์ชันเดิมของ A3-2 ครบทุกอย่าง ย้ายมาโดยไม่เปลี่ยนการทำงาน (ยังไม่แยกตารางซื้อขายออกจากฟอร์มของหุ้นสหรัฐ)
 */
export function TransactionsTab({ section }: { section: 'overview' | 'us' }) {
  const { today, accounts, entries, wallets, onLedgerChanged, reload } = useInvest();
  return (
    <div className="invest-tab invest-transactions">
      <PortfolioPage
        section={section}
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
