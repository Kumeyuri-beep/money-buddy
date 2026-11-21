import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * หน้า Portfolio → Transactions ของ /invest (invest-v2 · แบบร่าง 21) · harness ใส่ข้อมูลสมมติด้วย ?investDemo=tx (src/dev/investDemo.ts)
 * ตรวจ: ตารางรวมทุกชนิด · สลับ USD/THB เลขเปลี่ยน + Needs rate · Filters/ค้นหา/ล้าง/ไม่มีผลลัพธ์ · เมนู Add ครบและไม่มี Fee or tax
 * · ลบมี confirm (Esc ปิดโฟกัสคืน · R17 ปฏิเสธพร้อมเหตุผล) · เตือนเงินสด USD ติดลบ · ไม่ล้นจอ 1280/1440 และ 360/390 · ข้อมูลสมมติทั้งหมด
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

async function openTx(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=tx#/invest/portfolio/transactions');
  await expect(page.getByRole('heading', { name: 'Transactions', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.tx-table')).toBeVisible();
}

for (const w of WIDTHS) {
  test.describe(`Transactions ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ตารางรวมทุกชนิด · ชิปยอดรวม · สลับ USD/THB แล้วเลขเปลี่ยน + Needs rate ที่แถวและ Incomplete ที่ยอด · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openTx(page);
      const rows = page.locator('.tx-table tbody tr');
      await expect(rows).toHaveCount(13); // ซื้อ 6 + ขาย 1 + ปันผล 2 + แลกเงิน 1 + โอน 1 + เงินเข้า 1 + เงินออก 1
      for (const kind of ['Buy', 'Sell', 'Dividend', 'Currency exchange', 'Transfer to portfolio', 'Cash deposit', 'Cash withdrawal']) {
        await expect(page.locator('.tx-table .tx-kind', { hasText: new RegExp(`^${kind}$`) }).first()).toBeVisible();
      }
      const sell = page.getByRole('row', { name: /Sell.*DEMB/ });
      await expect(sell).toContainText('$');
      const usdText = await sell.innerText();
      await expect(page.getByLabel(/^Totals for the/)).toContainText('$');

      await page.getByRole('button', { name: '฿ THB', exact: true }).click();
      await expect(sell).toContainText('฿');
      expect(await sell.innerText()).not.toBe(usdText);
      await expect(page.locator('.tx-needs').first()).toBeVisible();
      await expect(page.getByTestId('tx-needs-rate-note')).toBeVisible();
      await expect(page.getByLabel(/^Totals for the/)).toContainText('Incomplete');

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'ล้นจอ').toEqual([]);
      expect(await obscured(page), 'ถูกบัง').toEqual([]);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('เตือนเงินสด USD ติดลบ · ป้าย Average cost (R11)', async ({ page }) => {
      await openTx(page);
      await expect(page.getByTestId('tx-negative-cash')).toContainText('USD cash is negative');
      await expect(page.locator('.tx-r11')).toContainText('Average cost');
    });

    test('Filters: ค้นหา · ชนิด · สินทรัพย์ · ช่วงวันที่ · ล้างตัวกรอง · ไม่มีผลลัพธ์', async ({ page }) => {
      await openTx(page);
      const rows = page.locator('.tx-table tbody tr');
      const all = await rows.count();
      await page.getByRole('searchbox', { name: 'Search' }).fill('dema');
      await expect(rows).toHaveCount(2); // ซื้อ + ปันผลของ DEMA
      await page.getByRole('button', { name: 'Clear filters' }).first().click();
      await expect(rows).toHaveCount(all);

      await page.getByRole('button', { name: /^Filters/ }).click();
      await page.getByLabel('Type', { exact: true }).selectOption('sell');
      await expect(rows).toHaveCount(1);
      await page.getByLabel('Type', { exact: true }).selectOption('');
      await page.getByLabel('Asset', { exact: true }).selectOption({ label: 'DEMB' });
      await expect(rows).toHaveCount(2); // ซื้อ + ขาย
      await page.getByLabel('Asset', { exact: true }).selectOption('');
      await page.locator('#tx-f-from').fill('2026-06-01');
      await page.locator('#tx-f-to').fill('2026-06-30');
      await expect(rows).toHaveCount(1);
      await page.getByRole('searchbox', { name: 'Search' }).fill('zzzz-none');
      await expect(page.getByText('No transactions match your filters.')).toBeVisible();
      await page.getByRole('button', { name: 'Clear filters' }).last().click();
      await expect(rows).toHaveCount(all);

      await page.getByRole('tab', { name: 'Incomes' }).click();
      await expect(rows).toHaveCount(2);
      await page.getByRole('tab', { name: 'Trades' }).click();
      await expect(page.locator('.tx-table .tx-kind', { hasText: /^Dividend$/ })).toHaveCount(0);
    });

    test('เมนู Add: ครบ 7 รายการ (รวม Thai fund / Thai stock) ไม่มี Fee or tax · คีย์บอร์ด (Esc ปิดแล้วโฟกัสกลับ) · Buy เปิดตัวเลือกหุ้น', async ({ page }) => {
      await openTx(page);
      const add = page.getByRole('button', { name: 'Add', exact: true }).last();
      await add.click();
      const menu = page.getByRole('menu', { name: 'Add a transaction' });
      const items = menu.getByRole('menuitem');
      await expect(items).toHaveCount(7);
      for (const n of ['Buy', 'Sell', 'Dividend', 'Cash deposit / withdrawal', 'Transfer to / from portfolio', 'Currency exchange', 'Thai fund / Thai stock']) await expect(menu.getByRole('menuitem', { name: n, exact: true })).toBeVisible();
      await expect(menu.getByText(/fee or tax/i)).toHaveCount(0);
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(add).toBeFocused();

      await add.click();
      await menu.getByRole('menuitem', { name: 'Buy', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Buy: choose a stock' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Buy: choose a stock' })).toBeHidden();
    });

    test('ลบ: confirm · Esc ปิดแล้วโฟกัสกลับปุ่มลบ · ผิด R17 ปฏิเสธพร้อมเหตุผล · ลบขายล่าสุดได้', async ({ page }) => {
      await openTx(page);
      const rows = page.locator('.tx-table tbody tr');
      const before = await rows.count();

      // ซื้อ DEMB เกิดก่อนการขาย → ลบไม่ได้ (R17)
      const buyDelete = page.getByRole('button', { name: /^Delete Buy DEMB/ });
      await buyDelete.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText('Cannot delete');
      await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(buyDelete).toBeFocused();
      await expect(rows).toHaveCount(before);

      // ขายล่าสุดลบได้
      const sellDelete = page.getByRole('button', { name: /^Delete Sell DEMB/ });
      await sellDelete.click();
      await expect(dialog).toContainText('Delete sell');
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(sellDelete).toBeFocused();
      await sellDelete.click();
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(rows).toHaveCount(before - 1);
      await expect(page.getByText(/Deleted sell on/)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Transactions', level: 2 })).toBeFocused();
    });

    test('Add → Thai fund / Thai stock เปิดฟอร์มเดิม (Add fund/stock) · Close โฟกัสกลับปุ่ม Add', async ({ page }) => {
      await openTx(page);
      const add = page.getByRole('button', { name: 'Add', exact: true }).last();
      await add.click();
      await page.getByRole('menuitem', { name: 'Thai fund / Thai stock' }).click();
      const group = page.getByRole('group', { name: 'Thai fund or Thai stock' });
      await expect(group).toBeFocused();
      await expect(group.getByRole('heading', { name: 'Add fund/stock' })).toBeVisible();
      await group.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(group).toBeHidden();
      await expect(add).toBeFocused();
    });

    test('แผง Transfer เปิดอยู่: พิมพ์ในช่อง Search โฟกัสไม่เด้งกลับ · Esc ปิดแล้วโฟกัสกลับปุ่ม Add', async ({ page }) => {
      await openTx(page);
      const add = page.getByRole('button', { name: 'Add', exact: true }).last();
      await add.click();
      await page.getByRole('menuitem', { name: 'Transfer to / from portfolio' }).click();
      const group = page.getByRole('group', { name: 'Transfer to or from portfolio' });
      await expect(group).toBeFocused();
      const search = page.getByRole('searchbox', { name: 'Search' });
      await search.click();
      await page.keyboard.type('dema');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('dema');
      await page.getByRole('button', { name: 'Close', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(add).toBeFocused();
    });

    test('เครื่องหมายคอลัมน์ Value: Buy − · Sell + · Cash withdrawal −', async ({ page }) => {
      await openTx(page);
      await expect(page.getByRole('row', { name: /Buy.*DEMA/ }).locator('td').nth(4)).toContainText(/^\u2212\$/);
      await expect(page.getByRole('row', { name: /Sell.*DEMB/ }).locator('td').nth(4)).toContainText(/^\+\$/);
      await expect(page.getByRole('row', { name: /Cash withdrawal/ }).locator('td').nth(4)).toContainText(/^\u2212\$/);
    });

    test('Edit กดแล้วมีข้อความบอก (role=status) · confirm ลบบอกว่าลบอะไร', async ({ page }) => {
      await openTx(page);
      await page.getByRole('button', { name: /^Edit Sell DEMB/ }).click({ force: true });
      await expect(page.getByText('Editing is not available yet. Delete and add it again.').first()).toBeVisible();
      await page.getByRole('button', { name: /^Delete Sell DEMB/ }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Sell DEMB · 10 Jun 2026 · 5 shares');
    });

    test('ปุ่ม Edit ปิดพร้อมคำอธิบาย (ยังไม่มีการแก้รายการที่บันทึกแล้ว)', async ({ page }) => {
      await openTx(page);
      const edit = page.getByRole('button', { name: /^Edit Sell DEMB/ });
      await expect(edit).toHaveAttribute('aria-disabled', 'true');
      await expect(edit).toHaveAccessibleDescription(/not available yet/);
    });
  });
}
