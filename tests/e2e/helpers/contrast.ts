import type { Page } from '@playwright/test';

/**
 * ตัวตรวจ contrast จากภาพที่เรนเดอร์จริง (ใช้ร่วมกันหลายสเปก): ซ่อนสีตัวหนังสือทั้งหน้า → ถ่ายภาพ → วัดสีพื้นหลังจริงใต้ตัวหนังสือแต่ละตัว
 * เทียบกับสีตัวหนังสือ (รวมความโปร่งใส/opacity) · เกณฑ์ WCAG AA 4.5 (ตัวใหญ่ 3) · ไม่นับปุ่มที่ปิดใช้งานและข้อความที่ถูกบัง
 */
export interface Item {
  text: string;
  fg: [number, number, number, number];
  large: boolean;
  key: string;
  rects: { x: number; y: number; w: number; h: number }[];
}

/** ข้อความที่มองเห็นอยู่ในจอตอนนี้ (พร้อมสีและตำแหน่ง) */
function collect(): Item[] {
  const out: Item[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const parse = (c: string): [number, number, number, number] => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return [0, 0, 0, 0];
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? '').trim();
    if (text === '') continue;
    const el = n.parentElement;
    if (!el) continue;
    if (el.closest('script,style,noscript,option,[aria-hidden="true"],[disabled],[aria-disabled="true"],fieldset[disabled]')) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const cs = getComputedStyle(el);
    const isSvg = el instanceof SVGElement;
    const fg = parse(isSvg ? cs.fill : cs.color);
    let opacity = 1;
    for (let p: Element | null = el; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
    fg[3] *= opacity;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects: Item['rects'] = [];
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 3 || r.height < 3) continue;
      const x0 = Math.max(r.left, 0);
      const y0 = Math.max(r.top, 0);
      const x1 = Math.min(r.right, vw);
      const y1 = Math.min(r.bottom, vh);
      if (x1 - x0 < r.width * 0.9 || y1 - y0 < r.height * 0.9) continue; // เห็นไม่ครบ: รอรอบเลื่อนถัดไป
      // ถูกบังโดยของอื่น (เช่น dialog หรือปุ่มเมนูลอยบนมือถือ): ตรวจ 5 จุด (มุมทั้งสี่ + กลาง) ถ้าจุดใดถูกบังให้รอรอบเลื่อนถัดไป
      const probes: [number, number][] = [[x0 + 1, y0 + 1], [x1 - 1, y0 + 1], [x0 + 1, y1 - 1], [x1 - 1, y1 - 1], [(x0 + x1) / 2, (y0 + y1) / 2]];
      const covered = probes.some(([px, py]) => {
        const hit = document.elementFromPoint(px, py);
        return !hit || !(hit === el || el.contains(hit) || hit.contains(el));
      });
      if (covered) continue;
      rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    if (rects.length === 0) continue;
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r0 = rects[0]!;
    out.push({ text, fg, large, key: `${text}|${Math.round(r0.x)}|${Math.round(r0.y + window.scrollY)}`, rects });
  }
  return out;
}

/** วัด contrast ของแต่ละข้อความจากภาพที่ซ่อนตัวหนังสือแล้ว: คืนรายการที่ต่ำกว่าเกณฑ์ */
async function analyze(b64: string, items: Item[]): Promise<string[]> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('โหลดภาพไม่ได้'));
    img.src = 'data:image/png;base64,' + b64;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const scale = img.naturalWidth / window.innerWidth;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const fails: string[] = [];
  for (const it of items) {
    let worst = Infinity;
    let worstBg = '';
    for (const r of it.rects) {
      const nx = Math.min(10, Math.max(2, Math.ceil(r.w / 8)));
      const ny = Math.min(3, Math.max(1, Math.ceil(r.h / 10)));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const px = Math.min(canvas.width - 1, Math.max(0, Math.round((r.x + ((i + 0.5) / nx) * r.w) * scale)));
          const py = Math.min(canvas.height - 1, Math.max(0, Math.round((r.y + (0.25 + ((j + 0.5) / ny) * 0.5) * r.h) * scale)));
          const d = ctx.getImageData(px, py, 1, 1).data;
          const a = it.fg[3];
          const fr = it.fg[0] * a + d[0]! * (1 - a);
          const fgc = it.fg[1] * a + d[1]! * (1 - a);
          const fb = it.fg[2] * a + d[2]! * (1 - a);
          const l1 = lum(fr, fgc, fb);
          const l2 = lum(d[0]!, d[1]!, d[2]!);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < worst) {
            worst = ratio;
            worstBg = `${d[0]},${d[1]},${d[2]}`;
          }
        }
      }
    }
    const need = it.large ? 3 : 4.5;
    if (worst < need) fails.push(`"${it.text.slice(0, 28)}" ${worst.toFixed(2)}:1 (ต้อง ${need}) ตัวหนังสือ rgba(${it.fg.map((v, k) => (k < 3 ? Math.round(v) : Number(v.toFixed(2)))).join(',')}) พื้น rgb(${worstBg})`);
  }
  return fails;
}

const HIDE_TEXT = '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}svg text{fill:transparent!important}::placeholder{color:transparent!important}';

/** เลื่อนดูทั้งหน้าทีละจอ แล้วตรวจข้อความทุกตัวที่เห็น */
export async function pageContrastFailures(page: Page): Promise<{ failures: string[]; checked: number }> {
  const failures: string[] = [];
  const seen = new Set<string>();
  const { total, vh } = await page.evaluate(() => ({ total: document.documentElement.scrollHeight, vh: window.innerHeight }));
  for (let y = 0; y < total; y += Math.floor(vh * 0.8)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
    const items = (await page.evaluate(collect)).filter((it) => !seen.has(it.key));
    if (items.length === 0) continue;
    for (const it of items) seen.add(it.key);
    const style = await page.addStyleTag({ content: HIDE_TEXT });
    const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    await style.evaluate((s: Element) => s.remove());
    failures.push(...(await page.evaluate(`(${analyze.toString()})(${JSON.stringify(shot.toString('base64'))}, ${JSON.stringify(items)})`) as string[]));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return { failures, checked: seen.size };
}

