import { useEffect, useId, useRef, useState } from 'react';
import { thaiDayLabel } from '../app/dates';
import type { TradeKind, TradeRecord } from '../domain/invest/types';
import { formatUnits } from '../domain/invest/units';
import { formatMicro } from '../domain/money/micro';
import { formatBaht, satang } from '../domain/money/satang';
import { TermHelp } from './TermHelp';

export const KIND_LABEL = { buy: 'ซื้อ', sell: 'ขาย', dividend: 'ปันผลเป็นเงินสด', reinvest: 'ปันผลลงทุนต่อ' } as const satisfies Record<TradeKind, string>;
const baht = (n: number): string => formatBaht(satang(n));

/** รหัสองค์ประกอบปุ่มของรายการ (ใช้ย้ายโฟกัสหลังลบ) */
export const tradeButtonId = (tradeId: string): string => `trade-btn-${tradeId}`;

/**
 * รายการลงทุนหนึ่งรายการในประวัติของสินทรัพย์ (เจ้าของสั่ง 13 พ.ย. 2569: รายการย่อยกดขยายได้ อ่านง่ายบน 360px)
 * 14 พ.ย. 2569: เปลี่ยนจาก <details> ซ้อน <details> เป็นปุ่ม disclosure (aria-expanded + aria-controls) ให้โปรแกรมอ่านจอบอกชัดว่า "ปุ่ม ขยายอยู่/ย่ออยู่"
 * (ชั้นนอก "ประวัติรายการ" ยังเป็น <details> ชั้นเดียว) · ปิดอยู่: วันที่ · ชนิด · ค่าหลักบรรทัดเดียว · กดขยายเพื่อดูรายละเอียดและปุ่มลบ
 * แสดงผลอย่างเดียว ไม่มีสูตรเงิน (ค่าทั้งหมดมาจากรายการที่บันทึกไว้)
 */
export function TradeItem({ tr, confirmDelete, busy, onDelete }: { tr: TradeRecord; confirmDelete: boolean; busy: boolean; onDelete: () => void }) {
  const panelId = useId();
  const [openByUser, setOpenByUser] = useState(false);
  // รอการยืนยันลบ = เปิดไว้ให้เห็นปุ่ม "ยืนยันลบ" เสมอ (ไม่ซ่อนอยู่ในส่วนที่พับ)
  const open = openByUser || confirmDelete;
  // หมดเวลา/เปลี่ยนไปยืนยันรายการอื่น = ไม่พับกลับ (ผู้ใช้กำลังดูรายการนี้อยู่ โฟกัสไม่หลุดไปส่วนที่ซ่อน)
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirmDelete) setOpenByUser(true);
    wasConfirming.current = confirmDelete;
  }, [confirmDelete]);
  // ค่าหลักที่เห็นตอนพับ: ยอดเงินถ้ามี ไม่มี (เช่น ขาย) ใช้จำนวนหน่วย
  const headline = tr.amount !== undefined ? baht(tr.amount) : tr.units !== undefined ? `${formatUnits(BigInt(tr.units))} หน่วย` : '';
  const day = thaiDayLabel(tr.date);
  const kindHelp = tr.kind === 'dividend' || tr.kind === 'reinvest' ? KIND_LABEL[tr.kind] : null;
  return (
    <li className="trade-item">
      <button type="button" id={tradeButtonId(tr.id)} className="trade-summary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpenByUser((v) => !v)}>
        <span className="trade-when">{day}</span>{' '}
        <span className="trade-kind">{KIND_LABEL[tr.kind]}</span>{' '}
        {headline !== '' && <span className="trade-main num">{headline}</span>}
        {confirmDelete && <span className="sr-only"> รอการยืนยันลบ</span>}
      </button>
      <div id={panelId} hidden={!open}>
        <dl className="trade-fields muted small">
          {tr.units !== undefined && (
            <div className="asset-fig">
              <dt>จำนวนหน่วย</dt>
              <dd className="num">{formatUnits(BigInt(tr.units))} หน่วย</dd>
            </div>
          )}
          {tr.priceMicro !== undefined && (
            <div className="asset-fig">
              <dt>ราคาต่อหน่วย</dt>
              <dd className="num">{formatMicro(tr.priceMicro)} บาท</dd>
            </div>
          )}
          {tr.amount !== undefined && (
            <div className="asset-fig">
              <dt>ยอดเงิน</dt>
              <dd className="num">{baht(tr.amount)}</dd>
            </div>
          )}
          {tr.fee > 0 && (
            <div className="asset-fig">
              <dt>ค่าธรรมเนียม</dt>
              <dd className="num">{baht(tr.fee)}</dd>
            </div>
          )}
          {tr.withholding > 0 && (
            <div className="asset-fig">
              <dt>ภาษีหัก ณ ที่จ่าย</dt>
              <dd className="num">{baht(tr.withholding)}</dd>
            </div>
          )}
          {tr.memo !== '' && (
            <div className="asset-fig asset-fig-note">
              <dt>บันทึก</dt>
              <dd>{tr.memo}</dd>
            </div>
          )}
        </dl>
        {(kindHelp !== null || tr.withholding > 0) && (
          <div className="trade-help">
            {kindHelp !== null && <TermHelp term={kindHelp} />}
            {tr.withholding > 0 && <TermHelp term="ภาษีหัก ณ ที่จ่าย" />}
          </div>
        )}
        <button
          type="button"
          className={confirmDelete ? 'btn btn-ghost btn-small confirm-delete trade-delete' : 'btn btn-ghost btn-small trade-delete'}
          disabled={busy}
          onClick={onDelete}
          aria-label={`${confirmDelete ? 'ยืนยันลบ' : 'ลบ'}รายการ ${KIND_LABEL[tr.kind]} ${day}`}
        >
          {confirmDelete ? 'ยืนยันลบ' : 'ลบ'}
        </button>
      </div>
    </li>
  );
}
