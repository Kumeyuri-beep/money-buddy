import { describe, expect, it } from 'vitest';

// R25.3-R25.4: ผลตอบแทนไม่รวมเงินสด · ไฟล์คิดผลตอบแทนต้องไม่ import (ทั้งทางตรงและทางอ้อม) โมดูลสมุดบัญชี/เงินสด
// ถ้าใครเพิ่มการอ่านเงินสดเข้าสูตรผลตอบแทนโดยไม่ตั้งใจ เทสต์นี้จะล้มและบอกเส้นทางที่ import
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ENTRY = ['metrics.ts', 'twr.ts', 'reportSeries.ts', 'reportRows.ts'].map((f) => `/src/domain/invest/${f}`);
// โมดูลที่แตะสมุดบัญชี/เงินสด (ห้ามอยู่ในสายนำเข้าของไฟล์ผลตอบแทน)
const FORBIDDEN = [/\/domain\/ledger\//, /cashView/, /cashAdjustment/, /usdIntegrity/, /portfolioMoney/, /ledgerLink/, /transactionsView/, /holdingsView/];

/** แปลง specifier แบบ ./x หรือ ../y เป็นพาธ /src/... ที่มีอยู่จริง */
function resolveSpec(from: string, spec: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const base = parts.join('/');
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (cand in sources) return cand;
  return null;
}

function importsOf(file: string): string[] {
  const out: string[] = [];
  for (const m of sources[file]!.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1]!;
    if (!spec.startsWith('.')) continue;
    const dep = resolveSpec(file, spec);
    if (dep) out.push(dep);
  }
  return out;
}

/** ไฟล์ทั้งหมดที่ entry ดึงเข้ามา (ไฟล์ → ไฟล์ที่ import มา ไว้บอกเส้นทาง) */
function closure(entry: string): Map<string, string> {
  const seen = new Map<string, string>([[entry, '(entry)']]);
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop()!;
    for (const dep of importsOf(f)) {
      if (!seen.has(dep)) {
        seen.set(dep, f);
        stack.push(dep);
      }
    }
  }
  return seen;
}

describe('ไฟล์คิดผลตอบแทนไม่ import โมดูลสมุดบัญชี/เงินสด (ทางตรงและทางอ้อม)', () => {
  for (const entry of ENTRY) {
    it(entry.split('/').pop()!, () => {
      expect(entry in sources).toBe(true);
      const seen = closure(entry);
      const bad = [...seen.keys()].filter((f) => FORBIDDEN.some((re) => re.test(f)));
      expect(bad.map((f) => `${f} ← ${seen.get(f)}`), `${entry} import โมดูลที่แตะสมุดบัญชี/เงินสด`).toEqual([]);
    });
  }
  it('เทสต์นี้จับได้จริง: portfolioMoney.ts import สมุดบัญชี (ตัวอย่างบวก)', () => {
    const seen = closure('/src/domain/invest/portfolioMoney.ts');
    expect([...seen.keys()].some((f) => /\/domain\/ledger\//.test(f))).toBe(true);
  });
  it('ตัวแยก import เจอไฟล์จริง (ไม่ใช่ว่างทั้งที่ควรมี)', () => {
    expect(closure('/src/domain/invest/metrics.ts').size).toBeGreaterThan(5);
  });
});
