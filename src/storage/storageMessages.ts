import { defineMessages, hasCode, withCode, type ErrorParams } from '../domain/errors/coded';
import { CATEGORY_PROBLEM_TEXT } from '../domain/invest/categories';

/**
 * แม่แบบข้อความ error ของชั้น storage ที่ผู้ใช้โหมด /invest เห็นได้ (รหัส `store.*`)
 * th = ข้อความเดิมทุกตัวอักษร (หน้าอื่นยังเป็นไทย) · en = ข้อความของโหมด /invest
 * ไม่มีสูตรเงิน ไม่แตะฐานข้อมูล · ตัวเลข/ชื่อฟิลด์ต้องมาจาก params
 */

/** ชื่อฟิลด์ตัวเลขจากเซิร์ฟเวอร์ (คีย์ใน params.field) → ไทย (ข้อความเดิม) / อังกฤษ */
const NUMBER_FIELDS = {
  fee: { th: 'ค่าธรรมเนียม', en: 'fee' },
  withholding: { th: 'ภาษีหัก ณ ที่จ่าย', en: 'withholding tax' },
  unitPrice: { th: 'ราคาต่อหน่วย', en: 'price per unit' },
  tradeValue: { th: 'มูลค่า', en: 'value' },
  fxRate: { th: 'อัตราแลกเปลี่ยน', en: 'exchange rate' },
  thbExchanged: { th: 'จำนวนบาทที่แลก', en: 'THB amount exchanged' },
  usdExchanged: { th: 'จำนวน USD ที่แลก', en: 'USD amount exchanged' },
  price: { th: 'ราคา', en: 'price' },
  lineAmount: { th: 'จำนวนเงิน', en: 'amount' },
  billAmount: { th: 'ยอดบิล', en: 'bill amount' },
  categoryTarget: { th: 'เป้าของหมวด', en: 'category target' },
  categorySort: { th: 'ลำดับหมวด', en: 'category order' },
} as const;
export type NumberField = keyof typeof NUMBER_FIELDS;
const fieldTh = (p: ErrorParams) => NUMBER_FIELDS[String(p.field) as NumberField].th;
const fieldEn = (p: ErrorParams) => NUMBER_FIELDS[String(p.field) as NumberField].en;

const BAD = 'ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง';

