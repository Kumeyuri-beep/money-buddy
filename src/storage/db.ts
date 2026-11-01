import Dexie, { type EntityTable } from 'dexie';
import type { Account, Entry } from '../domain/ledger/types';

export const SCHEMA_VERSION = 1;

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * ฐานข้อมูลในเบราว์เซอร์ (IndexedDB) เก็บเฉพาะ "บัญชี" และ "รายการ"
 * ยอดคงเหลือไม่ถูกเก็บ แต่คำนวณจากรายการเสมอ (กฎ R16)
 * เปลี่ยนโครงสร้างตาราง: เพิ่ม this.version(2) พร้อม upgrade() ห้ามแก้ version(1)
 */
export class MoneyDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'money-buddy') {
    super(name);
    this.version(1).stores({
      accounts: 'id, type',
      entries: 'id, date, groupId',
      meta: 'key',
    });
  }
}
