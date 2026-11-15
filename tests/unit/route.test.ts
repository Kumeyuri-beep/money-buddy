import { describe, expect, it } from 'vitest';
import { urlForView, usesHash, viewFromLocation } from '../../src/app/route';

describe('route (โหมด /invest และ /tax)', () => {
  it('อ่านหน้าจาก path: /invest → portfolio · /tax → tax · อื่นๆ = null', () => {
    expect(viewFromLocation({ pathname: '/invest', hash: '' })).toBe('portfolio');
    expect(viewFromLocation({ pathname: '/invest/', hash: '' })).toBe('portfolio');
    expect(viewFromLocation({ pathname: '/tax', hash: '' })).toBe('tax');
    expect(viewFromLocation({ pathname: '/', hash: '' })).toBeNull();
    expect(viewFromLocation({ pathname: '/unknown', hash: '' })).toBeNull();
    expect(viewFromLocation({ pathname: '/invest/extra', hash: '' })).toBeNull();
  });
  it('harness (.html) ใช้ hash แทน path', () => {
    expect(usesHash({ pathname: '/harness.html', hash: '' })).toBe(true);
    expect(usesHash({ pathname: '/invest', hash: '' })).toBe(false);
    expect(viewFromLocation({ pathname: '/harness.html', hash: '#/invest' })).toBe('portfolio');
    expect(viewFromLocation({ pathname: '/harness.html', hash: '#/tax' })).toBe('tax');
    expect(viewFromLocation({ pathname: '/harness.html', hash: '' })).toBeNull();
    expect(viewFromLocation({ pathname: '/harness.html', hash: '#/invest' })).toBe('portfolio');
  });
  it('สร้าง URL ปลายทาง: คง query เดิม · หน้าทั่วไปกลับไป "/" (harness: ไม่มี hash)', () => {
    expect(urlForView('portfolio', { pathname: '/', hash: '', search: '' })).toBe('/invest');
    expect(urlForView('tax', { pathname: '/invest', hash: '', search: '?a=1' })).toBe('/tax?a=1');
    expect(urlForView('ledger', { pathname: '/invest', hash: '', search: '' })).toBe('/');
    expect(urlForView('today', { pathname: '/tax', hash: '', search: '' })).toBe('/');
    expect(urlForView('portfolio', { pathname: '/harness.html', hash: '', search: '?seed=1' })).toBe('/harness.html?seed=1#/invest');
    expect(urlForView('today', { pathname: '/harness.html', hash: '#/tax', search: '?seed=1' })).toBe('/harness.html?seed=1');
  });
});
