import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';

/**
 * เมนู dock (15 พ.ย. 2569): จอ ≥1024px เท่านั้น · 1280 และ 1440 × มืด/สว่าง
 * คีย์บอร์ดล้วน (Tab ถึงทุกปุ่ม · Enter/Space · tooltip ตอนโฟกัส · Esc) · เมาส์ขยายด้วย transform ไม่เปลี่ยนขนาดกล่อง · ลดการเคลื่อนไหว = ไม่ขยาย
 * ไม่บังเนื้อหาท้ายหน้า · ต่ำกว่า 1024px ไม่มี dock (มือถือ/แท็บเล็ตคงเดิม) · ใช้ข้อมูลสมมติจาก harness
 */
const LABELS = ['เพิ่มรายการ', 'ภาพรวม', 'รายรับ-รายจ่าย', 'บิลและเป้า', 'พอร์ตการลงทุน', 'วางแผนเกษียณ', 'คำนวณภาษี', 'ถัวเฉลี่ยต้นทุน', 'โปรไฟล์'];

async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-11-14T03:00:00Z'));
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
}

const dock = (page: Page) => page.locator('nav.dock');
const dockBtn = (page: Page, name: string) => dock(page).getByRole('button', { name, exact: true });
const tipOf = (page: Page, label: string) => page.locator(`nav.dock .dock-cell:has(button[aria-label="${label}"]) .dock-tip`);

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1280, 1440]) {
    test.describe(`dock ${theme} ${width}px`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme: theme, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });

      test('dock ลอยกลางล่าง · ปุ่มจริงครบ 9 ปุ่มชื่อไทย · แถบข้างไม่มีรายการเมนู · ปุ่มเพิ่มรายการไม่ซ้ำ', async ({ page }) => {
        await open(page);
        await expect(dock(page)).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toHaveCount(1); // เมนูแถบข้างถูกซ่อน (display: none) จึงเหลือ dock อันเดียวในต้นไม้การเข้าถึง
        for (const label of LABELS) await expect(dockBtn(page, label)).toBeVisible();
        expect(await dock(page).getByRole('button').count()).toBe(9);
        const box = (await dock(page).boundingBox())!;
        expect(Math.abs(box.x + box.width / 2 - width / 2), 'อยู่กลางจอ').toBeLessThan(2);
        expect(800 - (box.y + box.height), 'ลอยเหนือขอบล่าง').toBeGreaterThan(8);
        expect(await page.getByRole('button', { name: 'เพิ่มรายการ' }).count(), 'ปุ่มเพิ่มรายการเห็นได้ปุ่มเดียว (ของหัวหน้าซ่อน)').toBe(1);
        await expect(dockBtn(page, 'ภาพรวม')).toHaveAttribute('aria-current', 'page');
        // กระจกชั้นเดียว: ไม่มีบรรพบุรุษที่ blur ซ้อน
        const nested = await page.evaluate(() => {
          for (let p = document.querySelector('nav.dock')!.parentElement; p; p = p.parentElement) {
            const f = getComputedStyle(p).backdropFilter;
            if (f && f !== 'none') return true;
          }
          return false;
        });
        expect(nested).toBe(false);
      });

      test('คีย์บอร์ดล้วน: Tab ถึงทุกปุ่ม · tooltip ตอนโฟกัส · Enter/Space เปลี่ยนหน้า · Esc ซ่อน tooltip', async ({ page }) => {
        await open(page);
        // Tab จนโฟกัสเข้า dock (ของหน้าอื่นมาก่อน)
        let guard = 0;
        while (!(await page.evaluate(() => !!document.activeElement?.closest('nav.dock')))) {
          await page.keyboard.press('Tab');
          expect(++guard, 'ต้อง Tab ถึง dock ภายใน 80 ครั้ง').toBeLessThan(80);
        }
        const seen: string[] = [];
        for (let i = 0; i < LABELS.length; i++) {
          const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
          seen.push(label);
          const tip = tipOf(page, label);
          await expect(tip, `tooltip ของ ${label}`).toBeVisible();
          await expect(tip).toHaveText(label);
          if (i < LABELS.length - 1) await page.keyboard.press('Tab');
        }
        expect(seen).toEqual(LABELS);
        // contrast ของ tooltip ที่แสดงอยู่ (โหมดปัจจุบัน)
        const { failures } = await pageContrastFailures(page);
        expect(failures.filter((f) => /dock|โปรไฟล์/.test(f)).slice(0, 5)).toEqual([]);
        // Esc ซ่อน tooltip ชั่วคราว
        await page.keyboard.press('Escape');
        await expect(dock(page).locator('.dock-tip:visible')).toHaveCount(0);
        // Enter และ Space เปลี่ยนหน้า (ย้อนไปปุ่ม "รายรับ-รายจ่าย" ด้วย Shift+Tab 7 ครั้ง)
        for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+Tab');
        expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('รายรับ-รายจ่าย');
        await page.keyboard.press('Enter');
        await expect(dockBtn(page, 'รายรับ-รายจ่าย')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
        // หลังเปลี่ยนหน้า แอปย้ายโฟกัสไปเนื้อหาหลักตามมาตรฐานเดิม (เหมือนแถบข้าง ย้ายแบบไม่พร้อมกัน) · รอให้โฟกัสออกจาก dock ก่อน แล้วกลับเข้า dock ด้วยคีย์บอร์ดเพื่อทดสอบ Space
        await expect.poll(() => page.evaluate(() => !document.activeElement?.closest('nav.dock')), { timeout: 5000 }).toBe(true);
        await dockBtn(page, 'บิลและเป้า').focus();
        await page.keyboard.press('Space');
        await expect(dockBtn(page, 'บิลและเป้า')).toHaveAttribute('aria-current', 'page');
        await expect(dockBtn(page, 'รายรับ-รายจ่าย')).not.toHaveAttribute('aria-current', 'page');
      });

      test('ทางลัด "ข้ามไปเมนู": Tab ที่สองหลังโหลด → Enter โฟกัสไอคอนหน้าปัจจุบันใน dock', async ({ page }) => {
        await open(page);
        // เริ่มจากทางลัดแรก (ข้ามไปเนื้อหาหลัก) แล้ว Tab หนึ่งครั้งต้องถึง "ข้ามไปเมนู"
        await page.locator("a.skip-link").first().focus();
        await page.keyboard.press("Tab");
        await expect(page.getByRole('link', { name: 'ข้ามไปเมนู' })).toBeFocused();
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('ภาพรวม');
      });

      test('ลดความโปร่งใส: พื้น dock ทึบ ไม่โปร่งแสง', async ({ page }) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
        await open(page);
        const bg = await dock(page).evaluate((el) => ({ img: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
        expect(bg.img).toBe('none');
        expect(bg.blur).toBe('none');
        expect(bg.color).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/);
        expect(bg.color).toMatch(/^rgb\(/); // ทึบ 100% (rgb ไม่มี alpha)
      });

      test('ปุ่มเพิ่มรายการใน dock เปิดกล่องเพิ่มรายการด้วยคีย์บอร์ด (Enter)', async ({ page }) => {
        await open(page);
        await dockBtn(page, 'เพิ่มรายการ').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog')).toBeVisible();
      });

      test('เมาส์: ไอคอนใกล้เมาส์ใหญ่สุด ข้างๆ รองลงมา ไกลๆ ไม่ขยาย · ขนาดกล่อง layout ไม่เปลี่ยน · ไม่ทับกัน · ออกจาก dock แล้วกลับเดิม', async ({ page }) => {
        await open(page);
        const sizes = () =>
          page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.dock .dock-item')).map((b) => ({ w: b.offsetWidth, h: b.offsetHeight })));
        const rects = () =>
          page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.dock .dock-item')).map((b) => {
            const r = b.getBoundingClientRect();
            return { x: r.x, w: r.width, h: r.height, top: r.top };
          }));
        const before = await sizes();
        const rest = await rects();
        const target = 4; // พอร์ตการลงทุน (ปุ่มที่ 5 ในรายการ 9 ปุ่ม · index 4)
        const c = (await dockBtn(page, LABELS[target]!).boundingBox())!;
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
        await expect.poll(async () => (await rects())[target]!.w / rest[target]!.w, { timeout: 3000 }).toBeGreaterThan(1.45);
        await page.waitForTimeout(200); // ให้ transition ของตัวข้างๆ จบ
        const during = await rects();
        expect(await sizes(), 'offsetWidth/Height ต้องคงเดิม (ใช้ transform เท่านั้น)').toEqual(before);
        const ratio = during.map((r, i) => r.w / rest[i]!.w);
        expect(ratio[target]!, 'ใต้เมาส์ขยายมากสุด').toBeGreaterThan(1.45);
        expect(ratio[target - 1]!).toBeGreaterThan(1.05);
        expect(ratio[target - 1]!).toBeLessThan(ratio[target]!);
        expect(ratio[target + 1]!).toBeLessThan(ratio[target]!);
        expect(ratio[0]!, 'ไอคอนไกลสุดไม่ขยาย').toBeCloseTo(1, 1);
        expect(ratio[8]!).toBeCloseTo(1, 1);
        // ไม่ทับกัน
        for (let i = 0; i < during.length - 1; i++) expect(during[i]!.x + during[i]!.w, `ไอคอน ${i} ทับ ${i + 1}`).toBeLessThanOrEqual(during[i + 1]!.x + 0.5);
        // tooltip ของตัวที่ชี้อยู่ลอยเหนือไอคอนที่ขยาย ไม่ทับตัวมัน
        const tip = tipOf(page, LABELS[target]!);
        await expect(tip).toBeVisible();
        const tipBox = (await tip.boundingBox())!;
        expect(tipBox.y + tipBox.height, 'tooltip เหนือไอคอนที่ขยาย').toBeLessThanOrEqual(during[target]!.top + 1);
        // ออกจาก dock = กลับเดิม
        await page.mouse.move(width / 2, 300, { steps: 3 });
        await page.waitForTimeout(300);
        const after = await rects();
        after.forEach((r, i) => {
          expect(Math.abs(r.w - rest[i]!.w), `ไอคอน ${i} กลับขนาดเดิม`).toBeLessThan(0.6);
          expect(Math.abs(r.x - rest[i]!.x), `ไอคอน ${i} กลับตำแหน่งเดิม`).toBeLessThan(0.6);
        });
      });

      test('ลดการเคลื่อนไหว: ไม่ขยาย ตำแหน่งไม่กระโดด', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page);
        const rects = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.dock .dock-item')).map((b) => { const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
        const rest = await rects();
        const c = (await dockBtn(page, LABELS[4]!).boundingBox())!;
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
        await page.waitForTimeout(250);
        expect(await rects()).toEqual(rest);
        // tooltip ยังขึ้นตอนชี้ (ไม่ใช่การเคลื่อนไหว)
        await expect(tipOf(page, LABELS[4]!)).toBeVisible();
      });

      test('ไม่บังเนื้อหาท้ายหน้า: เลื่อนสุดแล้วเนื้อหาสุดท้ายอยู่เหนือ dock', async ({ page }) => {
        await open(page);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        const { contentBottom, dockTop } = await page.evaluate(() => ({
          contentBottom: document.querySelector('.content')!.getBoundingClientRect().bottom,
          dockTop: document.querySelector('nav.dock')!.getBoundingClientRect().top,
        }));
        expect(contentBottom, 'ขอบล่างของเนื้อหาต้องไม่ต่ำกว่าขอบบนของ dock').toBeLessThanOrEqual(dockTop);
      });

      test('ทุกหน้าที่เปิดผ่าน dock: คลิกเปลี่ยนหน้าได้ และไม่มี error ใน console', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await open(page);
        for (const label of LABELS.slice(1)) {
          await dockBtn(page, label).click();
          await expect(dockBtn(page, label)).toHaveAttribute('aria-current', 'page');
          await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
        }
        expect(errors).toEqual([]);
      });
    });
  }
}

