import { expect, test, type Page } from '@playwright/test';

/**
 * เมนู dock แนวตั้งซ้าย (15 พ.ย. 2569): จอ ≥1024px เท่านั้น · 1280 และ 1440 × มืด/สว่าง · ตัดแถบข้างทั้งแถบ
 * คีย์บอร์ดล้วน (Tab ถึงทุกปุ่ม · Enter/Space · tooltip ตอนโฟกัส · Esc · เมนูบัญชีใช้ลูกศร/Home/End/Esc/Tab ได้)
 * เมาส์ขยายแนวตั้งด้วย transform ไม่เปลี่ยนขนาดกล่อง ไม่ทับกัน · ลดการเคลื่อนไหว = ไม่ขยาย · ป้ายสถานะมุมขวาบน · เนื้อหาไม่ถูก dock บัง
 * ต่ำกว่า 1024px ไม่มี dock และแถบข้างเดิมยังอยู่ (มือถือ/แท็บเล็ตไม่เปลี่ยน) · ใช้ข้อมูลสมมติจาก harness
 */
const MENU = ['ภาพรวม', 'รายรับ-รายจ่าย', 'บิลและเป้า', 'พอร์ตการลงทุน', 'ถัวเฉลี่ยต้นทุน', 'วางแผนเกษียณ', 'คำนวณภาษี'];
const ORDER = ['เพิ่มรายการ', ...MENU, 'บัญชีของฉัน']; // ลำดับ Tab ภายใน dock

async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-11-14T03:00:00Z'));
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
}

