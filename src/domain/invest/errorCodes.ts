/**
 * แม่แบบข้อความ error ของ domain/invest (R1 · เจ้าของอนุมัติ 17 พ.ย. 2569) · th = ข้อความไทยเดิมทุกตัวอักษร (golden ใน tests/unit/errorCodes-invest-golden.test.ts)
 * en = สำหรับหน้า /invest · ตัวเลข/ค่าทุกตัวมาจาก params (ไม่คำนวณเงินใหม่ในแม่แบบ)
 * รหัสไม่ซ้ำทั้งโปรเจกต์: units. fx. trade. dca. dcaplan. rules. fxx. link. acct.
 */

import { defineMessages, withCode, type ErrorParams } from '../errors/coded';

const num = (v: string | number | undefined): string => String(v ?? '');

const MINOR_NAME: Record<string, { th: string; en: string }> = {
  amount: { th: 'จำนวนเงิน', en: 'Amount' },
  dividend: { th: 'ยอดปันผล', en: 'Dividend' },
  withholding: { th: 'ภาษีหัก ณ ที่จ่าย', en: 'Withholding tax' },
};
const TRADE_NAME: Record<string, { th: string; en: string }> = {
  buyValue: { th: 'มูลค่าซื้อ', en: 'Purchase value' },
  fee: { th: 'ค่าธรรมเนียม', en: 'Fee' },
};
const nameOf = (table: Record<string, { th: string; en: string }>, key: string | number | undefined, lang: 'th' | 'en'): string => table[String(key)]?.[lang] ?? String(key);

