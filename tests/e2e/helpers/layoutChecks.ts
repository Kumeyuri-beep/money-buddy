import { expect, type Page } from '@playwright/test';

/** ตัวตรวจหน้าจอที่ใช้ร่วมกัน (คัดลอกจาก layout.spec.ts เพื่อไม่แก้สเปกเดิม): ไม่ล้นจอ · ปุ่มไม่ถูกบัง · เก็บ error/คำขอนอกเครื่อง */
/** เก็บ error ใน console / pageerror และคำขอที่ออกนอก localhost (ต้องไม่มี) */
export function watch(page: Page): { errors: string[]; external: string[] } {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  page.on('request', (r) => {
    const url = r.url();
    if (!/^(http:\/\/localhost:5199|data:|blob:|about:)/.test(url)) external.push(url.split('?')[0] ?? url);
  });
  return { errors, external };
}

export async function openHarness(page: Page): Promise<void> {
  // ห้ามออกนอกเครื่อง: บล็อกทุกอย่างที่ไม่ใช่ localhost (กันต่อ Supabase จริงถ้ามี .env ในเครื่อง)
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 }); // ข้อมูลสมมติโหลดแล้ว
}

/** องค์ประกอบที่ยื่นออกนอกความกว้างจอ (ไม่นับที่อยู่ในกล่องที่เลื่อนได้เอง และของตกแต่งที่ซ่อนจากผู้ใช้) */
export async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const clipped = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        // เฉพาะกล่องที่ผู้ใช้เลื่อนดูได้เอง (auto/scroll) · overflow hidden/clip ไม่นับ: ของที่ยื่นออกนอกจอแล้วถูกตัดทิ้งเงียบๆ คือเนื้อหาที่ผู้ใช้มองไม่เห็น ต้องจับ
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"], .sr-only, .skip-link, [hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) {
        out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} [${Math.round(r.left)}..${Math.round(r.right)}] "${(el.textContent ?? '').trim().slice(0, 30)}"`);
      }
      if (out.length >= 6) break;
    }
    return out;
  });
}

/** ปุ่ม/ลิงก์/ช่องกรอกที่ถูกองค์ประกอบอื่นบังที่จุดกึ่งกลาง (หลังเลื่อนให้อยู่กลางจอ) */
export async function obscured(page: Page, scope = 'main button, main a[href], main input:not([type=hidden]), main select, main textarea, main summary, aside button'): Promise<string[]> {
  return page.evaluate((selector) => {
    const out: string[] = [];
    const targets = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (const el of targets) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || (el as HTMLButtonElement).disabled) continue;
      if (el.closest('[hidden], .sr-only, details:not([open]) > :not(summary)')) continue;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      if (hit === el || el.contains(hit) || hit.contains(el)) continue;
      // label ที่ผูกกับช่องกรอก / ปุ่มที่ห่อด้วยลิงก์ ถือว่าไม่ใช่การบัง
      if (el instanceof HTMLInputElement && el.labels && Array.from(el.labels).some((l) => l.contains(hit))) continue;
      out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 30)}" ถูกบังโดย ${hit.tagName.toLowerCase()}${hit.className ? '.' + String(hit.className).split(' ')[0] : ''}`);
      if (out.length >= 6) break;
    }
    window.scrollTo(0, 0);
    return out;
  }, scope);
}