export const storeMsg = defineMessages({
  // แปลง error ของฐานข้อมูล (storageErrorFrom)
  'store.dbDuplicate': { th: () => 'รหัสนี้มีอยู่แล้ว ไม่เขียนทับ', en: () => 'This ID already exists. Nothing was overwritten.' },
  'store.dbBadReference': {
    th: () => 'ข้อมูลอ้างอิงไม่ถูกต้อง (บัญชีหรือบิลที่เกี่ยวข้องไม่มีอยู่)',
    en: () => 'Invalid reference: the related account or bill does not exist.',
  },
  'store.dbRejected': { th: () => 'ข้อมูลไม่ผ่านการตรวจของฐานข้อมูล', en: () => 'The database rejected this data.' },
  'store.network': { th: () => 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง', en: () => 'Cannot connect to the server. Please try again.' },
  'store.saveFailed': { th: () => 'บันทึกหรืออ่านข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง', en: () => 'Could not save or load the data. Please try again.' },
  'store.readIncomplete': {
    th: () => 'ข้อมูลเปลี่ยนระหว่างอ่านหรืออ่านไม่ครบ ลองใหม่อีกครั้ง',
    en: () => 'The data changed while loading, or could not be fully loaded. Please try again.',
  },
  // ข้อมูลจากเซิร์ฟเวอร์ผิดรูป
  'store.badNumber': {
    th: (p) => `${BAD}: ${fieldTh(p)} ไม่ใช่จำนวนเต็มที่ปลอดภัย`,
    en: (p) => `Invalid server data: ${fieldEn(p)} is not a safe whole number.`,
  },
  'store.badAccountKind': { th: (p) => `${BAD}: ประเภทบัญชี "${p.value}"`, en: (p) => `Invalid server data: account type "${p.value}".` },
  'store.badAssetKind': { th: (p) => `${BAD}: ชนิดสินทรัพย์ "${p.value}"`, en: (p) => `Invalid server data: asset type "${p.value}".` },
  'store.badAssetCurrency': { th: (p) => `${BAD}: สกุลของสินทรัพย์ "${p.value}"`, en: (p) => `Invalid server data: asset currency "${p.value}".` },
  'store.badTimestamp': {
    th: () => `${BAD}: เวลาบันทึกของรายการลงทุนอยู่นอกช่วงที่รองรับ`,
    en: () => 'Invalid server data: the investment record time is outside the supported range.',
  },
  'store.badTradeKind': { th: (p) => `${BAD}: ชนิดรายการลงทุน "${p.value}"`, en: (p) => `Invalid server data: transaction type "${p.value}".` },
  'store.badUnits': { th: () => `${BAD}: จำนวนหน่วยไม่ใช่ข้อความจำนวนเต็ม`, en: () => 'Invalid server data: units is not a whole-number string.' },
  'store.badFxDirection': { th: (p) => `${BAD}: ทิศทางการแลกเงิน "${p.value}"`, en: (p) => `Invalid server data: exchange direction "${p.value}".` },
  // ตรวจอินพุตของเมธอดลงทุน
  'store.assetIdInvalid': { th: () => 'รหัสสินทรัพย์ไม่ถูกต้อง', en: () => 'Invalid asset ID.' },
  'store.assetNameLength': {
    th: (p) => `ชื่อสินทรัพย์ต้องยาว 1-${p.max} ตัวอักษร`,
    en: (p) => `Asset name must be 1-${p.max} characters long.`,
  },
  'store.assetKindInvalid': { th: () => 'ชนิดสินทรัพย์ไม่ถูกต้อง', en: () => 'Invalid asset type.' },
  'store.walletIdInvalid': { th: () => 'รหัสกระเป๋าไม่ถูกต้อง', en: () => 'Invalid wallet ID.' },
  'store.walletNameLength': {
    th: (p) => `ชื่อกระเป๋าต้องยาว 1-${p.max} ตัวอักษร`,
    en: (p) => `Wallet name must be 1-${p.max} characters long.`,
  },
  'store.usdAccountIdInvalid': { th: () => 'รหัสบัญชีไม่ถูกต้อง', en: () => 'Invalid account ID.' },
  'store.usdAccountNameLength': {
    th: (p) => `ชื่อบัญชีต้องยาว 1-${p.max} ตัวอักษร`,
    en: (p) => `Account name must be 1-${p.max} characters long.`,
  },
  'store.stockNameLength': {
    th: (p) => `ชื่อหุ้นต้องยาว 1-${p.max} ตัวอักษร`,
    en: (p) => `Stock name must be 1-${p.max} characters long.`,
  },
  'store.tickerLength': { th: (p) => `ticker ต้องยาว 1-${p.max} ตัวอักษร`, en: (p) => `Ticker must be 1-${p.max} characters long.` },
  'store.exchangeUnsupported': { th: () => 'ตลาดไม่อยู่ในรายการที่รองรับ', en: () => 'This exchange is not supported.' },
  'store.assetNotFound': { th: () => 'ไม่พบสินทรัพย์นี้', en: () => 'Asset not found.' },
  'store.usdOnly': { th: () => 'รายการนี้ใช้ได้เฉพาะหุ้นสกุล USD', en: () => 'This transaction is only for USD-denominated stocks.' },
  'store.fxRateRequired': { th: () => 'ต้องมีอัตราแลกเปลี่ยนของวันรายการ', en: () => 'An exchange rate for the transaction date is required.' },
  'store.fxExchangeNotFound': {
    th: () => 'ไม่พบรายการแลกเงินนี้ อาจถูกลบไปแล้ว',
    en: () => 'Currency exchange not found. It may already have been deleted.',
  },
  'store.tradeNotFound': { th: () => 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว', en: () => 'Transaction not found. It may already have been deleted.' },
  // ข้อมูลของสินทรัพย์เปลี่ยนระหว่างแก้/บันทึก (อีกแท็บ/อุปกรณ์ หรือฐานข้อมูลชนกัน PT409/40P01/40001) · ข้อความเดียว ไม่รั่วรายละเอียดภายใน
  'store.dataChanged': { th: () => 'ข้อมูลเปลี่ยนไปแล้ว โหลดใหม่แล้วลองอีกครั้ง', en: () => 'Data changed — reload and try again.' },
  'store.tradeNoRetype': {
    th: () => 'แก้ชนิดรายการหรือย้ายไปสินทรัพย์อื่นไม่ได้ (ลบแล้วบันทึกใหม่)',
    en: () => 'You cannot change the type of a saved transaction or move it to another stock. Delete it and add a new one.',
  },
  'store.tradeDeleteFailed': { th: () => 'ลบรายการไม่สำเร็จ (ไม่พบรายการ)', en: () => 'Could not delete the transaction (not found).' },
  'store.fxRateInvalid': {
    th: () => 'อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม micro ที่มากกว่า 0',
    en: () => 'The exchange rate must be a whole number of micro-units greater than 0.',
  },
  'store.priceInvalid': {
    th: () => 'ราคาต้องเป็นจำนวนเต็ม micro-baht ที่มากกว่า 0',
    en: () => 'The price must be a whole number of micro-baht greater than 0.',
  },
  // ค่าตั้งค่า (ตั้งค่าพอร์ต / แผนซื้อประจำ) และที่เก็บในเครื่อง
  'store.settingsConflict': {
    th: () => 'ค่าตั้งค่าถูกแก้จากแท็บหรืออุปกรณ์อื่นแล้ว โหลดค่าล่าสุดแล้ว ลองบันทึกอีกครั้ง',
    en: () => 'Settings were changed from another tab or device. The latest values have been loaded. Please try saving again.',
  },
  'store.categoryCount': { th: () => CATEGORY_PROBLEM_TEXT.count.th, en: () => CATEGORY_PROBLEM_TEXT.count.en },
  'store.categoryId': { th: () => CATEGORY_PROBLEM_TEXT.id.th, en: () => CATEGORY_PROBLEM_TEXT.id.en },
  'store.categoryName': { th: () => CATEGORY_PROBLEM_TEXT.name.th, en: () => CATEGORY_PROBLEM_TEXT.name.en },
  'store.categorySort': { th: () => CATEGORY_PROBLEM_TEXT.sort.th, en: () => CATEGORY_PROBLEM_TEXT.sort.en },
  'store.categoryTarget': { th: () => CATEGORY_PROBLEM_TEXT.target.th, en: () => CATEGORY_PROBLEM_TEXT.target.en },
  'store.categoryDuplicateId': { th: () => CATEGORY_PROBLEM_TEXT.duplicateId.th, en: () => CATEGORY_PROBLEM_TEXT.duplicateId.en },
  'store.categoryDuplicateName': { th: () => CATEGORY_PROBLEM_TEXT.duplicateName.th, en: () => CATEGORY_PROBLEM_TEXT.duplicateName.en },
  'store.categoryTargetTotal': { th: () => CATEGORY_PROBLEM_TEXT.targetTotal.th, en: () => CATEGORY_PROBLEM_TEXT.targetTotal.en },
  'store.localInvestUnsupported': {
    th: () => 'พอร์ตลงทุนใช้ได้เฉพาะบัญชีออนไลน์ (ที่เก็บในเครื่องไม่รองรับ)',
    en: () => 'The investment portfolio is only available with an online account (local storage is not supported).',
  },
});

export type StoreCode = Parameters<typeof storeMsg>[0];

/** ห่อ error จากชั้น domain (เช่น TradeLinkError) เป็น StorageError ข้อความเดิม แต่พกรหัสต้นทางไปด้วยถ้ามี */
export function carryCode<E extends Error>(wrapper: E, source: unknown): E {
  return hasCode(source) ? withCode(wrapper, source.code, source.params) : wrapper;
}
