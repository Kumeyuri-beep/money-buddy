import { useRef, type ChangeEvent } from 'react';
import { greetingFor, thaiHeaderDate } from '../app/greeting';
import type { Entry } from '../domain/ledger/types';
import type { Ledger } from '../storage/repository';
import { QuickAdd } from './QuickAdd';
import { useThaiNow } from './useThaiClock';

interface HeaderProps {
  ledger: Ledger;
  onAdd: () => void;
  onQuickSaved: (entry: Entry) => void;
  /** เลือกรูปสลิปจากเครื่อง (วางด้วย Ctrl+V และลากมาวางจัดการที่ App) */
  onScan: (file: File) => void;
  /** กำลังอ่านสลิปอยู่ */
  scanning: boolean;
}

/** หัวหน้า: ทักทายตามเวลา + วันที่ + ช่องพิมพ์จดด่วน + ปุ่มสแกนสลิป + ปุ่มเพิ่มรายการ */
export function Header({ ledger, onAdd, onQuickSaved, onScan, scanning }: HeaderProps) {
  const now = useThaiNow();
  const fileRef = useRef<HTMLInputElement>(null);

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // เลือกไฟล์เดิมซ้ำได้
    if (file) onScan(file);
  };

  return (
    <header className="glass-lite topbar">
      <div className="topbar-title">
        <h1>{greetingFor(now)}</h1>
        <p className="muted">{thaiHeaderDate(now)}</p>
      </div>
      <div className="topbar-actions">
        <QuickAdd ledger={ledger} onSaved={onQuickSaved} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={picked}
        />
        <button
          type="button"
          className="btn btn-add btn-scan"
          aria-disabled={scanning}
          aria-describedby="scan-hint"
          onClick={() => {
            // ไม่ใช้ disabled: ปุ่มที่ปิดจะทำให้โฟกัสคีย์บอร์ดหาย
            if (!scanning) fileRef.current?.click();
          }}
        >
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          </svg>
          {scanning ? 'กำลังอ่านสลิป…' : 'สแกนสลิป'}
        </button>
        <span id="scan-hint" className="sr-only">
          เลือกรูปสลิปจากเครื่อง (บนคอมพิวเตอร์ยังวางรูปด้วย Ctrl+V หรือลากรูปมาวางบนหน้านี้ได้)
        </span>
        <button className="btn btn-primary btn-add btn-add-header" onClick={onAdd}>
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          เพิ่มรายการ
        </button>
      </div>
    </header>
  );
}