const dock = (page: Page) => page.locator('nav.dock');
const dockBtn = (page: Page, name: string) => dock(page).getByRole('button', { name, exact: true });
const tipOf = (page: Page, label: string) => page.locator(`nav.dock .dock-cell:has(button[aria-label="${label}"]) .dock-tip`);
const activeLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1280, 1440]) {
    test.describe(`dock แนวตั้ง ${theme} ${width}px`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme: theme, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });

      test('ลอยซ้ายกึ่งกลางแนวตั้ง · โลโก้ + เพิ่มรายการ + 7 เมนู + บัญชี · แถบข้างถูกตัด · ปุ่มเพิ่มรายการไม่ซ้ำ', async ({ page }) => {
        await open(page);
        await expect(dock(page)).toBeVisible();
        await expect(page.locator('aside.sidebar')).toBeHidden(); // แถบข้างถูกตัดทั้งแถบที่ ≥1024
        await expect(page.getByRole('navigation', { name: 'เมนูหลัก' })).toHaveCount(1);
        await expect(dock(page).getByRole('img', { name: 'Money Buddy' })).toBeVisible();
        for (const label of [...MENU, 'เพิ่มรายการ', 'บัญชีของฉัน']) await expect(dockBtn(page, label)).toBeVisible();
        expect(await dock(page).getByRole('button').count(), '9 ปุ่ม: เพิ่มรายการ + 7 เมนู + บัญชี').toBe(9);
        const box = (await dock(page).boundingBox())!;
        expect(box.x, 'ชิดซ้ายห่างขอบ 20px').toBeCloseTo(20, 0);
        expect(box.width).toBeCloseTo(72, 0);
        expect(Math.abs(box.y + box.height / 2 - 400), 'กึ่งกลางแนวตั้ง').toBeLessThan(2);
        expect(box.y, 'ไม่ล้นบน').toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, 'ไม่ล้นล่าง').toBeLessThanOrEqual(800);
        expect(await page.getByRole('button', { name: 'เพิ่มรายการ' }).count(), 'ปุ่มเพิ่มรายการเห็นได้ปุ่มเดียว').toBe(1);
        await expect(dockBtn(page, 'ภาพรวม')).toHaveAttribute('aria-current', 'page');
        const nested = await page.evaluate(() => {
          for (let p = document.querySelector('nav.dock')!.parentElement; p; p = p.parentElement) {
            const f = getComputedStyle(p).backdropFilter;
            if (f && f !== 'none') return true;
          }
          return false;
        });
        expect(nested, 'กระจกชั้นเดียว ไม่ซ้อน blur').toBe(false);
      });

      test('สีพาสเทล: หน้าที่เปิดอยู่เป็นพื้นพาสเทลเต็ม + ขีดด้านซ้าย · แต่ละเมนูคนละสี · เปลี่ยนหน้าแล้วพาสเทลย้ายตาม', async ({ page }) => {
        await open(page);
        const colors = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('nav.dock .dock-list .dock-item:not(.dock-item-add)')).map((b) => ({ bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color, active: b.classList.contains('dock-item-active') })),
        );
        expect(colors).toHaveLength(7);
        const inactive = colors.filter((c) => !c.active);
        expect(new Set(inactive.map((c) => c.fg)).size, 'ไอคอนที่ไม่ได้เปิดอยู่ 6 ตัวต่างสีกัน').toBe(6);
        const active = colors.find((c) => c.active)!;
        expect(active.bg).toBe('rgb(255, 201, 168)'); // ภาพรวม #FFC9A8 พื้นเต็ม (ทั้ง 2 โหมด)
        expect(active.fg).toBe('rgb(31, 26, 43)'); // ไอคอนสีเข้ม
        expect(await dockBtn(page, 'ภาพรวม').evaluate((el) => getComputedStyle(el, '::before').width), 'ขีดข้างซ้าย').toBe('4px');
        await dockBtn(page, 'รายรับ-รายจ่าย').click();
        await expect(dockBtn(page, 'รายรับ-รายจ่าย')).toHaveAttribute('aria-current', 'page');
        expect(await dockBtn(page, 'รายรับ-รายจ่าย').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(168, 216, 255)'); // #A8D8FF
        expect(await dockBtn(page, 'ภาพรวม').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 201, 168)');
      });

      test('คีย์บอร์ดล้วน: Tab ถึงทุกปุ่มตามลำดับ · tooltip ทางขวาตอนโฟกัส · Esc ซ่อน · Enter/Space เปลี่ยนหน้า', async ({ page }) => {
        await open(page);
        let guard = 0;
        while (!(await page.evaluate(() => !!document.activeElement?.closest('nav.dock')))) {
          await page.keyboard.press('Tab');
          expect(++guard, 'ต้อง Tab ถึง dock ภายใน 80 ครั้ง').toBeLessThan(80);
        }
        const seen: string[] = [];
        for (let i = 0; i < ORDER.length; i++) {
          const label = await activeLabel(page);
          seen.push(label);
          {
            const tip = tipOf(page, label);
            await expect(tip, `tooltip ของ ${label}`).toBeVisible();
            await expect(tip).toHaveText(label);
            const tb = (await tip.boundingBox())!;
            const bb = (await dockBtn(page, label).boundingBox())!;
            expect(tb.x, `tooltip ของ ${label} อยู่ทางขวาของไอคอน`).toBeGreaterThan(bb.x + bb.width);
          }
          if (i < ORDER.length - 1) await page.keyboard.press('Tab');
        }
        expect(seen).toEqual(ORDER);
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Escape');
        await expect(dock(page).locator('.dock-tip:visible')).toHaveCount(0);
        await dockBtn(page, 'รายรับ-รายจ่าย').focus();
        await page.keyboard.press('Enter');
        await expect(dockBtn(page, 'รายรับ-รายจ่าย')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => !document.activeElement?.closest('nav.dock')), { timeout: 5000 }).toBe(true); // แอปย้ายโฟกัสไปเนื้อหาแบบไม่พร้อมกัน
        await dockBtn(page, 'บิลและเป้า').focus();
        await page.keyboard.press('Space');
        await expect(dockBtn(page, 'บิลและเป้า')).toHaveAttribute('aria-current', 'page');
      });

      test('ลำดับ Tab ตรงกับที่เห็น: dock (ซ้ายสุด) มาก่อนเนื้อหาหลักในต้นไม้', async ({ page }) => {
        await open(page);
        const before = await page.evaluate(() => Boolean(document.querySelector('nav.dock')!.compareDocumentPosition(document.querySelector('#main')!) & Node.DOCUMENT_POSITION_FOLLOWING));
        expect(before).toBe(true);
      });

      test('ทางลัด "ข้ามไปเมนู": Tab หนึ่งครั้งจากทางลัดแรก → Enter โฟกัสไอคอนหน้าปัจจุบัน', async ({ page }) => {
        await open(page);
        await page.locator('a.skip-link').first().focus();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'ข้ามไปเมนู' })).toBeFocused();
        await page.keyboard.press('Enter');
        expect(await activeLabel(page)).toBe('ภาพรวม');
      });

      test('เมนูบัญชี: ชื่อผู้ใช้ + สถานะตรวจบัญชี · ลูกศร/Home/End วนรายการ · Esc ปิดแล้วคืนโฟกัส · Tab ปิด · คลิกนอกปิด', async ({ page }) => {
        await open(page);
        const btn = dockBtn(page, 'บัญชีของฉัน');
        await expect(page.getByRole('menu')).toHaveCount(0);
        await btn.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu', { name: 'เมนูบัญชี' });
        await expect(menu).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.dock-menu .dock-menu-head .integrity-status')).toContainText('ตรวจบัญชี'); // หัวเมนูอยู่นอก role=menu (menu มีแต่ menuitem)
        await expect(page.locator('.dock-menu .dock-menu-name')).toHaveText('ผู้ทดสอบ');
        expect(await menu.locator(':scope > *').evaluateAll((els) => els.every((e) => e.getAttribute('role') === 'menuitem'))).toBe(true);
        await expect(menu.getByRole('menuitem')).toHaveCount(2);
        expect(await activeLabel(page)).toBe('โปรไฟล์และตั้งค่า');
        await page.keyboard.press('ArrowDown');
        expect(await activeLabel(page)).toBe('ออกจากระบบ');
        await page.keyboard.press('ArrowDown');
        expect(await activeLabel(page)).toBe('โปรไฟล์และตั้งค่า');
        await page.keyboard.press('ArrowUp');
        expect(await activeLabel(page)).toBe('ออกจากระบบ');
        await page.keyboard.press('Home');
        expect(await activeLabel(page)).toBe('โปรไฟล์และตั้งค่า');
        await page.keyboard.press('End');
        expect(await activeLabel(page)).toBe('ออกจากระบบ');
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(btn).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(menu).toHaveCount(0);
        expect(await page.evaluate(() => document.activeElement === document.body), 'Tab ออกจากเมนู โฟกัสต้องไม่หลุดไป body').toBe(false);
        expect(await page.evaluate(() => !document.activeElement?.closest('nav.dock')), 'โฟกัสไปองค์ประกอบถัดไปนอก dock').toBe(true);
        await btn.click();
        await expect(menu).toBeVisible();
        await page.mouse.click(width - 40, 400);
        await expect(menu).toHaveCount(0);
        await btn.click();
        await expect(menu).toBeVisible();
        await btn.click();
        await expect(menu).toHaveCount(0);
      });

      test('เมนูบัญชี: "โปรไฟล์และตั้งค่า" เปิดหน้าโปรไฟล์ (ปุ่มบัญชีมีวงทอง) · มีรายการ "ออกจากระบบ"', async ({ page }) => {
        await open(page);
        await dockBtn(page, 'บัญชีของฉัน').click();
        await page.getByRole('menuitem', { name: 'โปรไฟล์และตั้งค่า' }).click();
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
        await expect(dockBtn(page, 'บัญชีของฉัน')).toHaveClass(/dock-account-active/);
        for (const m of MENU) await expect(dockBtn(page, m)).not.toHaveAttribute('aria-current', 'page');
        await dockBtn(page, 'บัญชีของฉัน').click();
        await expect(page.getByRole('menuitem', { name: 'ออกจากระบบ' })).toBeVisible();
      });

      test('ป้ายสถานะตรวจบัญชีมุมขวาบนของเนื้อหา', async ({ page }) => {
        await open(page);
        const badge = page.locator('.status-row .integrity-status');
        await expect(badge).toBeVisible();
        await expect(badge).toContainText('ตรวจบัญชีผ่านทั้งหมด');
        const b = (await badge.boundingBox())!;
        const main = (await page.locator('#main').boundingBox())!;
        expect(b.x + b.width, 'ชิดขวาของเนื้อหา').toBeGreaterThan(main.x + main.width - 8);
        expect(b.y - main.y, 'บนสุดของเนื้อหา').toBeLessThan(20);
      });

      test('เมาส์: ขยายตามระยะแนวตั้ง (ใกล้สุดใหญ่สุด ข้างๆ รอง ไกลไม่ขยาย) · ขนาดกล่องไม่เปลี่ยน · ไม่ทับกัน · tooltip ทางขวา · ออกแล้วกลับเดิม', async ({ page }) => {
        await open(page);
        const sel = 'nav.dock .dock-list .dock-item';
        const sizes = () => page.evaluate((s) => Array.from(document.querySelectorAll<HTMLElement>(s)).map((b) => ({ w: b.offsetWidth, h: b.offsetHeight })), sel);
        const rects = () => page.evaluate((s) => Array.from(document.querySelectorAll<HTMLElement>(s)).map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }), sel);
        const before = await sizes();
        const rest = await rects();
        const target = 4; // พอร์ตการลงทุน (index 4 ในรายการ เพิ่มรายการ + 7 เมนู)
        const c = (await dockBtn(page, 'พอร์ตการลงทุน').boundingBox())!;
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
        await expect.poll(async () => (await rects())[target]!.h / rest[target]!.h, { timeout: 3000 }).toBeGreaterThan(1.38);
        await page.waitForTimeout(200);
        const during = await rects();
        expect(await sizes(), 'offsetWidth/Height ต้องคงเดิม (ใช้ transform เท่านั้น)').toEqual(before);
        const ratio = during.map((r, i) => r.h / rest[i]!.h);
        expect(ratio[target]!, 'ใต้เมาส์ขยายสูงสุด ~1.42').toBeLessThan(1.46);
        expect(ratio[target - 1]!).toBeGreaterThan(1.08);
        expect(ratio[target - 1]!).toBeLessThan(ratio[target]!);
        expect(ratio[target + 1]!).toBeLessThan(ratio[target]!);
        expect(ratio[0]!, 'ปุ่มไกลสุดไม่ขยาย').toBeCloseTo(1, 1);
        expect(ratio[7]!).toBeCloseTo(1, 1);
        for (let i = 0; i < during.length - 1; i++) expect(during[i]!.y + during[i]!.h, `ไอคอน ${i} ทับ ${i + 1}`).toBeLessThanOrEqual(during[i + 1]!.y + 0.8);
        const tip = tipOf(page, 'พอร์ตการลงทุน');
        await expect(tip).toBeVisible();
        const tb = (await tip.boundingBox())!;
        expect(tb.x, 'tooltip อยู่ทางขวาของไอคอนที่ขยาย').toBeGreaterThanOrEqual(during[target]!.x + during[target]!.w);
        await page.mouse.move(width / 2, 300, { steps: 3 });
        await page.waitForTimeout(300);
        const after = await rects();
        after.forEach((r, i) => {
          expect(Math.abs(r.h - rest[i]!.h), `ไอคอน ${i} กลับขนาดเดิม`).toBeLessThan(0.6);
          expect(Math.abs(r.y - rest[i]!.y), `ไอคอน ${i} กลับตำแหน่งเดิม`).toBeLessThan(0.6);
        });
      });

      test('ลดการเคลื่อนไหว: ไม่ขยาย ตำแหน่งไม่กระโดด (tooltip ยังขึ้น)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page);
        const rects = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.dock .dock-item')).map((b) => { const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
        const rest = await rects();
        const c = (await dockBtn(page, 'พอร์ตการลงทุน').boundingBox())!;
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
        await page.waitForTimeout(250);
        expect(await rects()).toEqual(rest);
        await expect(tipOf(page, 'พอร์ตการลงทุน')).toBeVisible();
      });

      test('ลดความโปร่งใส: พื้น dock ทึบ ไม่ blur', async ({ page }) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
        await open(page);
        const bg = await dock(page).evaluate((el) => ({ img: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
        expect(bg.img).toBe('none');
        expect(bg.blur).toBe('none');
        expect(bg.color).toMatch(/^rgb\(/);
      });

      test('เนื้อหาเว้นซ้ายพอไม่ถูก dock บัง · ไม่ล้นจอแนวนอน', async ({ page }) => {
        await open(page);
        const { contentLeft, dockRight, overflow } = await page.evaluate(() => ({
          contentLeft: document.querySelector('.content')!.getBoundingClientRect().left,
          dockRight: document.querySelector('nav.dock')!.getBoundingClientRect().right,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(contentLeft, 'เนื้อหาเริ่มหลังขอบขวาของ dock').toBeGreaterThanOrEqual(dockRight + 16);
        expect(overflow).toBeLessThanOrEqual(0);
      });

      test('ทุกหน้าที่เปิดผ่าน dock: คลิกเปลี่ยนหน้าได้ และไม่มี error ใน console', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await open(page);
        for (const label of MENU.slice(1)) {
          await dockBtn(page, label).click();
          await expect(dockBtn(page, label)).toHaveAttribute('aria-current', 'page');
          await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
        }
        expect(errors).toEqual([]);
      });

      test('ปุ่มเพิ่มรายการใน dock เปิดกล่องเพิ่มรายการด้วยคีย์บอร์ด (Enter)', async ({ page }) => {
        await open(page);
        await dockBtn(page, 'เพิ่มรายการ').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog')).toBeVisible();
      });
    });
  }
}

test.describe('ต่ำกว่า 1024px: ไม่มี dock และแถบข้างเดิมยังอยู่ (มือถือ/แท็บเล็ตไม่เปลี่ยน)', () => {
  for (const [w, h] of [[1023, 800], [900, 800], [390, 844], [360, 740]] as const) {
    test(`${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page);
      await expect(dock(page)).toBeHidden();
      await expect(page.locator('.status-row')).toBeHidden();
      await expect(page.locator('aside.sidebar')).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.page')!).paddingLeft)).toBe('20px');
      if (w >= 721) {
        await expect(page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name: 'โปรไฟล์' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'เพิ่มรายการ' })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'เมนู', exact: true })).toBeVisible();
      }
    });
  }
  test('1024px มี dock พอดี เนื้อหาไม่ซ้อน dock', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await open(page);
    await expect(dock(page)).toBeVisible();
    await expect(page.locator('aside.sidebar')).toBeHidden();
    const d = (await dock(page).boundingBox())!;
    const c = (await page.locator('.content').boundingBox())!;
    expect(c.x).toBeGreaterThanOrEqual(d.x + d.width + 16);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.y + d.height).toBeLessThanOrEqual(768);
  });
});
