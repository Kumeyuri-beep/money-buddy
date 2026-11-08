/**
 * เลือกแหล่งข้อมูลหลังล็อกอิน (M2-D2) · ฟังก์ชันล้วน
 *
 * - online   : ใช้บัญชีออนไลน์ (ออนไลน์มีข้อมูล หรือว่างทั้งคู่ -> หน้าตั้งต้นออนไลน์)
 * - migrate  : ออนไลน์ว่าง + มีข้อมูลเดิมในเครื่องนี้ที่เป็นของบัญชีนี้ -> หน้าย้ายข้อมูล
 * - ask-bind : ออนไลน์ว่าง + มีข้อมูลเดิมที่ยังไม่มีเจ้าของ -> ถามก่อนว่าเป็นของบัญชีนี้ไหม
 * - verify   : นำเข้าแล้วแต่เจ้าของยังไม่ยืนยันว่ายอดตรง -> แสดงหน้าตรวจยอดต่อ (ไม่ข้ามไปแอปเงียบๆ)
 *
 * ข้อมูลเดิมในเครื่องที่เป็นของบัญชีอื่นไม่ถูกเสนอให้ใคร (ผู้ใช้นี้ใช้ออนไลน์ตั้งต้นใหม่) และไม่มีทางไหนลบข้อมูลในเครื่อง
 */
export type MigrationFlag = 'none' | 'pending' | 'confirmed';
export type DataSource = 'online' | 'migrate' | 'ask-bind' | 'verify';

export interface DataSourceInput {
  userId: string;
  onlineEmpty: boolean;
  localHasData: boolean;
  /** เจ้าของข้อมูลในเครื่อง (รหัสผู้ใช้) · null = ยังไม่ผูก */
  localOwner: string | null;
  flag: MigrationFlag;
}

export function chooseDataSource(input: DataSourceInput): DataSource {
  if (typeof input.userId !== 'string' || input.userId === '') throw new Error('ไม่ทราบว่าผู้ใช้คือใคร');
  const owner = typeof input.localOwner === 'string' && input.localOwner !== '' ? input.localOwner : null;
  // หน้าตรวจยอดอ่านข้อมูลเดิมในเครื่อง จึงเปิดได้เฉพาะเจ้าของข้อมูลนั้น (ธงใน localStorage แก้เองได้ ห้ามพาไปเห็นข้อมูลของคนอื่น)
  if (!input.onlineEmpty) return input.flag === 'pending' && owner === input.userId ? 'verify' : 'online';
  // ออนไลน์ว่าง: ธง pending ที่ค้างอยู่ไม่มีความหมาย (เช่น ล้างข้อมูลออนไลน์เพื่อนำเข้าใหม่) ให้ตัดสินจากข้อมูลในเครื่อง
  if (!input.localHasData) return 'online';
  if (owner === null) return 'ask-bind';
  return owner === input.userId ? 'migrate' : 'online';
}

const KEY_PREFIX = 'mb.migration.';

/** อ่านธงสถานะการย้ายข้อมูลของผู้ใช้นี้ (เก็บใน localStorage ของเบราว์เซอร์ ไม่ใช่ข้อมูลการเงิน) · อ่านไม่ได้ = none */
export function readMigrationFlag(storage: Pick<Storage, 'getItem'> | null, userId: string): MigrationFlag {
  try {
    const v = storage?.getItem(KEY_PREFIX + userId);
    return v === 'pending' || v === 'confirmed' ? v : 'none';
  } catch {
    return 'none';
  }
}

export function writeMigrationFlag(storage: Pick<Storage, 'setItem'> | null, userId: string, flag: MigrationFlag): void {
  try {
    storage?.setItem(KEY_PREFIX + userId, flag);
  } catch {
    /* เขียนไม่ได้ = ผู้ใช้เห็นหน้าตรวจยอดซ้ำได้ ไม่ทำให้ข้อมูลเสีย */
  }
}
