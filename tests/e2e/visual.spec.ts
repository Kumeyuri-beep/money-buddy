import { expect, test, type Page } from '@playwright/test';
import { openDesktopView } from './helpers/nav';

/**
 * เครื่องมือเทียบภาพก่อน/หลังแก้ CSS (โหมดสว่าง เฟส 1+): รันเมื่อตั้ง VISUAL=1 เท่านั้น (ไม่รันใน CI และไม่ใช่ส่วนของ `npm run e2e` ปกติ)
 * ภาพฐานเก็บใน .visual/ (ใน .gitignore) เพราะภาพต่าง OS/ฟอนต์ไม่ตรงกัน จึงไม่ commit
 *   สร้างภาพฐานจากโค้ดก่อนแก้:  VISUAL=1 npx playwright test visual --update-snapshots
 *   เทียบหลังแก้:               VISUAL=1 npx playwright test visual   (ต้องตรงกัน 100%: maxDiffPixels = 0)
 * เวลาแช่แข็ง ข้อมูลสมมติจาก harness · ธีม: ตั้งด้วย VISUAL_THEME=dark|light (ค่าเริ่มต้น dark; ใช้ emulateMedia colorScheme)
 */
// ไม่มี @types/node ในโปรเจกต์: ประกาศเฉพาะส่วนที่ใช้ (ตัวแปรสภาพแวดล้อมของ Node ตอนรัน Playwright)
declare const process: { env: Record<string, string | undefined> };

test.skip(process.env.VISUAL !== '1', 'ตั้ง VISUAL=1 เพื่อรันการเทียบภาพ');

const THEME = (process.env.VISUAL_THEME === 'light' ? 'light' : 'dark') as 'light' | 'dark';
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
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

test.use({ colorScheme: THEME, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });

/**
 * ทำให้ภาพนิ่งแน่นอนก่อนถ่าย (14 พ.ย. 2569 · แก้ภาพ select เดือนที่ติดๆ ดับๆ)
 * สาเหตุที่หาได้จากการทดลอง (รันซ้ำ 60 รอบต่อแบบ ภายใต้โหลด CPU หนัก ภาพที่ได้ต่างกัน 2 แบบ):
 *   ตัวหนังสือของ <select> ที่วาดแบบเนทีฟของเบราว์เซอร์ เลื่อนตำแหน่งไม่ถึง 1 พิกเซลเป็นบางรอบเมื่อเครื่องโหลดหนัก (ทั้งหน้ามีเฉพาะ select ที่ต่าง)
 *   ไม่ใช่ฟอนต์ (โหลดครบเสมอ) · ไม่ใช่เลย์เอาต์ (ขนาด/ตำแหน่งเท่ากัน) · ไม่ใช่ LCD/เกรย์สเกล · ไม่ใช่ blur/ชั้น compositor (ปิด blur หรือบังคับแยกชั้นแล้วยังเกิด)
 *   เมื่อวาด select แบบ appearance:none ภาพเหมือนกันทุกรอบ (60/60) ขณะที่ค่าเดิมผิด ~8% → เครื่องมือนี้ถ่ายด้วย appearance:none (ฐานภาพไม่มีลูกศรเนทีฟ) ส่วนหน้าตาจริงของ select ตรวจโดยเทสต์ layout/contrast
 * เพิ่มเติมตามที่เจ้าของสั่ง: ปิดอนิเมชัน/ทรานซิชันทั้งหมด (รวมพื้นหลังออโรรา) และรอฟอนต์โหลดเสร็จ + 2 เฟรมก่อนถ่ายทุกภาพ
 */
const STABLE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}select{appearance:none;-webkit-appearance:none}';

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
}

async function prepare(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-11-14T03:00:00Z')); // 10:00 เวลาไทย
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
  await page.addStyleTag({ content: STABLE_CSS });
}

async function openView(page: Page, view: (typeof VIEWS)[number], mobile: boolean): Promise<void> {
  if (view.id === 'today') return;
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: view.mobile, exact: true }).first().click();
    await expect(dialog).toBeHidden();
  } else {
    await openDesktopView(page, view.desktop);
  }
  await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
  await page.waitForTimeout(600);
}

for (const w of WIDTHS) {
  test.describe(`${THEME} ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });
    for (const view of VIEWS) {
      test(`หน้า ${view.id}`, async ({ page }) => {
        await prepare(page);
        await openView(page, view, w.mobile);
        await settle(page);
        await expect(page).toHaveScreenshot(`${view.id}-${w.width}.png`, { fullPage: true, maxDiffPixels: 0, animations: 'disabled', caret: 'hide' });
      });
    }
    if (w.mobile) {
      test('เมนู pop up', async ({ page }) => {
        await prepare(page);
        await page.getByRole('button', { name: 'เมนู', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(600);
        await settle(page);
        await expect(page).toHaveScreenshot(`menu-${w.width}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 });
      });
    }
  });
}

/** กล่องโต้ตอบ (dialog): เพิ่มรายการ / เพิ่มบิล (โหมดสว่าง เฟส 2 ใช้ตรวจสีทุก dialog) */
for (const w of WIDTHS.filter((x) => x.width !== 390)) {
  test.describe(`${THEME} dialog ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    test('dialog เพิ่มรายการ', async ({ page }) => {
      await prepare(page);
      if (w.mobile) {
        await page.getByRole('button', { name: 'เมนู', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
      } else {
        await page.getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
      }
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.waitForTimeout(600);
      await settle(page);
        await expect(page).toHaveScreenshot(`dialog-add-${w.width}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 });
    });

    test('dialog เพิ่มบิล', async ({ page }) => {
      await prepare(page);
      await openView(page, VIEWS[2], w.mobile);
      await page.getByRole('button', { name: /เพิ่มบิล/ }).first().click();
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.waitForTimeout(600);
      await settle(page);
        await expect(page).toHaveScreenshot(`dialog-bill-${w.width}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 });
    });
  });
}
