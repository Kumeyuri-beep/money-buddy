/**
 * ชนิดข้อมูลการลงทุน (พอร์ตลงทุน P2/P3 · กฎ R17) · ตรงกับตาราง assets / trades / asset_prices
 * จำนวนหน่วยเป็นข้อความของจำนวนเต็ม x 10^8 (ไม่ใช้ number: เกิน 2^53 ได้) · เงินเป็นสตางค์ · ราคาเป็น micro-baht
 */

export type AssetKind = 'fund' | 'stock' | 'other';
export const ASSET_KINDS: readonly AssetKind[] = ['fund', 'stock', 'other'];

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  /** บัญชีลงทุน (kind = investment) ที่เก็บต้นทุนของสินทรัพย์นี้ */
  accountId: string;
  archived?: boolean;
}

/** buy = ซื้อ · sell = ขาย · dividend = ปันผลเป็นเงินสด · reinvest = ปันผลลงทุนต่อ (หน่วยเพิ่ม ไม่มีเงินสด) */
export type TradeKind = 'buy' | 'sell' | 'dividend' | 'reinvest';
export const TRADE_KINDS: readonly TradeKind[] = ['buy', 'sell', 'dividend', 'reinvest'];

export interface TradeRecord {
  id: string;
  assetId: string;
  kind: TradeKind;
  /** YYYY-MM-DD */
  date: string;
  /** เวลาบันทึก (ISO) ใช้เรียงลำดับเมื่อวันที่เท่ากัน */
  createdAt: string;
  /** จำนวนหน่วย x 10^8 เป็นข้อความจำนวนเต็มบวก (ซื้อ ขาย ปันผลลงทุนต่อ) */
  units?: string;
  /** ราคาต่อหน่วย micro-baht (ขายต้องมี) */
  priceMicro?: number;
  /** ซื้อ = มูลค่าซื้อ · ปันผล = ยอดปันผล · ปันผลลงทุนต่อ = ต้นทุนที่เพิ่ม (สตางค์ ≥ 1) */
  amount?: number;
  /** ค่าธรรมเนียม (สตางค์ ≥ 0) */
  fee: number;
  /** ภาษีหัก ณ ที่จ่ายของปันผล (สตางค์ ≥ 0) */
  withholding: number;
  memo: string;
  /** รายการในสมุดบัญชีคู่ที่ผูกกับรายการนี้ (P4) */
  entryId?: string;
}

export interface AssetPrice {
  assetId: string;
  /** YYYY-MM-DD */
  date: string;
  priceMicro: number;
}

export interface InvestmentData {
  assets: Asset[];
  trades: TradeRecord[];
  prices: AssetPrice[];
}

export const emptyInvestments = (): InvestmentData => ({ assets: [], trades: [], prices: [] });

export const isEmptyInvestments = (d: InvestmentData | undefined): boolean =>
  d === undefined || (d.assets.length === 0 && d.trades.length === 0 && d.prices.length === 0);

/** เพดานแถวต่อผู้ใช้ (ต้องตรงกับ private.enforce_invest_limits ใน migration 20261111000100) */
export const MAX_ASSETS = 200;
export const MAX_TRADES = 10_000;
export const MAX_PRICES = 10_000;