export const investMsg = defineMessages({
  // units.ts
  'units.unreadable': {
    th: (p) => `อ่าน${p.kind === 'price' ? 'ราคา' : 'จำนวนหน่วย'}ไม่ได้: "${num(p.input)}"`,
    en: (p) => `Cannot read the ${p.kind === 'price' ? 'price' : 'number of units'}: "${num(p.input)}"`,
  },
  'units.zero': { th: () => 'จำนวนหน่วยต้องมากกว่า 0 (ละเอียดสุด 8 ตำแหน่ง)', en: () => 'Units must be greater than 0 (up to 8 decimal places)' },
  'units.tooMany': { th: () => 'จำนวนหน่วยมากเกินช่วงที่รองรับ', en: () => 'The number of units is larger than supported' },
  'units.priceZero': { th: () => 'ราคาต้องมากกว่า 0 (ละเอียดสุด 0.000001 บาท)', en: () => 'Price must be greater than 0 (up to 0.000001 per unit)' },
  'units.priceTooHigh': { th: () => 'ราคาสูงเกินช่วงที่รองรับ', en: () => 'The price is higher than supported' },
  'units.negative': { th: () => 'จำนวนหน่วยติดลบไม่ได้', en: () => 'Units cannot be negative' },
  'units.priceMicroInvalid': {
    th: (p) => `ราคาต่อหน่วยต้องเป็นจำนวนเต็ม micro-baht ที่มากกว่า 0 (ได้รับ ${num(p.got)})`,
    en: (p) => `Price per unit must be a whole number of micro-units greater than 0 (got ${num(p.got)})`,
  },
  'units.resultOutOfRange': { th: () => 'ผลลัพธ์เกินช่วงจำนวนเต็มปลอดภัย', en: () => 'The result is too large to calculate safely' },

  // fx.ts
  'fx.rateInvalid': {
    th: (p) => `อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม micro ที่มากกว่า 0 (ได้รับ ${num(p.got)})`,
    en: (p) => `The exchange rate must be a whole number of micro-units greater than 0 (got ${num(p.got)})`,
  },
  'fx.minorInvalid': {
    th: (p) => `${nameOf(MINOR_NAME, p.name, 'th')} ต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ ${num(p.got)})`,
    en: (p) => `${nameOf(MINOR_NAME, p.name, 'en')} must be a non-negative whole number of minor units (got ${num(p.got)})`,
  },
  'fx.exchangeBahtInvalid': { th: () => 'จำนวนบาทที่จ่ายต้องเป็นสตางค์จำนวนเต็มตั้งแต่ 1', en: () => 'The baht paid must be a whole number of satang, at least 1' },
  'fx.exchangeUsdInvalid': { th: () => 'จำนวนดอลลาร์ที่ได้ต้องเป็นเซนต์จำนวนเต็มตั้งแต่ 1', en: () => 'The dollars received must be a whole number of cents, at least 1' },
  'fx.whtBpsRange': { th: () => 'อัตราภาษีหักต้องอยู่ระหว่าง 0-10,000 bps', en: () => 'The withholding rate must be between 0 and 10,000 bps' },
  'fx.dividendMin': { th: () => 'ยอดปันผลต้องตั้งแต่ 1 เซนต์', en: () => 'The dividend must be at least 1 cent' },
  'fx.whtNotBelowDividend': { th: () => 'ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดปันผล', en: () => 'Withholding tax must be less than the dividend' },

  // costBasis.ts / costBasisFx.ts / rules.ts
  'trade.satangInt': {
    th: (p) => `${nameOf(TRADE_NAME, p.name, 'th')} ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ต่ำกว่า ${num(p.min)} (ได้รับ ${num(p.got)})`,
    en: (p) => `${nameOf(TRADE_NAME, p.name, 'en')} must be a whole number of satang, at least ${num(p.min)} (got ${num(p.got)})`,
  },
  'trade.minorInt': {
    th: (p) => `${nameOf(TRADE_NAME, p.name, 'th')} ต้องเป็นจำนวนเต็มที่ไม่ต่ำกว่า ${num(p.min)} (ได้รับ ${num(p.got)})`,
    en: (p) => `${nameOf(TRADE_NAME, p.name, 'en')} must be a whole number, at least ${num(p.min)} (got ${num(p.got)})`,
  },
  'trade.buyUnitsPositive': { th: () => 'จำนวนหน่วยที่ซื้อต้องมากกว่า 0', en: () => 'Units bought must be greater than 0' },
  'trade.sellUnitsPositive': { th: () => 'จำนวนหน่วยที่ขายต้องมากกว่า 0', en: () => 'Units sold must be greater than 0' },
  'trade.positionInvalid': { th: () => 'ตำแหน่งการลงทุนไม่ถูกต้อง', en: () => 'The investment position is invalid' },
  'trade.sellExceedsHeld': { th: () => 'ขายเกินจำนวนหน่วยที่ถืออยู่', en: () => 'You cannot sell more units than you hold' },
  'trade.sellFeeExceedsGross': { th: () => 'ค่าธรรมเนียมขายเกินเงินที่ขายได้', en: () => 'The fee is more than the sale proceeds' },
  'trade.costImbalance': { th: () => 'ต้นทุนไม่สมดุลหลังเล่นซ้ำรายการ', en: () => 'Cost does not balance after replaying the trades' },
  'trade.buyBahtCostZero': {
    th: () => 'ต้นทุนบาทของรายการซื้อปัดเป็น 0 สตางค์ (อัตราต่ำหรือจำนวนเงินน้อยเกินไป) บันทึกไม่ได้',
    en: () => 'The baht cost of this purchase rounds to 0 satang (rate or amount too low), so it cannot be saved',
  },
  'trade.sellUsdZero': {
    th: () => 'ขายแล้วได้เงิน 0 เซนต์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้',
    en: () => 'This sale yields 0 cents (too few units or price too low), so it cannot be saved',
  },
  'trade.sellSatangZero': {
    th: () => 'ขายแล้วได้เงิน 0 สตางค์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้',
    en: () => 'This sale yields 0 satang (too few units or price too low), so it cannot be saved',
  },

  // dca.ts
  'dca.amountInvalid': {
    th: (p) => `จำนวนเงินซื้อต้องเป็นสตางค์จำนวนเต็มที่มากกว่า 0 (ได้รับ ${num(p.got)})`,
    en: (p) => `The purchase amount must be a whole number of satang greater than 0 (got ${num(p.got)})`,
  },
  'dca.unitsZero': { th: () => 'จำนวนเงินน้อยเกินไปจนได้หน่วยเป็น 0', en: () => 'The amount is too small to buy any units' },

  // dcaPlan.ts
  'dcaplan.id': { th: () => 'รหัสแผนไม่ถูกต้อง', en: () => 'The plan ID is invalid' },
  'dcaplan.assetId': { th: () => 'รหัสสินทรัพย์ไม่ถูกต้อง', en: () => 'The asset ID is invalid' },
  'dcaplan.amount': { th: () => 'เงินซื้อต่อรอบต้องเป็นสตางค์จำนวนเต็มอย่างน้อย 1', en: () => 'The amount per cycle must be a whole number of satang, at least 1' },
  'dcaplan.day': { th: () => 'วันที่ของเดือนต้องเป็น 1-31', en: () => 'The day of the month must be 1-31' },
  'dcaplan.startMonth': { th: () => 'เดือนเริ่มต้องเป็น YYYY-MM', en: () => 'The start month must be in YYYY-MM format' },
  'dcaplan.paused': { th: () => 'สถานะพักแผนไม่ถูกต้อง', en: () => 'The paused status is invalid' },
  'dcaplan.dateInvalid': { th: (p) => `วันที่ไม่ถูกต้อง: ${num(p.iso)}`, en: (p) => `Invalid date: ${num(p.iso)}` },

  // rules.ts
  'rules.replayFallback': { th: () => 'รายการซื้อขายไม่สอดคล้อง', en: () => 'The trades are inconsistent' },
  'rules.duplicateId': { th: () => 'รหัสรายการซ้ำ', en: () => 'Duplicate trade ID' },
  'rules.sellValueOverflow': { th: () => 'มูลค่าที่ขายเกินช่วงที่คำนวณได้', en: () => 'The sale value is too large to calculate' },
  'rules.dateAfterLastSell': {
    th: (p) => `ต้องลงวันที่หลังรายการขายล่าสุด (${num(p.date)}) เพราะต้นทุนเฉลี่ยขึ้นกับลำดับ ถ้าต้องการบันทึกย้อนหลัง ให้ลบรายการขายก่อน`,
    en: (p) => `The date must be after the latest sale (${num(p.date)}) because average cost depends on order. To record an earlier trade, delete the sale first`,
  },
  'rules.notFound': { th: () => 'ไม่พบรายการ', en: () => 'Trade not found' },
  'rules.deleteOnlyLastSell': { th: () => 'ลบได้เฉพาะรายการขายล่าสุด (ลบจากล่าสุดย้อนกลับ)', en: () => 'Only the latest sale can be deleted (delete from newest to oldest)' },
  'rules.deleteBeforeLastSell': {
    th: (p) => `ลบรายการที่ลงวันที่ ณ หรือก่อนรายการขายล่าสุด (${num(p.date)}) ไม่ได้ ให้ลบรายการขายก่อน`,
    en: (p) => `Cannot delete a trade dated on or before the latest sale (${num(p.date)}). Delete the sale first`,
  },

  // fxExchange.ts
  'fxx.dateMismatch': { th: () => 'วันที่ของการแลกเงินไม่ตรงกับรายการในสมุด', en: () => 'The exchange date does not match the ledger entry' },
  'fxx.lines4': { th: () => 'รายการในสมุดของการแลกเงินต้องมี 4 บรรทัดพอดี', en: () => 'The ledger entry for an exchange must have exactly 4 lines' },
  'fxx.accountMissing': { th: () => 'รายการในสมุดของการแลกเงินอ้างบัญชีที่ไม่มี', en: () => 'The ledger entry for the exchange refers to an account that does not exist' },
  'fxx.accountWrongType': {
    th: () => 'รายการในสมุดของการแลกเงินใช้บัญชีผิดชนิด (ต้องเป็นกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1)',
    en: () => 'The ledger entry for the exchange uses the wrong account type (it needs one baht wallet, one baht suspense account, one USD cash account and one USD suspense account)',
  },
  'fxx.accountCount': {
    th: () => 'รายการในสมุดของการแลกเงินต้องมีกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1 บรรทัด',
    en: () => 'The ledger entry for the exchange must have exactly one line each for the baht wallet, baht suspense account, USD cash account and USD suspense account',
  },
  'fxx.thbMismatch': { th: () => 'จำนวนบาทในสมุดไม่ตรงกับรายการแลกเงิน', en: () => 'The baht amount in the ledger does not match the exchange' },
  'fxx.usdMismatch': { th: () => 'จำนวน USD ในสมุดไม่ตรงกับรายการแลกเงิน', en: () => 'The USD amount in the ledger does not match the exchange' },
  'fxx.rateUncomputable': { th: () => 'คำนวณอัตราไม่ได้', en: () => 'The rate cannot be calculated' },
  'fxx.rateMismatch': {
    th: (p) => `อัตราแลกเปลี่ยนไม่ตรงกับจำนวนสองฝั่ง (ควรเป็น ${num(p.expected)} micro)`,
    en: (p) => `The exchange rate does not match the two amounts (should be ${num(p.expected)} micro)`,
  },

  // ledgerLink.ts / ledgerLinkFx.ts
  'link.pickWallet': { th: () => 'เลือกกระเป๋าเงินที่ใช้จ่ายหรือรับเงิน', en: () => 'Choose the wallet used to pay or receive the money' },
  'link.noSellResult': { th: () => 'ไม่มีผลคำนวณต้นทุนของรายการขาย', en: () => 'There is no cost calculation for this sale' },
  'link.noChange': { th: () => 'รายการนี้ไม่เปลี่ยนยอดเงินใดเลย บันทึกไม่ได้', en: () => 'This trade does not change any balance, so it cannot be saved' },
  'link.pickUsdCash': { th: () => 'เลือกบัญชีเงินสด USD ที่ใช้จ่ายหรือรับเงิน', en: () => 'Choose the USD cash account used to pay or receive the money' },
  'link.usdNoReinvest': { th: () => 'หุ้นสหรัฐยังไม่รองรับปันผลลงทุนต่อ', en: () => 'US stocks do not support reinvested dividends yet' },
  'link.pickThbWallet': { th: () => 'เลือกกระเป๋าเงินบาท', en: () => 'Choose a baht wallet' },
  'link.pickUsdCashShort': { th: () => 'เลือกบัญชีเงินสด USD', en: () => 'Choose a USD cash account' },

  // app/portfolio.ts, app/usPortfolio.ts (ข้อความของแถวพอร์ต)
  'portfolio.inconsistent': { th: () => 'ข้อมูลรายการไม่สอดคล้อง', en: () => 'The trade records are inconsistent' },
  'portfolio.valueOverflow': { th: () => 'ตัวเลขใหญ่เกินช่วงที่รองรับ จึงคำนวณมูลค่าไม่ได้', en: () => 'The numbers are too large to calculate the value' },
  'portfolio.calcFailed': { th: () => 'คำนวณไม่ได้', en: () => 'Could not calculate' },

  // portfolioMoney.ts
  'acct.notFound': { th: () => 'ไม่พบบัญชีนี้', en: () => 'Account not found' },
  'acct.thbCashOnly': {
    th: () => 'เปลี่ยนป้ายได้เฉพาะบัญชีเงินสดสกุลบาท · บัญชี USD เป็นเงินลงทุนเสมอ',
    en: () => 'Only baht cash accounts can change label · USD accounts are always investment money',
  },
  'acct.linkedToAsset': {
    th: () => 'บัญชีที่ผูกกับสินทรัพย์ต้องเป็นเงินลงทุนเสมอ เปลี่ยนป้ายไม่ได้',
    en: () => 'An account linked to an asset is always investment money, so its label cannot be changed',
  },
  'acct.hasBills': {
    th: () => 'มีบิลที่จ่ายจากกระเป๋านี้อยู่ เปลี่ยนเป็นเงินลงทุนไม่ได้ (เปลี่ยนกระเป๋าของบิลก่อน)',
    en: () => 'Bills are paid from this wallet, so it cannot become investment money (change the bills\' wallet first)',
  },
});

export type InvestCode = Parameters<typeof investMsg>[0];

/** สร้าง error ชนิดเดิม ข้อความไทยจากแม่แบบ แล้วแปะรหัส (ไม่เปลี่ยนชนิด/ข้อความ) */
export function coded<E extends Error>(make: (message: string) => E, code: InvestCode, params: ErrorParams = {}) {
  return withCode(make(investMsg(code, params)), code, params);
}

/** ทางลัดของชนิด error ที่ใช้บ่อย */
export const rangeError = (code: InvestCode, params: ErrorParams = {}) => coded((m) => new RangeError(m), code, params);
export const syntaxError = (code: InvestCode, params: ErrorParams = {}) => coded((m) => new SyntaxError(m), code, params);

/** ปัญหาแบบมีรหัส: message ไทยเดิม + code/params */
export function problem(code: InvestCode, params: ErrorParams = {}): { message: string; code: string; params: ErrorParams } {
  return { message: investMsg(code, params), code, params };
}
