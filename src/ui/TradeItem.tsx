import { thaiDayLabel } from '../app/dates';
import type { TradeKind, TradeRecord } from '../domain/invest/types';
import { formatUnits } from '../domain/invest/units';
import { formatMicro } from '../domain/money/micro';
import { formatBaht, satang } from '../domain/money/satang';

export const KIND_LABEL: Record<TradeKind, string> = { buy: 'ซื้อ', sell: 'ขาย', dividend: 'ปันผลเป็นเงินสด', reinvest: 'ปันผลลงทุนต่อ' };
const baht = (n: number): string => formatBaht(satang(n));

/**
 * รายการลงทุนหนึ่งรายการในประวัติของสินทรัพย์ (เจ้าของสั่ง 13 พ.ย. 2569: เปลี่ยนจากบรรทัดยาวคั่นด้วย "·" เป็นรายการย่อยที่กดขยายได้ อ่านง่ายบน 360px)
 * ปิดอยู่: วันที่ · ชนิด · ค่าหลักบรรทัดเดียว · กดขยายเพื่อดูรายละเอียดทีละบรรทัดและปุ่มลบ
 * แสดงผลอย่างเดียว ไม่มีสูตรเงิน (ค่าทั้งหมดมาจากรายการที่บันทึกไว้)
 */
export function TradeItem({ tr, confirmDelete, busy, onDelete }: { tr: TradeRecord; confirmDelete: boolean; busy: boolean; onDelete: () => void }) {
  // ค่าหลักที่เห็นตอนพับ: ยอดเงินถ้ามี ไม่มี (เช่น ขาย) ใช้จำนวนหน่วย
  const headline = tr.amount !== undefined ? baht(tr.amount) : tr.units !== undefined ? `${formatUnits(BigInt(tr.units))} หน่วย` : '';
  const day = thaiDayLabel(tr.date);
  return (
    <li className="trade-item">
      {/* รอการยืนยันลบ = เปิดไว้ให้เห็นปุ่ม "ยืนยันลบ" เสมอ (ไม่ซ่อนอยู่ในส่วนที่พับ) */}
      <details open={confirmDelete || undefined}>
        <summary>
          <span className="trade-when">{day}</span>{' '}
          <span className="trade-kind">{KIND_LABEL[tr.kind]}</span>{' '}
          {headline !== '' && <span className="trade-main num">{headline}</span>}
          {confirmDelete && <span className="sr-only" role="status"> รอการยืนยันลบ</span>}
        </summary>
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
        <button
          type="button"
          className={confirmDelete ? 'btn btn-ghost btn-small confirm-delete trade-delete' : 'btn btn-ghost btn-small trade-delete'}
          disabled={busy}
          onClick={onDelete}
          aria-label={`${confirmDelete ? 'ยืนยันลบ' : 'ลบ'}รายการ ${KIND_LABEL[tr.kind]} ${day}`}
        >
          {confirmDelete ? 'ยืนยันลบ' : 'ลบ'}
        </button>
      </details>
    </li>
  );
}
