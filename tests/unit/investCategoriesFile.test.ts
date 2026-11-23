import { describe, expect, it } from 'vitest';
import { buildCategoriesCsv, buildCategoriesJson, CATEGORIES_FILE_MAX_CHARS, parseCategoriesJson } from '../../src/domain/invest/categoriesFile';
import { draftsToCategories } from '../../src/domain/invest/categoriesView';
import type { Asset, AssetCategory } from '../../src/domain/invest/types';

// ข้อมูลสมมติทั้งหมด
const asset = (id: string, ticker: string, categoryId?: string): Asset => ({ id, name: `Demo ${ticker}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, ...(categoryId ? { categoryId } : {}) });
const cat = (id: string, name: string, targetBps: number | null, sortOrder: number): AssetCategory => ({ id, name, targetBps, sortOrder });
const CATS = [cat('c2', 'Income', 4000, 2), cat('c1', 'Growth', 6000, 1)];
const ASSETS = [asset('a', 'DEMA', 'c1'), asset('b', 'DEMB', 'c2'), asset('c', 'DEMC', 'c1'), asset('d', 'DEMD')];
let n = 0;
const mk = () => `id-${(n += 1)}`;

describe('buildCategoriesCsv', () => {
  it('หัวคอลัมน์ + แถวตามลำดับหมวด + เป้าเป็นเปอร์เซ็นต์จำนวนเต็มล้วน + หุ้นในหมวด (ไม่ส่งหุ้นไม่มีหมวด) · BOM + CRLF', () => {
    const csv = buildCategoriesCsv(CATS, ASSETS);
    expect(csv).toBe('﻿Category,Target (%),Stocks\r\nGrowth,60,DEMA; DEMC\r\nIncome,40,DEMB\r\n');
  });
  it('เป้าว่าง = ช่องว่าง · เป้า 7.5 และ 0.01 ไม่มี float · ไม่มีหมวด = เหลือแต่หัว', () => {
    expect(buildCategoriesCsv([cat('x', 'A', null, 0), cat('y', 'B', 750, 1), cat('z', 'C', 1, 2)], [])).toBe('﻿Category,Target (%),Stocks\r\nA,,\r\nB,7.5,\r\nC,0.01,\r\n');
    expect(buildCategoriesCsv([], ASSETS)).toBe('﻿Category,Target (%),Stocks\r\n');
  });
  it('กัน formula injection: ชื่อหมวดขึ้นต้น = + - @ ถูกนำหน้าด้วย \' · มีเครื่องหมายจุลภาค/คำพูดถูกครอบ', () => {
    const csv = buildCategoriesCsv([cat('x', '=SUM(A1)', null, 0), cat('y', 'Tech, "big"', null, 1), cat('z', '@cmd', null, 2)], []);
    expect(csv).toContain("\r\n'=SUM(A1),,\r\n");
    expect(csv).toContain('\r\n"Tech, ""big""",,\r\n');
    expect(csv).toContain("\r\n'@cmd,,\r\n");
  });
});

describe('JSON ไป-กลับ', () => {
  it('ส่งออกแล้วนำเข้า = หมวด เป้า และการจับคู่หุ้นเดิม (รหัสหมวดใหม่)', () => {
    n = 0;
    const r = parseCategoriesJson(buildCategoriesJson(CATS, ASSETS), ASSETS, mk);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skippedTickers).toBe(0);
    expect(r.state.drafts.map((d) => [d.name, d.targetText])).toEqual([['Growth', '60'], ['Income', '40']]);
    const gid = r.state.drafts[0]!.id;
    const iid = r.state.drafts[1]!.id;
    expect(r.state.assign).toEqual({ a: gid, c: gid, b: iid });
    expect(draftsToCategories(r.state.drafts).ok).toBe(true);
  });
  it('ticker ที่ไม่มีในบัญชีผู้ใช้ถูกข้ามและนับ · จับคู่ไม่สนตัวพิมพ์', () => {
    const text = JSON.stringify({ format: 'money-buddy-categories', version: 1, categories: [{ name: 'Only', target: null }], assignments: [{ ticker: 'dema', category: 'only' }, { ticker: 'ZZZZ', category: 'Only' }] });
    const r = parseCategoriesJson(text, ASSETS, mk);
    expect(r).toMatchObject({ ok: true, skippedTickers: 1 });
    if (r.ok) expect(r.state.assign).toEqual({ a: r.state.drafts[0]!.id });
  });
});

describe('parseCategoriesJson: ปฏิเสธไฟล์ที่ผิด', () => {
  const file = (o: Record<string, unknown>): string => JSON.stringify({ format: 'money-buddy-categories', version: 1, categories: [], assignments: [], ...o });
  it('ไม่ใช่ JSON / ไม่ใช่ไฟล์ของแอป / เวอร์ชันใหม่กว่า / ใหญ่เกิน', () => {
    expect(parseCategoriesJson('{not json', ASSETS, mk)).toEqual({ ok: false, problem: 'json' });
    expect(parseCategoriesJson('[]', ASSETS, mk)).toEqual({ ok: false, problem: 'format' });
    expect(parseCategoriesJson(file({ format: 'other' }), ASSETS, mk)).toEqual({ ok: false, problem: 'format' });
    expect(parseCategoriesJson(file({ version: 2 }), ASSETS, mk)).toEqual({ ok: false, problem: 'version' });
    expect(parseCategoriesJson(' '.repeat(CATEGORIES_FILE_MAX_CHARS + 1), ASSETS, mk)).toEqual({ ok: false, problem: 'size' });
  });
  it('โครงผิด: ฟิลด์หาย/ชนิดผิด/หมวดที่อ้างถึงไม่มี', () => {
    expect(parseCategoriesJson(file({ categories: 'x' }), ASSETS, mk)).toEqual({ ok: false, problem: 'shape' });
    expect(parseCategoriesJson(file({ categories: [{ target: '5' }] }), ASSETS, mk)).toEqual({ ok: false, problem: 'shape' });
    expect(parseCategoriesJson(file({ categories: [{ name: 'A', target: true }] }), ASSETS, mk)).toEqual({ ok: false, problem: 'shape' });
    expect(parseCategoriesJson(file({ categories: [{ name: 'A', target: null }], assignments: [{ ticker: 'DEMA', category: 'Nope' }] }), ASSETS, mk)).toEqual({ ok: false, problem: 'shape' });
    expect(parseCategoriesJson(file({ categories: [{ name: 'A', target: null }], assignments: [{ ticker: 5, category: 'A' }] }), ASSETS, mk)).toEqual({ ok: false, problem: 'shape' });
  });
  it('เป้า: 99.99 / 100.01 / ผิดรูป / ไม่ครบทุกหมวด ถูกปฏิเสธ · 100 พอดีผ่าน (ขอบเขต)', () => {
    const two = (a: string, b: string | null) => file({ categories: [{ name: 'A', target: a }, { name: 'B', target: b }] });
    expect(parseCategoriesJson(two('60', '39.99'), ASSETS, mk)).toEqual({ ok: false, problem: 'targetTotal' });
    expect(parseCategoriesJson(two('60', '40.01'), ASSETS, mk)).toEqual({ ok: false, problem: 'targetTotal' });
    expect(parseCategoriesJson(two('60', '4e1'), ASSETS, mk)).toEqual({ ok: false, problem: 'target' });
    expect(parseCategoriesJson(two('100', null), ASSETS, mk)).toEqual({ ok: false, problem: 'targetTotal' });
    expect(parseCategoriesJson(two('60', '40'), ASSETS, mk).ok).toBe(true);
    expect(parseCategoriesJson(file({ categories: [{ name: 'A', target: 100 }] }), ASSETS, mk).ok).toBe(true);
  });
  it('ชื่อ: ซ้ำไม่สนตัวพิมพ์ · ว่าง · มีอักขระควบคุม · 51 หมวด / 501 การจับคู่ = tooMany', () => {
    expect(parseCategoriesJson(file({ categories: [{ name: 'Tech', target: null }, { name: 'tech', target: null }] }), ASSETS, mk)).toEqual({ ok: false, problem: 'duplicateName' });
    expect(parseCategoriesJson(file({ categories: [{ name: '  ', target: null }] }), ASSETS, mk)).toEqual({ ok: false, problem: 'name' });
    expect(parseCategoriesJson(file({ categories: [{ name: 'A‮B', target: null }] }), ASSETS, mk)).toEqual({ ok: false, problem: 'name' });
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `C${i}`, target: null }));
    expect(parseCategoriesJson(file({ categories: many }), ASSETS, mk)).toEqual({ ok: false, problem: 'tooMany' });
    const manyA = Array.from({ length: 501 }, () => ({ ticker: 'DEMA', category: 'A' }));
    expect(parseCategoriesJson(file({ categories: [{ name: 'A', target: null }], assignments: manyA }), ASSETS, mk)).toEqual({ ok: false, problem: 'tooMany' });
    const fifty = Array.from({ length: 50 }, (_, i) => ({ name: `C${i}`, target: null }));
    expect(parseCategoriesJson(file({ categories: fifty }), ASSETS, mk).ok).toBe(true);
  });
  it('ผลลัพธ์ที่ผ่านต้องผ่าน draftsToCategories เสมอ (ไม่มีทางส่งชุดที่ฐานข้อมูลจะปฏิเสธ)', () => {
    const r = parseCategoriesJson(file({ categories: [{ name: 'A', target: '33.33' }, { name: 'B', target: '66.67' }] }), ASSETS, mk);
    expect(r.ok).toBe(true);
    if (r.ok) expect(draftsToCategories(r.state.drafts).ok).toBe(true);
  });
});
