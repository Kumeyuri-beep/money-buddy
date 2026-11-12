/**
 * ตัวช่วยฝั่งแอปของ "ดึงยอดซื้อจากพอร์ตมาเติมเครื่องคิดภาษี" (เฟส 3 · กฎ R19) · ฟังก์ชันล้วน ไม่แตะ React/ฐานข้อมูล
 * ป้าย RMF/Thai ESG เก็บเป็นรหัสสินทรัพย์ใน settings (ดู taxTags.ts) เขียนผ่าน patchSettings เท่านั้น
 */

import type { SettingsPatch } from '../domain/bills/settingsPatch';
import { MAX_TAX_TAGGED_ASSETS, type TaxTag } from '../domain/invest/taxTags';
import { satang, toBahtString } from '../domain/money/satang';
import type { TaxTags } from '../domain/tax/portfolioLink';

export type { TaxTag };

export function taxTagOf(tags: TaxTags, assetId: string): TaxTag | null {
  if (tags.rmf.includes(assetId)) return 'rmf';
  if (tags.thaiEsg.includes(assetId)) return 'thaiEsg';
  return null;
}

/** ติด/เปลี่ยน/ล้างป้ายของสินทรัพย์หนึ่ง (null = ล้าง) · สินทรัพย์ติดได้ประเภทเดียว · เกินเพดานต่อประเภท = ข้อผิดพลาดภาษาไทย */
export function withAssetTag(tags: TaxTags, assetId: string, tag: TaxTag | null): { rmf: string[]; thaiEsg: string[] } {
  // ติดซ้ำประเภทเดิม = ไม่เปลี่ยนอะไร (คงลำดับเดิม)
  if ((tag === 'rmf' && tags.rmf.includes(assetId)) || (tag === 'thaiEsg' && tags.thaiEsg.includes(assetId))) return { rmf: [...tags.rmf], thaiEsg: [...tags.thaiEsg] };
  const rmf = tags.rmf.filter((id) => id !== assetId);
  const thaiEsg = tags.thaiEsg.filter((id) => id !== assetId);
  const target = tag === 'rmf' ? rmf : tag === 'thaiEsg' ? thaiEsg : null;
  if (target !== null) {
    if (target.length >= MAX_TAX_TAGGED_ASSETS) throw new RangeError(`ติดป้ายได้ไม่เกิน ${MAX_TAX_TAGGED_ASSETS} สินทรัพย์ต่อประเภท`);
    target.push(assetId);
  }
  return { rmf, thaiEsg };
}

/** ค่าที่เขียนลง settings: รายการว่าง = ลบคีย์ (null) */
export function tagsToPatch(tags: TaxTags): SettingsPatch {
  return { taxRmfAssetIds: tags.rmf.length > 0 ? [...tags.rmf] : null, taxThaiEsgAssetIds: tags.thaiEsg.length > 0 ? [...tags.thaiEsg] : null };
}

/** สตางค์ → ข้อความที่ช่องเครื่องคิดภาษีอ่านกลับได้ตรงกัน เช่น "30,000.00" */
export function fillAmountText(satangValue: number): string {
  if (!Number.isSafeInteger(satangValue) || satangValue < 0 || Object.is(satangValue, -0)) throw new RangeError('ยอดที่จะเติมต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบ');
  return toBahtString(satang(satangValue));
}