test.describe('dock ต่ำกว่า 1024px: ไม่แสดง (มือถือ/แท็บเล็ตคงเดิม)', () => {
  for (const [w, h] of [[1023, 800], [900, 800], [390, 844]] as const) {
    test(`${w}px ไม่มี dock`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page);
      await expect(dock(page)).toBeHidden();
      if (w >= 721) {
        await expect(page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name: 'ภาพรวม' })).toBeVisible(); // แถบข้างเดิม
        await expect(page.getByRole('button', { name: 'เพิ่มรายการ' })).toBeVisible(); // ปุ่มของหัวหน้ายังอยู่
      } else {
        await expect(page.getByRole('button', { name: 'เมนู', exact: true })).toBeVisible(); // เมนู pop up เดิม
      }
    });
  }
  test('1024px มี dock พอดี และไม่ทับแถบข้าง', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await open(page);
    await expect(dock(page)).toBeVisible();
    const d = (await dock(page).boundingBox())!;
    const s = (await page.locator('aside.sidebar').boundingBox())!;
    expect(d.x, 'dock ไม่ซ้อนแถบข้างในแนวนอน').toBeGreaterThanOrEqual(s.x + s.width - 1);
    expect(d.x + d.width).toBeLessThanOrEqual(1024);
  });
});
