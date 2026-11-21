import type { Account, Entry } from '../domain/ledger/types';
import { PortfolioTransfer } from './PortfolioTransfer';
import { PortfolioView } from './PortfolioView';
import { UsOverview } from './UsOverview';
import { UsStocksView } from './UsStocksView';

interface Props {
  /** ส่วนที่แสดง: 'us' = หุ้นสหรัฐ (เมนู Portfolio → Holdings) · 'overview' = กองทุน/หุ้นบาท + โอนเข้า-ออกพอร์ต (Portfolio → Transactions) */
  section: 'overview' | 'us';
  today: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** กระเป๋าเงินสดบาทที่เลือกจ่าย/รับเงินได้ (ป้ายเงินใช้จ่าย) */
  wallets: readonly { id: string; name: string }[];
  onLedgerChanged: () => void;
}

/**
 * หน้า "พอร์ตการลงทุน": ตัดแท็บย่อยเดิมออก (เมนูบนของโหมด /invest เลือกส่วนที่แสดงแทน และแต่ละส่วนมี URL ของตัวเอง) · ฟังก์ชันภายในไม่เปลี่ยน
 */
export default function PortfolioPage({ today, accounts, entries, wallets, onLedgerChanged, section }: Props) {
  return (
    <div className="pf-page">
      {section === 'overview' ? (
        <div role="region" aria-label="Portfolio overview" id="pf-panel-overview">
          <PortfolioView today={today} wallets={wallets} onLedgerChanged={onLedgerChanged} />
          <UsOverview today={today} accounts={accounts} entries={entries} />
          <PortfolioTransfer today={today} accounts={accounts} wallets={wallets} onLedgerChanged={onLedgerChanged} />
        </div>
      ) : (
        <div role="region" aria-label="US stocks" id="pf-panel-us">
          <UsStocksView today={today} accounts={accounts} entries={entries} wallets={wallets} onLedgerChanged={onLedgerChanged} />
        </div>
      )}
    </div>
  );
}
