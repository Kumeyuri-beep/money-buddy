import { describe, expect, it } from 'vitest';
import { FX_SELECTOR, fxPosition } from '../../src/ui/liquidGlass';

const files = import.meta.glob(['/src/ui/liquidGlass.ts', '/src/ui/styles.css', '/src/ui/LoginPage.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const js = files['/src/ui/liquidGlass.ts'] ?? '';
const css = (files['/src/ui/styles.css'] ?? '').replace(/\r\n/g, '\n');
const fxCss = css.slice(css.indexOf('/* liquid glass (14 พ.ย. 2569)'));

describe('fxPosition (ตำแหน่งแสงในการ์ด)', () => {
  const rect = { left: 100, top: 50, width: 300, height: 120 };
  it('พิกัดในการ์ด = ตำแหน่งสัมพัทธ์ (ปัดเป็นพิกเซลเต็ม)', () => {
    expect(fxPosition(rect, 160, 80)).toEqual({ x: 60, y: 30 });
    expect(fxPosition(rect, 160.4, 80.6)).toEqual({ x: 60, y: 31 });
  });
  it('นอกการ์ดถูกบีบเข้าขอบ · การ์ดขนาด 0 ไม่พัง', () => {
    expect(fxPosition(rect, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(fxPosition(rect, 999, 999)).toEqual({ x: 300, y: 120 });
    expect(fxPosition({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({ x: 0, y: 0 });
  });
});

describe('ข้อกำหนดของเอฟเฟกต์ (ล็อกไม่ให้หลุด)', () => {
  it('ไม่ขอสิทธิ์/ไม่ใช้เซ็นเซอร์ของเครื่อง', () => {
    const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // ไม่นับคอมเมนต์
    for (const banned of ['DeviceOrientation', 'DeviceMotion', 'requestPermission', 'Accelerometer', 'Gyroscope', 'navigator.']) expect(code, banned).not.toContain(banned);
  });
  it('ตัวฟังเดียวระดับเอกสาร แบบ passive และถอดได้ · เคารพ prefers-reduced-motion', () => {
    expect(js).toContain("doc.addEventListener('pointermove', onMove, { passive: true })");
    expect(js).toContain('(prefers-reduced-motion: reduce)');
    expect(js).toContain('requestAnimationFrame');
    expect((js.match(/addEventListener\('pointermove'/g) ?? []).length).toBe(1);
  });
  it('การ์ดที่ได้เอฟเฟกต์: กระจกแท้ + glass-lite แบบการ์ด (ไม่รวม Sankey ที่เลื่อนแนวนอนเอง) + การ์ดล็อกอิน', () => {
    expect(FX_SELECTOR).toBe('.glass, .glass-lite.card:not(.sankey), .auth-card');
  });
  it('CSS: อนิเมชัน/การเปลี่ยนใช้เฉพาะ transform กับ opacity (ไม่แตะ left/top/width/background ฯลฯ)', () => {
    expect(fxCss.length).toBeGreaterThan(500);
    const transitions = [...fxCss.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]!);
    for (const t of transitions) expect(t.replace(/[\d.]+s|ease(-out)?|linear/g, '').replace(/,/g, ' ').trim().split(/\s+/).sort().join(' '), t).toMatch(/^(opacity transform|opacity|transform)$/);
    const keyframes = [...fxCss.matchAll(/@keyframes (fx-[a-z]+) \{([\s\S]*?)\n\}/g)];
    expect(keyframes.length).toBe(2);
    for (const [, name, body] of keyframes) {
      const props = [...(body ?? '').matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).filter((p) => p !== undefined);
      for (const p of props) expect(['opacity', 'transform'], `${name}: ${p}`).toContain(p);
    }
  });
  it('CSS: ลดการเคลื่อนไหวและลดความโปร่งใส = ซ่อนแสงสะท้อน · ลอยเอง (drift) เฉพาะอุปกรณ์ไม่มีเมาส์และไม่ได้ลดการเคลื่อนไหว', () => {
    expect(fxCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*display: none/);
    expect(fxCss).toMatch(/@media \(prefers-reduced-transparency: reduce\) \{[^}]*display: none/);
    expect(fxCss).toContain('@media (hover: none) and (prefers-reduced-motion: no-preference)');
  });
  it('แสงอยู่ใต้ตัวหนังสือ (z-index -1) เพื่อไม่ลด contrast', () => {
    expect(fxCss).toMatch(/\.fx-shine \{[^}]*z-index: -1/);
  });
  it('หน้าล็อกอินมีองค์ประกอบแสง (ตกแต่ง aria-hidden)', () => {
    expect(files['/src/ui/LoginPage.tsx']).toContain('<span className="fx-shine-clip" aria-hidden="true">');
  });
});
