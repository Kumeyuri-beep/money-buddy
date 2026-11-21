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
  /** สกุลของสินทรัพย์ (R20) · ไม่มี = THB (ข้อมูลเดิมทุกรายการ) · ใส่เฉพาะ 'USD' */
  currency?: InstrumentCurrency;
  /** ชื่อย่อหุ้น เช่น AAPL (ไม่บังคับ) */
  ticker?: string;
  /** ตลาด (ไม่บังคับ) */
  exchange?: string;
  /** sector ที่ผู้ใช้กรอก (ไม่บังคับ · ยาว 1-60 · Categories R2) */
  sector?: string;
  /** หมวดของสินทรัพย์นี้ (รหัสใน InvestmentData.categories) · ไม่มี = Uncategorized */
  categoryId?: string;
}

/** หมวดของผู้ใช้ (Categories R2) · เป้าเป็น bps จำนวนเต็ม (45% = 4,500) · null = ยังไม่ตั้งเป้า · ถ้ามีหมวดใดตั้งเป้า ทุกหมวดต้องตั้งและรวม 10,000 */
export interface AssetCategory {
  id: string;
  name: string;
  targetBps: number | null;
  sortOrder: number;
}

/** สกุลของสินทรัพย์ที่รองรับ (R11/R20) */
export type InstrumentCurrency = 'THB' | 'USD';
export const INSTRUMENT_EXCHANGES: readonly string[] = ['NYSE', 'NASDAQ', 'AMEX', 'OTC'];
export const assetCurrency = (a: Pick<Asset, 'currency'>): InstrumentCurrency => a.currency ?? 'THB';

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
  /** ราคาต่อหน่วย micro ของสกุลสินทรัพย์ (ขายต้องมี) */
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
  /** อัตราแลกเปลี่ยน บาทต่อ 1 USD x 10^6 ณ วันรายการ (R20) · มีเฉพาะรายการของสินทรัพย์ USD */
  fxRateMicro?: number;
}

export interface AssetPrice {
  assetId: string;
  /** YYYY-MM-DD */
  date: string;
  priceMicro: number;
}

/** อัตราที่ผู้ใช้กรอกต่อบัญชีเงินสด USD ต่อวัน (R20 · ใช้เติมอัตราเริ่มต้นของรายการถัดไป) */
export interface FxRateRecord {
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  rateMicro: number;
}

export type FxDirection = 'thb_to_usd' | 'usd_to_thb';
export const FX_DIRECTIONS: readonly FxDirection[] = ['thb_to_usd', 'usd_to_thb'];

/** การแลกเงิน: จำนวนสองฝั่งเป็นข้อมูลหลัก · อัตราคำนวณจากสองค่า (R20.2) · ผูกกับ Entry 4 บรรทัดในสมุด */
export interface FxExchangeRecord {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  createdAt: string;
  direction: FxDirection;
  thbSatang: number;
  usdCents: number;
  rateMicro: number;
  memo: string;
  entryId: string;
}

export interface InvestmentData {
  assets: Asset[];
  trades: TradeRecord[];
  prices: AssetPrice[];
  /** มีเฉพาะเมื่อมีข้อมูล USD (ไฟล์บาทเดิมไม่มีฟิลด์นี้) */
  fxRates?: FxRateRecord[];
  fxExchanges?: FxExchangeRecord[];
  /** มีเฉพาะเมื่อผู้ใช้สร้างหมวดแล้ว (ไฟล์เดิมไม่มีฟิลด์นี้) */
  categories?: AssetCategory[];
}

export const emptyInvestments = (): InvestmentData => ({ assets: [], trades: [], prices: [] });

export const isEmptyInvestments = (d: InvestmentData | undefined): boolean =>
  d === undefined ||
  (d.assets.length === 0 && d.trades.length === 0 && d.prices.length === 0 && (d.fxRates?.length ?? 0) === 0 && (d.fxExchanges?.length ?? 0) === 0 && (d.categories?.length ?? 0) === 0);

/** เพดานแถวต่อผู้ใช้ (ต้องตรงกับ private.enforce_invest_limits ใน migration 20261111000100) */
export const MAX_ASSETS = 200;
export const MAX_TRADES = 10_000;
export const MAX_PRICES = 10_000;
export const MAX_FX_RATES = 10_000;
export const MAX_FX_EXCHANGES = 10_000;
/** เพดานหมวดต่อผู้ใช้ (ต้องตรงกับ private.enforce_category_limit ใน migration 20261121000100) */
export const MAX_CATEGORIES = 50;
export const CATEGORY_NAME_MAX = 60;
export const CATEGORY_TARGET_TOTAL_BPS = 10_000;
