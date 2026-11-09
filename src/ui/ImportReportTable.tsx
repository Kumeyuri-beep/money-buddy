import type { VerifyReport } from '../app/importVerify';
import { formatMicro } from '../domain/money/micro';
import { formatBaht, satang } from '../domain/money/satang';

const money = (currency: string, value: number): string => {
  try {
    return currency === 'THB' ? formatBaht(satang(value)) : `${formatMicro(value)} ${currency}`;
  } catch {
    return '— (เกินช่วงที่แสดงได้)';
  }
};

/** ตารางเทียบยอดต่อบัญชี (ใช้ร่วมกันระหว่างหน้าย้ายข้อมูลและนำเข้าจากไฟล์) · `sourceLabel` = ชื่อคอลัมน์ฝั่งต้นทาง */
export function BalanceTable({ report, sourceLabel = 'ในเครื่อง (เดิม)' }: { report: VerifyReport; sourceLabel?: string }) {
  // แสดงทุกบัญชีที่มียอด และ "ทุกบัญชีที่ไม่ตรง" เสมอ (ยอดศูนย์ทั้งสองฝั่งที่ตรงกันไม่แสดงเพราะไม่มีข้อมูลให้ตรวจ)
  const rows = report.balances.filter((b) => b.source !== 0 || b.imported !== 0 || !b.match);
  return (
    <div className="migrate-table-wrap" role="region" aria-label="ตารางเทียบยอดต่อบัญชี เลื่อนซ้ายขวาได้" tabIndex={0}>
      <table className="migrate-table">
        <caption className="sr-only">เทียบยอดต่อบัญชี ระหว่าง{sourceLabel}กับบัญชีออนไลน์</caption>
        <thead>
          <tr>
            <th scope="col">บัญชี</th>
            <th scope="col" className="num">
              {sourceLabel}
            </th>
            <th scope="col" className="num">
              ออนไลน์
            </th>
            <th scope="col">ผล</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4}>ไม่มีบัญชีที่มียอด</td>
            </tr>
          )}
          {rows.map((b) => (
            <tr key={b.accountId}>
              <th scope="row">{b.name}</th>
              <td className="num">{money(b.currency, b.source)}</td>
              <td className="num">{money(b.currency, b.imported)}</td>
              <td>{b.match ? '✓ ตรง' : '⚠ ไม่ตรง'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        จำนวน (เดิม/ออนไลน์): บัญชี {report.counts.accounts[0]}/{report.counts.accounts[1]} · รายการ {report.counts.entries[0]}/{report.counts.entries[1]} · บิล {report.counts.bills[0]}/{report.counts.bills[1]}
      </p>
    </div>
  );
}
