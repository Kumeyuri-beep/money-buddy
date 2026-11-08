import { describe, expect, it } from 'vitest';
import { chooseDataSource, readMigrationFlag, writeMigrationFlag, type DataSourceInput } from '../../src/app/dataSource';

const base: DataSourceInput = { userId: 'u1', onlineEmpty: true, localHasData: false, localOwner: null, flag: 'none' };
const pick = (over: Partial<DataSourceInput>) => chooseDataSource({ ...base, ...over });

describe('เลือกแหล่งข้อมูลหลังล็อกอิน', () => {
  it('ผู้ใช้ใหม่ ออนไลน์ว่าง ในเครื่องว่าง = ตั้งต้นออนไลน์', () => {
    expect(pick({})).toBe('online');
  });
  it('ออนไลน์มีข้อมูลแล้ว = ใช้ออนไลน์ แม้ในเครื่องมีข้อมูล (ไม่แตะ ไม่ย้ายซ้ำ)', () => {
    expect(pick({ onlineEmpty: false, localHasData: true, localOwner: 'u1' })).toBe('online');
    expect(pick({ onlineEmpty: false, localHasData: true, localOwner: 'u1', flag: 'confirmed' })).toBe('online');
  });
  it('ออนไลน์ว่าง + ข้อมูลในเครื่องเป็นของบัญชีนี้ = หน้าย้ายข้อมูล', () => {
    expect(pick({ localHasData: true, localOwner: 'u1' })).toBe('migrate');
  });
  it('ออนไลน์ว่าง + ข้อมูลในเครื่องยังไม่มีเจ้าของ = ถามก่อนผูก', () => {
    expect(pick({ localHasData: true, localOwner: null })).toBe('ask-bind');
    expect(pick({ localHasData: true, localOwner: '' })).toBe('ask-bind');
  });
  it('ข้อมูลในเครื่องเป็นของบัญชีอื่น = ไม่เสนอให้ผู้ใช้นี้ ตั้งต้นออนไลน์ของตัวเอง', () => {
    expect(pick({ localHasData: true, localOwner: 'someone-else' })).toBe('online');
  });
  it('นำเข้าแล้วแต่ยังไม่ยืนยันยอด (pending) = หน้าตรวจยอดต่อ ไม่ข้ามเข้าแอปเงียบๆ', () => {
    expect(pick({ onlineEmpty: false, flag: 'pending', localHasData: true, localOwner: 'u1' })).toBe('verify');
  });
  it('ธง pending ที่แก้เองแต่ไม่ใช่เจ้าของข้อมูลในเครื่อง = ไม่เปิดหน้าตรวจยอด (ไม่พาไปเห็นข้อมูลของคนอื่น)', () => {
    expect(pick({ onlineEmpty: false, flag: 'pending' })).toBe('online');
    expect(pick({ onlineEmpty: false, flag: 'pending', localHasData: true, localOwner: 'someone-else' })).toBe('online');
  });
  it('ธง pending แต่ออนไลน์ว่างแล้ว (ถูกล้างเพื่อนำเข้าใหม่) = ตัดสินจากข้อมูลในเครื่องตามปกติ', () => {
    expect(pick({ flag: 'pending', localHasData: true, localOwner: 'u1' })).toBe('migrate');
    expect(pick({ flag: 'pending' })).toBe('online');
  });
  it('ไม่ทราบผู้ใช้ = โยน error', () => {
    expect(() => pick({ userId: '' })).toThrow();
  });
});

describe('ธงสถานะการย้าย (localStorage)', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
  };
  it('เขียนแล้วอ่านกลับ แยกตามผู้ใช้ · ค่าแปลกถือเป็น none', () => {
    const s = memory();
    expect(readMigrationFlag(s, 'u1')).toBe('none');
    writeMigrationFlag(s, 'u1', 'pending');
    expect(readMigrationFlag(s, 'u1')).toBe('pending');
    expect(readMigrationFlag(s, 'u2')).toBe('none');
    s.map.set('mb.migration.u1', 'hacked');
    expect(readMigrationFlag(s, 'u1')).toBe('none');
  });
  it('storage ใช้ไม่ได้ (โหมดส่วนตัว/ถูกบล็อก) ไม่โยน error', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readMigrationFlag(broken, 'u1')).toBe('none');
    expect(() => writeMigrationFlag(broken, 'u1', 'pending')).not.toThrow();
    expect(readMigrationFlag(null, 'u1')).toBe('none');
    expect(() => writeMigrationFlag(null, 'u1', 'confirmed')).not.toThrow();
  });
});
