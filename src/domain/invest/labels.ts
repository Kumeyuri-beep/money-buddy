import type { AssetKind } from './types';

/** ชื่อไทยของชนิดสินทรัพย์ (รวมจากที่เคยประกาศซ้ำในหน้าพอร์ตและแถวสินทรัพย์) */
export const ASSET_KIND_LABEL: Record<AssetKind, string> = { fund: 'กองทุน', stock: 'หุ้น', other: 'อื่นๆ' };
