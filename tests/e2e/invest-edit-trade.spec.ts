import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * แก้รายการลงทุนที่บันทึกแล้ว (R2 ข้อ 4 ส่วน B · เฉพาะคอม ≥1024px) · harness ?investDemo=tx (ข้อมูลสมมติในหน่วยความจำ ไม่ต่อฐานข้อมูล)
 * คอม: ปุ่ม Edit เปิดฟอร์มเดียวกับ Add เติมค่าเดิม → ตรวจผลกระทบก่อน→หลัง → ยืนยัน · ปุ่มที่แก้ไม่ได้ปิดพร้อมเหตุผล
 * มือถือ (<1024px): ปุ่ม Edit ปิดพร้อม "Available on desktop" กดแล้วไม่เปิดอะไรและไม่พัง
 */
async function openTx(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=tx#/invest/portfolio/transactions');
  await expect(page.getByRole('heading', { name: 'Transactions', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.tx-table')).toBeVisible();
}

for (const w of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test.describe(`แก้รายการ (คอม ${w.width}px)`, () => {
    test.use({ viewport: w, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('แก้ยอดซื้อ DEMA: ฟอร์มเติมค่าเดิม → ตรวจก่อน→หลัง → ยืนยัน แล้วตารางเปลี่ยน', async ({ page }) => {
      const seen = watch(page);
      await openTx(page);
      await page.getByRole('button', { name: /^Edit Buy DEMA/ }).click();
      const dialog = page.getByRole('dialog', { name: /Edit buy DEMA/ });
      await expect(dialog).toBeVisible();
      // ค่าเดิม: 30 หุ้น ลงทุน $3,000.00 ค่าธรรมเนียม $1.00 อัตรา 34
      await expect(dialog.getByLabel('Amount invested (USD)')).toHaveValue('3000.00');
      await expect(dialog.getByLabel('Shares (fractions allowed)')).toHaveValue('30');
      await expect(dialog.getByLabel('Fee (USD)')).toHaveValue('1.00');
      await expect(dialog.getByLabel(/^Exchange rate on that day/)).toHaveValue('34');

      await dialog.getByLabel('Amount invested (USD)').fill('3300.00');
      await dialog.getByRole('button', { name: 'Review change' }).click();
      const impact = dialog.getByTestId('edit-impact');
      await expect(impact).toBeVisible();
      // ต้นทุนเฉลี่ย: ก่อน $100.03 (ต้นทุน $3,001.00 ÷ 30) · หลัง $110.03 ($3,301.00 ÷ 30)
      const avg = impact.getByRole('row', { name: /Average cost per share/ });
      await expect(avg).toContainText('$100.03');
      await expect(avg).toContainText('$110.03');
      await expect(avg).toContainText('(changed)');
      await expect(impact.getByRole('row', { name: /Shares held/ })).not.toContainText('(changed)');
      await expect(impact.getByRole('row', { name: /Profit already realised/ })).toContainText('$0.00');

      await dialog.getByRole('button', { name: 'Back' }).click();
      await expect(dialog.getByLabel('Amount invested (USD)')).toHaveValue('3300.00'); // ย้อนกลับแล้วค่าที่กรอกยังอยู่
      await dialog.getByRole('button', { name: 'Review change' }).click();
      await dialog.getByRole('button', { name: 'Save changes' }).click();

      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('Transaction updated')).toBeVisible();
      await expect(page.getByRole('row', { name: /Buy.*DEMA/ })).toContainText('$3,300.00');
      expect(await overflowing(page), 'ล้นจอ').toEqual([]);
      expect(await obscured(page), 'ถูกบัง').toEqual([]);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('แก้ราคาขายล่าสุด DEMB: กำไรที่ขายแล้วเปลี่ยน', async ({ page }) => {
      await openTx(page);
      await page.getByRole('button', { name: /^Edit Sell DEMB/ }).click();
      const dialog = page.getByRole('dialog', { name: /Edit sell DEMB/ });
      await expect(dialog.getByLabel('Shares sold')).toHaveValue('5');
      await expect(dialog.getByLabel('Sale price per share (USD)')).toHaveValue('70');
      await dialog.getByLabel('Sale price per share (USD)').fill('90');
      await dialog.getByRole('button', { name: 'Review change' }).click();
      const row = dialog.getByTestId('edit-impact').getByRole('row', { name: /Profit already realised from price/ });
      await expect(row).toContainText('(changed)');
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Transaction updated')).toBeVisible();
    });

    test('ซื้อ DEMB ก่อนรายการขาย: ปุ่มปิดพร้อมเหตุผล กดแล้วไม่เปิดฟอร์ม', async ({ page }) => {
      await openTx(page);
      const edit = page.getByRole('button', { name: /^Edit Buy DEMB/ });
      await expect(edit).toHaveAttribute('aria-disabled', 'true');
      await edit.click({ force: true }); // aria-disabled: ผู้ใช้กดได้ และต้องเห็นเหตุผล
      await expect(page.getByRole('alert').filter({ hasText: 'Delete the later sale first' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('ข้อมูลผิด (ขายเกินที่ถือ): ตรวจก่อนบันทึก แสดงเหตุผลในฟอร์ม ไม่ไปขั้นยืนยัน', async ({ page }) => {
      await openTx(page);
      await page.getByRole('button', { name: /^Edit Sell DEMB/ }).click();
      const dialog = page.getByRole('dialog', { name: /Edit sell DEMB/ });
      await dialog.getByLabel('Shares sold').fill('999');
      await dialog.getByRole('button', { name: 'Review change' }).click();
      await expect(dialog.getByTestId('edit-problem')).toBeVisible();
      await expect(dialog.getByTestId('edit-impact')).toHaveCount(0);
    });

    test('Esc ปิดฟอร์มแก้ และโฟกัสกลับปุ่ม Edit', async ({ page }) => {
      await openTx(page);
      const edit = page.getByRole('button', { name: /^Edit Buy DEMA/ });
      await edit.click();
      await expect(page.getByRole('dialog', { name: /Edit buy DEMA/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(edit).toBeFocused();
    });

    test('แลกเงิน/เงินสด: ปุ่ม Edit ปิดพร้อมเหตุผล', async ({ page }) => {
      await openTx(page);
      const edit = page.getByRole('button', { name: /^Edit Currency exchange/ });
      await expect(edit).toHaveAttribute('aria-disabled', 'true');
      await expect(edit).toHaveAccessibleDescription(/cannot be edited yet/);
    });
  });
}

for (const w of [{ width: 360, height: 740 }, { width: 390, height: 844 }]) {
  test.describe(`แก้รายการ (มือถือ ${w.width}px: ปิดพร้อม Available on desktop)`, () => {
    test.use({ viewport: w, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ปุ่ม Edit ทุกแถวปิด กดแล้วขึ้นข้อความ ไม่เปิดฟอร์ม ไม่ล้นจอ', async ({ page }) => {
      const seen = watch(page);
      await openTx(page);
      const edits = page.getByRole('button', { name: /^Edit / });
      const n = await edits.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i += 1) await expect(edits.nth(i)).toHaveAttribute('aria-disabled', 'true');
      const dema = page.getByRole('button', { name: /^Edit Buy DEMA/ });
      await expect(dema).toHaveAccessibleDescription(/Available on desktop/);
      await dema.click({ force: true });
      await expect(page.getByRole('alert').filter({ hasText: 'Available on desktop' })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Review change' })).toHaveCount(0);
      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
      expect(seen.errors).toEqual([]);
    });
  });
}
