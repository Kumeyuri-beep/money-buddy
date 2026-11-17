import { formatDateEn } from '../app/dateEn';
import type { AssetRowView } from '../app/portfolio';
import { investProblem } from './invest/investError';
import { daysBetween } from '../domain/bills/calendar';
import type { AssetKind } from '../domain/invest/types';
import { formatUnits } from '../domain/invest/units';
import { formatMicro } from '../domain/money/micro';
import { baht, signed } from '../app/bahtFormat';

/** ชื่อชนิดสินทรัพย์ภาษาอังกฤษสำหรับโหมด /invest (ของ domain ยังเป็นไทย ไม่แตะ domain) */
export const ASSET_KIND_LABEL_EN: Record<AssetKind, string> = { fund: 'Fund', stock: 'Stock', other: 'Other' };

/**
 * ชื่อ + ตัวเลขของสินทรัพย์หนึ่งแถวในหน้าพอร์ต (เจ้าของสั่ง 13 พ.ย. 2569: มือถือ 360px อ่านง่ายขึ้น ชื่อยาวไม่ดันตัวเลขตก)
 * ตัวเลขแต่ละอย่างอยู่คนละบรรทัด: ป้าย (ซ้าย) · ค่า (ขวา ไม่ตัดกลางตัวเลข) · ชื่อยาวขึ้นบรรทัดใหม่ในที่ของตัวเอง
 * แสดงผลอย่างเดียว ไม่มีสูตรเงิน (ค่าทั้งหมดมาจาก buildPortfolio)
 */
export function AssetFigures({ row, today }: { row: AssetRowView; today: string }) {
  return (
    <>
      <div className="tx-title asset-title" role="heading" aria-level={3}>
        <span className="asset-name">{row.asset.name}</span> <span className="muted small asset-kind">{ASSET_KIND_LABEL_EN[row.asset.kind]}</span>
      </div>
      {row.error ? (
        <p role="alert" className="form-error">
          This asset's trade records are inconsistent: {investProblem({ message: row.error, code: row.errorCode, params: row.errorParams })}
        </p>
      ) : (
        <dl className="asset-figures muted small">
          <div className="asset-fig">
            <dt>Held</dt>
            <dd className="num">{formatUnits(row.position.units)} units</dd>
          </div>
          <div className="asset-fig">
            <dt>Cost</dt>
            <dd className="num">{baht(row.position.cost)}</dd>
          </div>
          {row.avgCostMicro !== null && (
            <div className="asset-fig asset-fig-wide">
              <dt>Average cost</dt>
              <dd className="num">{formatMicro(row.avgCostMicro)} THB/unit</dd>
            </div>
          )}
          {row.latestPrice ? (
            <>
              <div className="asset-fig asset-fig-wide">
                <dt>Price as of {formatDateEn(row.latestPrice.date)}</dt>
                <dd className="num">{formatMicro(row.latestPrice.priceMicro)} THB</dd>
              </div>
              {row.priceStale && (
                <div className="asset-fig asset-fig-note">
                  <dt className="sr-only">Warning</dt>
                  <dd>
                    <strong className="stale">
                      Price is {daysBetween(row.latestPrice.date, today)} {daysBetween(row.latestPrice.date, today) === 1 ? 'day' : 'days'} old. Update the price before relying on the value
                    </strong>
                  </dd>
                </div>
              )}
              {row.market && (
                <>
                  <div className="asset-fig">
                    <dt>Value</dt>
                    <dd className="num">{baht(row.market.value)}</dd>
                  </div>
                  <div className="asset-fig">
                    <dt>Unrealized gain/loss</dt>
                    <dd className="num">{signed(row.market.unrealized)}</dd>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="asset-fig asset-fig-note">
              <dt className="sr-only">Price</dt>
              <dd>{row.position.units > 0n ? 'No price entered yet (value not shown)' : 'No units held'}</dd>
            </div>
          )}
          {row.realizedGain !== 0 && (
            <div className="asset-fig">
              <dt>Realized gain/loss</dt>
              <dd className="num">{signed(row.realizedGain)}</dd>
            </div>
          )}
          {row.dividendsNet > 0 && (
            <div className="asset-fig">
              <dt>Dividends</dt>
              <dd className="num">{baht(row.dividendsNet)}</dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}
