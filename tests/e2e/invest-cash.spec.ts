import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * หน้า Portfolio → Cash (invest-v2 · แบบร่าง 24) บน harness ที่ใส่เงินสดสมมติด้วย ?investDemo=cash (src/dev/investDemo.ts) · ข้อมูลสมมติทั้งหมด
 * ตรวจ: ไม่ใช่ Coming soon · ยอดต่อสกุลและรวม · Change balance (ฝาก/ถอน/ตั้งยอด) · dialog เปิด/ปิดด้วย Esc คืนโฟกัส · สลับ USD/THB เลขเปลี่ยน · คำเตือนติดลบ · หน้าว่าง · ไม่ล้นจอ
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

async function openCash(page: Page, demo = 'cash'): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto(`/harness.html?seed=1&investDemo=${demo}#/invest/portfolio/cash`);
  await expect(page.getByRole('heading', { name: 'Cash', level: 2 })).toBeVisible({ timeout: 20_000 });
}

for (const w of WIDTHS) {
  test.describe(`Cash ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ไม่ใช่ Coming soon · มียอดต่อสกุล รวม กล่อง R23 และรายการเข้า/ออก · ไม่ล้นจอ', async ({ page }) => {
      const seen = watch(page);
      await openCash(page);
      await expect(page.locator('.iv-soon')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'How cash works' })).toContainText('not an expense');
      const usdRow = page.getByRole('row', { name: /US Dollar/ });
      await expect(usdRow).toBeVisible({ timeout: 20_000 });
      // เซนต์: 120.37 − 20.00 = 100.37 · แถวบาท 5,000.00
      await expect(page.getByRole('row', { name: /Thai Baht/ })).toContainText('฿5,000.00');
      await expect(page.getByRole('row', { name: /Total cash/ })).toContainText('$');
      await expect(page.getByRole('row', { name: /Deposit/ }).first()).toBeVisible();
      await expect(page.getByRole('row', { name: /Withdrawal/ })).toBeVisible();
      await expect(page.locator('.cs-warn')).toHaveCount(0);

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });

    test('dialog Change balance: เปิดด้วยปุ่ม ปิดด้วย Esc คืนโฟกัสให้ปุ่ม · ไม่ล้นจอตอนเปิด', async ({ page }) => {
      await openCash(page);
      const btn = page.getByRole('button', { name: 'Change balance', exact: true });
      await btn.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Change balance' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Amount (USD)').or(dialog.getByLabel('Amount (THB)'))).toBeFocused();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(w.width + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(btn).toBeFocused();
    });

    test('ฝากด้วยคีย์บอร์ด: ยอดและรายการเข้า/ออกเปลี่ยน', async ({ page }) => {
      await openCash(page);
      await page.getByRole('button', { name: 'Change USD balance' }).click();
      const dialog = page.getByRole('dialog', { name: 'Change balance' });
      await dialog.getByLabel('Amount (USD)').fill('50');
      await expect(dialog.getByRole('status').filter({ hasText: 'Deposit $50.00' })).toBeVisible();
      await dialog.getByLabel('Note (optional)').fill('top up');
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('Deposited $50.00')).toBeVisible();
      await expect(page.getByRole('row', { name: /US Dollar/ })).toContainText('$150.37');
      await expect(page.getByRole('row', { name: /top up/ })).toContainText('+$50.00');
    });

    test('Set balance to: ส่วนต่างเป็นถอน · ส่วนต่าง 0 ไม่บันทึก · ถอนเกินยอดแสดงข้อผิดพลาด', async ({ page }) => {
      await openCash(page);
      await page.getByRole('button', { name: 'Change USD balance' }).click();
      const dialog = page.getByRole('dialog', { name: 'Change balance' });
      await dialog.getByRole('button', { name: 'Set balance to' }).click();
      await dialog.getByLabel('New balance (USD)').fill('100.37');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog.getByText('nothing was saved')).toBeVisible();
      await expect(page.getByText(/^Deposited|^Withdrew/)).toHaveCount(0);
      await dialog.getByLabel('New balance (USD)').fill('90');
      await expect(dialog.getByRole('status').filter({ hasText: 'Withdraw $10.37 (balance becomes $90.00)' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('row', { name: /US Dollar/ })).toContainText('$90.00');
      // ถอนเกินยอด: ฐานข้อมูลปฏิเสธ (สมมติ) → ข้อความแจ้ง ไม่ปิด dialog
      await page.getByRole('button', { name: 'Change USD balance' }).click();
      await dialog.getByRole('button', { name: 'Withdraw', exact: true }).click();
      await dialog.getByLabel('Amount (USD)').fill('9999');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog.getByRole('alert')).toContainText('cannot be larger');
      await dialog.getByLabel('Amount (USD)').fill('0');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Enter an amount greater than 0');
    });

    test('dialog: Tab วนอยู่ใน dialog · ปุ่ม/ช่องกรอกสูง >= 44px · ตั้งยอดติดลบถูกปฏิเสธ · วันที่อนาคตมีข้อความบอก', async ({ page }) => {
      await openCash(page);
      await expect(page.getByRole('button', { name: 'Change USD balance' })).toBeVisible({ timeout: 20_000 });
      expect((await page.getByRole('button', { name: 'Change USD balance' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Change USD balance' }).click();
      const dialog = page.getByRole('dialog', { name: 'Change balance' });
      for (const loc of [dialog.locator('.cs-mode').first(), dialog.getByLabel('Amount (USD)'), dialog.getByLabel('Date'), dialog.getByLabel('Cash account')]) {
        expect((await loc.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      for (let i = 0; i < 14; i += 1) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
      await dialog.getByRole('button', { name: 'Set balance to' }).click();
      await expect(dialog.getByRole('button', { name: 'Set balance to' })).toHaveAttribute('aria-pressed', 'true');
      await dialog.getByLabel('New balance (USD)').fill('$-5');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog.getByRole('alert')).toContainText('0 or more');
      await expect(dialog.getByLabel('New balance (USD)')).toHaveAttribute('aria-invalid', 'true');
      await dialog.getByLabel('Date').fill('2099-01-01');
      await expect(dialog.getByText('This date is in the future')).toBeVisible();
    });

    test('สลับ ฿ THB / $ USD แล้วเลขเปลี่ยน', async ({ page }) => {
      await openCash(page);
      await page.getByRole('button', { name: '$ USD', exact: true }).click();
      const usdRow = page.getByRole('row', { name: /Thai Baht/ });
      await expect(usdRow).toContainText('$');
      await expect(page.getByRole('heading', { name: 'Cash balances in USD' })).toBeVisible();
      await page.getByRole('button', { name: '฿ THB', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Cash balances in THB' })).toBeVisible();
      await expect(page.getByRole('row', { name: /US Dollar/ })).toContainText('฿');
      await expect(page.getByRole('row', { name: /Total cash/ })).toContainText('฿');
    });

    test('USD ติดลบ: มีคำเตือนบนการ์ด (ข้อความ ไม่พึ่งสีอย่างเดียว)', async ({ page }) => {
      await openCash(page, 'cashneg');
      const warn = page.locator('.cs-warn');
      await expect(warn).toHaveCount(1, { timeout: 20_000 });
      await expect(warn).toContainText('Warning');
      await expect(warn).toContainText('below zero');
      await expect(warn).toContainText('−$');
    });

    test('ไม่มีบัญชีเงินสด: หน้าว่างบอกทางไป Holdings ไม่มีปุ่ม Change balance', async ({ page }) => {
      await openCash(page, '1');
      await expect(page.getByRole('heading', { name: 'No cash accounts yet' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Holdings page')).toBeVisible();
      await page.getByRole('link', { name: 'Go to Holdings' }).click();
      await expect(page.getByRole('heading', { name: 'Holdings', level: 2 })).toBeVisible();
      expect(new URL(page.url()).hash).toBe('#/invest/portfolio/holdings');
      await expect(page.getByRole('button', { name: 'Change balance', exact: true })).toHaveCount(0);
    });
  });
}
