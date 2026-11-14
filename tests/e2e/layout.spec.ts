import { expect, test, type Page } from '@playwright/test';
import { openDesktopView } from './helpers/nav';

/**
 * เทสต์หน้าจอ: ไม่มีอะไรล้นจอ · ปุ่ม/ช่องกรอกไม่ถูกบัง · ไม่มี error ใน console · ไม่มีคำขอออกนอกเครื่อง
 * ความกว้าง 360 / 390 (มือถือ) และ 1280 (คอม) × ภาพรวม รายการ บิล พอร์ต ถัวเฉลี่ย เกษียณ ภาษี โปรไฟล์ + เมนู pop up (มือถือ)
 * ข้อมูลสมมติจาก harness (ห้ามข้อมูลการเงินจริง)
 */
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
] as const;

const VIEWS = [
  { id: 'today', desktop: 'ภาพรวม', mobile: 'ภาพรวม' },
  { id: 'ledger', desktop: 'รายรับ-รายจ่าย', mobile: 'รายการ' },
  { id: 'bills', desktop: 'บิลและเป้า', mobile: 'บิลและเป้า' },
  { id: 'portfolio', desktop: 'พอร์ตการลงทุน', mobile: 'พอร์ต' },
  { id: 'averaging', desktop: 'ถัวเฉลี่ยต้นทุน', mobile: 'ถัวเฉลี่ย' },
  { id: 'retirement', desktop: 'วางแผนเกษียณ', mobile: 'แผนเกษียณ' },
  { id: 'tax', desktop: 'คำนวณภาษี', mobile: 'ภาษี' },
  { id: 'account', desktop: 'โปรไฟล์', mobile: 'โปรไฟล์' },
] as const;

/** เก็บ error ใน console / pageerror และคำขอที่ออกนอก localhost (ต้องไม่มี) */
function watch(page: Page): { errors: string[]; external: string[] } {
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

async function openHarness(page: Page): Promise<void> {
  // ห้ามออกนอกเครื่อง: บล็อกทุกอย่างที่ไม่ใช่ localhost (กันต่อ Supabase จริงถ้ามี .env ในเครื่อง)
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 }); // ข้อมูลสมมติโหลดแล้ว
}

async function openView(page: Page, view: (typeof VIEWS)[number], mobile: boolean): Promise<void> {
  if (view.id === 'today') return;
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: view.mobile, exact: true }).first().click();
    await expect(dialog).toBeHidden();
  } else {
    await openDesktopView(page, view.desktop);
  }
  await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
  await page.waitForTimeout(400); // ให้หน้าที่โหลดแบบ lazy และข้อมูลแสดงครบ
}

/** องค์ประกอบที่ยื่นออกนอกความกว้างจอ (ไม่นับที่อยู่ในกล่องที่เลื่อนได้เอง และของตกแต่งที่ซ่อนจากผู้ใช้) */
async function overflowing(page: Page): Promise<string[]> {
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
async function obscured(page: Page, scope = 'main button, main a[href], main input:not([type=hidden]), main select, main textarea, main summary, aside button'): Promise<string[]> {
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

for (const w of WIDTHS) {
  test.describe(`ความกว้าง ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    for (const view of VIEWS) {
      test(`หน้า ${view.desktop}: ไม่ล้นจอ ปุ่มไม่ถูกบัง ไม่มี error`, async ({ page }) => {
        const seen = watch(page);
        await openHarness(page);
        await openView(page, view, w.mobile);
        const docWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        expect(docWidth.scroll, `หน้าเลื่อนแนวนอนได้ (scrollWidth ${docWidth.scroll} > ${docWidth.client})`).toBeLessThanOrEqual(docWidth.client + 1);
        expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
        expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
        expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
        expect(seen.errors, 'error ใน console').toEqual([]);
      });
    }

    if (w.mobile) {
      test('เมนู pop up: เปิดแล้วไม่ล้นจอ ทุกรายการกดได้ ไม่มี error', async ({ page }) => {
        const seen = watch(page);
        await openHarness(page);
        await page.getByRole('button', { name: 'เมนู', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(400); // รอแอนิเมชันเลื่อนขึ้น
        const box = await dialog.boundingBox();
        expect(box, 'เมนูต้องมีขนาด').not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(w.width + 1);
        expect(await dialog.getByRole('button').count(), 'ปุ่มในเมนู (8 หน้า + เพิ่มรายการ + ปิด)').toBeGreaterThanOrEqual(9);
        expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
        expect(await obscured(page, '[role=dialog] button'), 'ปุ่มในเมนูถูกบัง').toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        expect(seen.errors, 'error ใน console').toEqual([]);
        expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      });
    }
  });
}

test('จอคอม (1280): ไม่มีปุ่มเมนูลอยของมือถือ', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHarness(page);
  await expect(page.getByRole('button', { name: 'เมนู', exact: true })).toBeHidden();
});

/** ตัวตรวจต้องจับของเสียได้จริง (กันเทสต์ผ่านเปล่าๆ เพราะตัวตรวจหละหลวม) */
test.describe('ตัวตรวจจับได้จริง', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('จับองค์ประกอบที่ล้นจอ (แม้แอปซ่อน overflow แนวนอนที่ราก)', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.textContent = 'กล่องกว้างเกินจอ';
      d.style.cssText = 'width:900px;height:20px;background:#444';
      document.querySelector('#main')!.prepend(d);
    });
    expect((await overflowing(page)).length).toBeGreaterThan(0);
    // หมายเหตุ: scrollWidth ของหน้าอาจไม่เพิ่มเพราะแอปซ่อน overflow แนวนอนไว้ที่ราก (ของที่ล้นจะถูกตัดทิ้งเงียบๆ) จึงต้องพึ่งตัวตรวจรายองค์ประกอบด้านบน
  });

  test('จับปุ่มที่ถูกบัง', async ({ page }) => {
    await openHarness(page);
    await page.evaluate(() => {
      const o = document.createElement('div');
      o.className = 'fake-overlay';
      o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.01);z-index:99999';
      document.body.append(o);
    });
    expect((await obscured(page, 'main button')).length).toBeGreaterThan(0);
  });

  test('จับ error ใน console และคำขอออกนอกเครื่อง', async ({ page }) => {
    const seen = watch(page);
    await openHarness(page);
    await page.evaluate(() => {
      console.error('error จำลอง');
      void fetch('https://example.invalid/x').catch(() => undefined);
    });
    await page.waitForTimeout(300);
    expect(seen.errors.some((e) => e.includes('error จำลอง'))).toBe(true);
    expect(seen.external.some((u) => u.includes('example.invalid'))).toBe(true);
  });
});
