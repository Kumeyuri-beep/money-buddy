import Dexie, { type EntityTable } from 'dexie';
import type { Account, Entry } from '../domain/ledger/types';

import type { Bill } from '../domain/bills/types';

export const SCHEMA_VERSION = 2;

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * ฐานข้อมูลในเบราว์เซอร์ (IndexedDB) เก็บเฉพาะ "บัญชี" และ "รายการ"
 * ยอดคงเหลือไม่ถูกเก็บ แต่คำนวณจากรายการเสมอ (กฎ R16)
 * v2 เพิ่มตาราง bills (บิลประจำ) ค่าตั้งค่าเก็บใน meta แถว 'settings'
 * เปลี่ยนโครงสร้างตาราง: เพิ่ม this.version(n+1) พร้อม upgrade() ห้ามแก้ version ที่ปล่อยไปแล้ว
 */
export class MoneyDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  bills!: EntityTable<Bill, 'id'>;

  constructor(name = 'money-buddy') {
    super(name);
    this.version(1).stores({
      accounts: 'id, type',
      entries: 'id, date, groupId',
      meta: 'key',
    });
    this.version(2)
      .stores({ bills: 'id' })
      .upgrade(async (tx) => {
        // Snapshot ก่อน migration (R6): คัดลอกข้อมูล v1 ลง meta ในธุรกรรมเดียวกับการอัปเกรด
        // ถ้าคัดลอกไม่สำเร็จ การอัปเกรดทั้งก้อนถูกยกเลิก ข้อมูล v1 อยู่ครบ
        const accounts = await tx.table('accounts').toArray();
        const entries = await tx.table('entries').toArray();
        if (accounts.length > 0 || entries.length > 0) {
          await tx.table('meta').put({
            key: 'snapshot:v1',
            value: { schemaVersion: 1, takenAt: new Date().toISOString(), accounts, entries },
          });
        }
        // ตารางใหม่เท่านั้น ไม่แปลงข้อมูลเดิม แค่ยกเลขเวอร์ชันถ้าเคยบันทึกไว้
        if (await tx.table('meta').get('schemaVersion')) {
          await tx.table('meta').put({ key: 'schemaVersion', value: 2 });
        }
      });
  }
}
