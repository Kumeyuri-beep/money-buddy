import { expect, test, type Page } from '@playwright/test';

/** แท็บ "ย้ายเงิน" (เจ้าของสั่ง 14 พ.ย. 2569): ฟอร์มบันทึกรายการ ฟอร์มเร็ว ตัวกรองรายการ · ทั้งมืดและสว่าง · 360/1280 */
async function openApp(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
}

for (const theme of ['dark', 'light'] as const) {
  for (const w of [
    { width: 360, height: 740, mobile: true },
    { width: 1280, height: 800, mobile: false },
  ]) {
    test.describe(`ย้ายเงิน ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH' });

      test('ฟอร์มบันทึกรายการมีแท็บ "ย้ายเงิน" (ไม่มี "โอนเงิน") และเลือกแล้วขึ้นช่องกระเป๋าปลายทาง', async ({ page }) => {
        await openApp(page);
        if (w.mobile) {
          await page.getByRole('button', { name: 'เมนู', exact: true }).click();
          await page.getByRole('dialog').getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
        } else {
          await page.getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
        }
        const dialog = page.locator('dialog[open]');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('ย้ายเงิน', { exact: true }).first()).toBeVisible();
        await expect(dialog.getByText('โอนเงิน')).toHaveCount(0);
        await dialog.getByRole('radio', { name: 'ย้ายเงิน' }).check();
        await expect(dialog.getByLabel('ไปกระเป๋า')).toBeVisible();
      });

      test('ตัวกรองรายการมีตัวเลือก "ย้ายเงิน" และไม่มี "โอนเงิน"', async ({ page }) => {
        await openApp(page);
        if (w.mobile) {
          await page.getByRole('button', { name: 'เมนู', exact: true }).click();
          await page.getByRole('dialog').getByRole('button', { name: 'รายการ', exact: true }).first().click();
        } else {
          await page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name: 'รายรับ-รายจ่าย' }).click();
        }
        const options = await page.locator('.filters select option').allTextContents();
        expect(options).toContain('ย้ายเงิน');
        expect(options).not.toContain('โอนเงิน');
      });
    });
  }
}
