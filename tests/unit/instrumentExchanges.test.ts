import { describe, expect, it } from 'vitest';
import { INSTRUMENT_EXCHANGES } from '../../src/domain/invest/types';

const migrations = import.meta.glob('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('ตลาดหุ้นที่แอปให้เลือกตรงกับ check ของฐานข้อมูล', () => {
  it('รายการเดียวกับ check ล่าสุดของคอลัมน์ assets.exchange ใน migration', () => {
    const checks = Object.keys(migrations)
      .sort()
      .flatMap((path) => [...migrations[path]!.matchAll(/exchange in \(([^)]*)\)/g)].map((m) => m[1]!));
    expect(checks.length).toBeGreaterThan(0);
    const allowed = [...checks.at(-1)!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...INSTRUMENT_EXCHANGES]).toEqual(allowed);
  });
});
