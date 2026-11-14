import { expect, test, type Page } from '@playwright/test';
import { openDesktopView } from './helpers/nav';
import { pageContrastFailures } from './helpers/contrast';

/**
 * โหมดสว่าง เฟส 4 (14 พ.ย. 2569): ทุกหน้า × 2 โหมด (มืด/สว่าง) × 360/390/1280 + เมนู pop up + dialog
 * ตรวจ "ตัวหนังสือมองไม่เห็น/contrast ต่ำ" จากภาพที่เรนเดอร์จริง: ซ่อนสีตัวหนังสือทั้งหน้าแล้วถ่ายภาพ → วัดสีพื้นหลังจริงใต้ตัวหนังสือทุกตัว
 * (รวมกระจก ไล่เฉด ฟิล์มแวววาว ก้อนแสง) แล้วเทียบกับสีตัวหนังสือ (รวมความโปร่งใสและ opacity) · เกณฑ์ WCAG AA: 4.5 (ตัวใหญ่ ≥ 24px หรือหนา ≥ 18.66px = 3)
 * ไม่นับ: ข้อความของปุ่มที่ปิดใช้งาน (ได้รับยกเว้นใน WCAG) · ข้อความที่ถูกบัง/อยู่นอกจอ · ใช้ข้อมูลสมมติจาก harness
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

async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-11-14T03:00:00Z'));
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
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
  await page.waitForTimeout(500);
}

for (const theme of ['dark', 'light'] as const) {
  for (const w of WIDTHS) {
    test.describe(`contrast ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });

      for (const view of VIEWS) {
        test(`หน้า ${view.desktop}: ไม่มีตัวหนังสือจางเกินเกณฑ์ WCAG AA`, async ({ page }) => {
          await open(page);
          await openView(page, view, w.mobile);
          const { failures, checked } = await pageContrastFailures(page);
          expect(checked, 'ต้องตรวจข้อความได้จริง (กันเทสต์ว่างเปล่า)').toBeGreaterThan(10);
          expect(failures.slice(0, 12), 'ข้อความที่ contrast ต่ำ').toEqual([]);
        });
      }

      if (w.mobile) {
        test('เมนู pop up: ตัวหนังสือชัด', async ({ page }) => {
          await open(page);
          await page.getByRole('button', { name: 'เมนู', exact: true }).click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.waitForTimeout(500);
          const { failures, checked } = await pageContrastFailures(page);
          expect(checked).toBeGreaterThan(5);
          expect(failures.slice(0, 12)).toEqual([]);
        });
      }

      test('dialog เพิ่มรายการ และ เพิ่มบิล: ตัวหนังสือชัด', async ({ page }) => {
        await open(page);
        if (w.mobile) {
          await page.getByRole('button', { name: 'เมนู', exact: true }).click();
          await page.getByRole('dialog').getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
        } else {
          await page.getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
        }
        await expect(page.locator('dialog[open]')).toBeVisible();
        await page.waitForTimeout(500);
        const add = await pageContrastFailures(page);
        expect(add.checked).toBeGreaterThan(5);
        expect(add.failures.slice(0, 12), 'dialog เพิ่มรายการ').toEqual([]);
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open]')).toBeHidden();
        await openView(page, VIEWS[2], w.mobile);
        await page.getByRole('button', { name: /เพิ่มบิล/ }).first().click();
        await expect(page.locator('dialog[open]')).toBeVisible();
        await page.waitForTimeout(500);
        const bill = await pageContrastFailures(page);
        expect(bill.checked).toBeGreaterThan(5);
        expect(bill.failures.slice(0, 12), 'dialog เพิ่มบิล').toEqual([]);
      });
    });
  }
}

test.describe('ตัวตรวจจับได้จริง (เทสต์ควบคุม)', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });

  test('จับตัวหนังสือจาง และตัวหนังสือสีเดียวกับพื้น (มองไม่เห็น) ได้ แต่ไม่จับตัวที่ชัดพอ', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:8px;top:8px;right:8px;z-index:99999;background:rgb(255,255,255);padding:6px';
      box.innerHTML =
        '<p style="color:rgb(170,170,170);margin:4px">ตัวหนังสือจางมาก</p>' +
        '<p style="color:rgb(255,255,255);margin:4px">ตัวหนังสือมองไม่เห็น</p>' +
        '<p style="color:rgb(18,21,31);margin:4px">ตัวหนังสือชัดเจน</p>';
      document.body.appendChild(box);
    });
    const { failures } = await pageContrastFailures(page);
    const joined = failures.join('\n');
    expect(joined).toContain('ตัวหนังสือจางมาก');
    expect(joined).toContain('ตัวหนังสือมองไม่เห็น');
    expect(joined).not.toContain('ตัวหนังสือชัดเจน');
  });
});

/** หน้าล็อกอิน (โคมไฟ): ตัวหนังสือชัดทั้งไฟเปิดและไฟปิด ทั้งสองโหมด */
for (const theme of ['dark', 'light'] as const) {
  for (const w of WIDTHS) {
    test.describe(`contrast ล็อกอิน ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH' });

      for (const lit of ['เปิดไฟ', 'ปิดไฟ'] as const) {
        test(`${lit}: ตัวหนังสือในฟอร์มชัด`, async ({ page }) => {
          await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
          await page.goto('/login-harness.html');
          await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
          if (lit === 'ปิดไฟ') await page.getByRole('button', { name: /ไฟบนหน้านี้/ }).click();
          await page.waitForTimeout(900); // รอการเปลี่ยนแสงเสร็จ
          const { failures, checked } = await pageContrastFailures(page);
          expect(checked).toBeGreaterThan(5);
          expect(failures.slice(0, 12)).toEqual([]);
        });
      }
    });
  }
}
