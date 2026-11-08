import { describe, expect, it } from 'vitest';
import { localDataAccess } from '../../src/app/localOwner';

/** ข้อมูลใน Dexie ของเครื่องนี้ผูกกับบัญชีเดียว (ก่อน M2-C ย้ายขึ้นฐานข้อมูลแยกตามผู้ใช้) */
describe('localDataAccess', () => {
  it('มีเจ้าของและตรงกับผู้ใช้ = เข้าได้', () => {
    expect(localDataAccess({ ownerId: 'u1', userId: 'u1', hasData: true })).toBe('allow');
    expect(localDataAccess({ ownerId: 'u1', userId: 'u1', hasData: false })).toBe('allow');
  });
  it('มีเจ้าของแต่เป็นคนอื่น = ปิดกั้น (แม้ฐานว่าง ก็ยังปิด ไม่ผูกทับ)', () => {
    expect(localDataAccess({ ownerId: 'u1', userId: 'u2', hasData: true })).toBe('blocked');
    expect(localDataAccess({ ownerId: 'u1', userId: 'u2', hasData: false })).toBe('blocked');
  });
  it('ยังไม่มีเจ้าของและฐานว่าง = ผูกให้เลย', () => {
    expect(localDataAccess({ ownerId: null, userId: 'u1', hasData: false })).toBe('bind');
  });
  it('ยังไม่มีเจ้าของแต่มีข้อมูลเดิม = ถามผู้ใช้ก่อนผูก', () => {
    expect(localDataAccess({ ownerId: null, userId: 'u1', hasData: true })).toBe('ask');
  });
  it('ค่าเจ้าของผิดชนิด/ว่าง ถือว่าไม่มีเจ้าของที่ใช้ได้ (ไม่ปล่อยผ่าน)', () => {
    expect(localDataAccess({ ownerId: '' as unknown as null, userId: 'u1', hasData: true })).toBe('ask');
    expect(localDataAccess({ ownerId: 5 as unknown as string, userId: 'u1', hasData: true })).toBe('ask');
  });
  it('ไม่มี userId = ปิดกั้น', () => {
    expect(localDataAccess({ ownerId: null, userId: '', hasData: false })).toBe('blocked');
  });
});
