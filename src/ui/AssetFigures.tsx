import { thaiDayLabel } from '../app/dates';
import type { AssetRowView } from '../app/portfolio';
import { daysBetween } from '../domain/bills/calendar';
import type { AssetKind } from '../domain/invest/types';
import { formatUnits } from '../domain/invest/units';
import { formatMicro } from '../domain/money/micro';
import { formatBaht, satang } from '../domain/money/satang';

const ASSET_KIND_LABEL: Record<AssetKind, string> = { fund: 'กองทุน', stock: 'หุ้น', other: 'อื่นๆ' };
const baht = (n: number): string => formatBaht(satang(n));
const signed = (n: number): string => (n > 0 ? `+${baht(n)}` : baht(n));

/**
 * ชื่อ + ตัวเลขของสินทรัพย์หนึ่งแถวในหน้าพอร์ต (เจ้าของสั่ง 13 พ.ย. 2569: มือถือ 360px อ่านง่ายขึ้น ชื่อยาวไม่ดันตัวเลขตก)
 * ตัวเลขแต่ละอย่างอยู่คนละบรรทัด: ป้าย (ซ้าย) · ค่า (ขวา ไม่ตัดกลางตัวเลข) · ชื่อยาวขึ้นบรรทัดใหม่ในที่ของตัวเอง
 * แสดงผลอย่างเดียว ไม่มีสูตรเงิน (ค่าทั้งหมดมาจาก buildPortfolio)
 */
export function AssetFigures({ row, today }: { row: AssetRowView; today: string }) {
  return (
    <>
      <div className="tx-title asset-title" role="heading" aria-level={3}>
        <span className="asset-name">{row.asset.name}</span> <span className="muted small asset-kind">{ASSET_KIND_LABEL[row.asset.kind]}</span>
      </div>
      {row.error ? (
        <p role="alert" className="form-error">
          ข้อมูลรายการของสินทรัพย์นี้ไม่สอดคล้อง: {row.error}
        </p>
      ) : (
        <dl className="asset-figures muted small">
          <div className="asset-fig">
            <dt>ถือ</dt>
            <dd className="num">{formatUnits(row.position.units)} หน่วย</dd>
          </div>
          <div className="asset-fig">
            <dt>ต้นทุน</dt>
            <dd className="num">{baht(row.position.cost)}</dd>
          </div>
          {row.avgCostMicro !== null && (
            <div className="asset-fig asset-fig-wide">
              <dt>ต้นทุนเฉลี่ย</dt>
              <dd className="num">{formatMicro(row.avgCostMicro)} บาท/หน่วย</dd>
            </div>
          )}
          {row.latestPrice ? (
            <>
              <div className="asset-fig asset-fig-wide">
                <dt>ราคา ณ {thaiDayLabel(row.latestPrice.date)}</dt>
                <dd className="num">{formatMicro(row.latestPrice.priceMicro)} บาท</dd>
              </div>
              {row.priceStale && (
                <div className="asset-fig asset-fig-note">
                  <dt className="sr-only">คำเตือน</dt>
                  <dd>
                    <strong className="stale">ราคาเก่า {daysBetween(row.latestPrice.date, today)} วัน อัปเดตราคาก่อนดูมูลค่า</strong>
                  </dd>
                </div>
              )}
              {row.market && (
                <>
                  <div className="asset-fig">
                    <dt>มูลค่า</dt>
                    <dd className="num">{baht(row.market.value)}</dd>
                  </div>
                  <div className="asset-fig">
                    <dt>กำไร/ขาดทุน</dt>
                    <dd className="num">{signed(row.market.unrealized)}</dd>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="asset-fig asset-fig-note">
              <dt className="sr-only">ราคา</dt>
              <dd>{row.position.units > 0n ? 'ยังไม่ได้กรอกราคา (ไม่แสดงมูลค่า)' : 'ไม่มีหน่วยที่ถืออยู่'}</dd>
            </div>
          )}
          {row.realizedGain !== 0 && (
            <div className="asset-fig">
              <dt>ขายแล้ว</dt>
              <dd className="num">{signed(row.realizedGain)}</dd>
            </div>
          )}
          {row.dividendsNet > 0 && (
            <div className="asset-fig">
              <dt>ปันผล</dt>
              <dd className="num">{baht(row.dividendsNet)}</dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}
