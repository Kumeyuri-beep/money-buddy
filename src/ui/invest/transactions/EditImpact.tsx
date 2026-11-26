import { baht, signed } from '../../../app/bahtFormat';
import { usd, usdPrice, usdSigned } from '../../../app/usdFormat';
import type { EditSide } from '../../../domain/invest/editImpact';
import { formatUnits } from '../../../domain/invest/units';
import { formatMicro } from '../../../domain/money/micro';

/** ราคาต่อหน่วย micro-baht → "฿110.00" (แสดงผลล้วน · อย่างน้อย 2 ตำแหน่ง ตามแบบเดียวกับ usdPrice) */
function bahtPrice(micro: number): string {
  const [whole = '0', frac = ''] = formatMicro(micro).split('.');
  return `฿${Number(whole).toLocaleString('en-US')}.${frac.padEnd(2, '0')}`;
}

interface Row {
  key: string;
  label: string;
  before: string;
  after: string;
}

/** แถวของตาราง · ข้อความมาจากค่าที่ domain คำนวณแล้ว (previewTradeEdit) ไม่มีสูตรเงินในที่นี้ */
function rowsOf(before: EditSide, after: EditSide, currency: 'USD' | 'THB'): Row[] {
  const money = currency === 'USD' ? usd : baht;
  const profit = currency === 'USD' ? usdSigned : signed;
  const price = currency === 'USD' ? usdPrice : bahtPrice;
  const none = '—';
  const rows: Row[] = [
    { key: 'units', label: 'Shares held', before: formatUnits(before.units), after: formatUnits(after.units) },
    { key: 'avg', label: 'Average cost per share', before: before.avgCostMicro === null ? none : price(before.avgCostMicro), after: after.avgCostMicro === null ? none : price(after.avgCostMicro) },
    { key: 'cost', label: currency === 'USD' ? 'Cost of holdings (USD)' : 'Cost of holdings', before: money(before.costMinor), after: money(after.costMinor) },
    { key: 'realized', label: currency === 'USD' ? 'Realized profit (price, USD)' : 'Realized profit', before: profit(before.realizedMinor), after: profit(after.realizedMinor) },
  ];
  if (currency === 'USD' && before.costThb !== null && after.costThb !== null && before.realizedThb !== null && after.realizedThb !== null) {
    rows.push(
      { key: 'costThb', label: 'Cost of holdings (THB)', before: baht(before.costThb), after: baht(after.costThb) },
      { key: 'realizedThb', label: 'Realized profit incl. FX (THB)', before: signed(before.realizedThb), after: signed(after.realizedThb) },
    );
  }
  return rows;
}

/** ผลกระทบของการแก้รายการ: ต้นทุนเฉลี่ยและกำไรที่ขายแล้ว ก่อนแก้ → หลังแก้ (ขอบเขตของสินทรัพย์ตัวนี้ตัวเดียว) · แถวที่เปลี่ยนมีป้ายข้อความ ไม่พึ่งสีอย่างเดียว */
export function EditImpact({ before, after, currency }: { before: EditSide; after: EditSide; currency: 'USD' | 'THB' }) {
  const rows = rowsOf(before, after, currency);
  return (
    <div className="edit-impact" data-testid="edit-impact">
      <table className="edit-impact-table">
        <caption className="sr-only">Effect of this change on this holding, before and after</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="num">
              Before
            </th>
            <th scope="col" className="num">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.before !== r.after ? 'is-changed' : undefined}>
              <th scope="row">{r.label}</th>
              <td className="num">{r.before}</td>
              <td className="num">
                {r.after}
                {r.before !== r.after && <span className="edit-changed"> (changed)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">These figures are recalculated from all records of this holding with your change applied (average cost method). Nothing is saved until you confirm.</p>
    </div>
  );
}
