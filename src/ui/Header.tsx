import { greetingFor, thaiHeaderDate } from '../app/greeting';
import type { Entry } from '../domain/ledger/types';
import type { Ledger } from '../storage/repository';
import { QuickAdd } from './QuickAdd';

interface HeaderProps {
  ledger: Ledger;
  onAdd: () => void;
  onQuickSaved: (entry: Entry) => void;
}

/** หัวหน้า: ทักทายตามเวลา + วันที่ + ช่องพิมพ์จดด่วน + ปุ่มเพิ่มรายการ (ปุ่มสแกนสลิปรอ M1-B4) */
export function Header({ ledger, onAdd, onQuickSaved }: HeaderProps) {
  const now = new Date();
  return (
    <header className="glass-lite topbar">
      <div className="topbar-title">
        <h1>{greetingFor(now)}</h1>
        <p className="muted">{thaiHeaderDate(now)}</p>
      </div>
      <div className="topbar-actions">
        <QuickAdd ledger={ledger} onSaved={onQuickSaved} />
        <button className="btn btn-primary btn-add" onClick={onAdd}>
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          เพิ่มรายการ
        </button>
      </div>
    </header>
  );
}
