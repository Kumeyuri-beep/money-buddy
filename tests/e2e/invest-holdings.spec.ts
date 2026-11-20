import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * หน้า Portfolio → Holdings ของ /invest (invest-v2 · แบบร่าง 20) ตอนมีข้อมูล: harness ใส่ข้อมูลสมมติด้วย ?investDemo=1 (src/dev/investDemo.ts)
 * ตรวจ: ตาราง 4 แท็บ · ไม่มีคอลัมน์ Daily · สลับ USD/THB แล้วตัวเลขเปลี่ยน · ค้นหา · เมนู ⋯ ครบ 4 รายการ · Delete มี confirm (ไม่ลบจริงบน harness)
 * ไม่ล้นจอที่ 360/390 (มือถือต้องไม่พัง) และ 1280/1440 (คอม) · ข้อมูลสมมติทั้งหมด
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

async function openHoldings(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=1#/invest/portfolio/holdings');
  await expect(page.getByRole('heading', { name: 'Holdings', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toBeVisible();
}

for (const w of WIDTHS) {
  test.describe(`Holdings ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ตาราง My holdings: 6 หุ้น + แถวรวม · ไม่มี Daily · สลับ USD/THB แล้วตัวเลขเปลี่ยน · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openHoldings(page);
      await expect(page.locator('.hd-table').getByRole('row')).toHaveCount(8); // หัวตาราง + 6 หุ้น + แถวรวม
      await expect(page.getByRole('columnheader', { name: 'Daily' })).toHaveCount(0);
      const first = page.getByRole('row', { name: /Demo Alpha Tech/ });
      await expect(first).toContainText('DEMA');
      await expect(first).toContainText('$');
      await expect(page.getByRole('row', { name: /Total · 6 holdings/ })).toContainText('$');
      const usdText = await first.innerText();

      await page.getByRole('button', { name: '฿ THB', exact: true }).click();
      await expect(first).toContainText('฿');
      expect(await first.innerText()).not.toBe(usdText);
      await expect(page.getByRole('row', { name: /Total · 6 holdings/ })).toContainText('฿');

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `page scrolls sideways (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'overflowing elements').toEqual([]);
      expect(await obscured(page), 'covered controls').toEqual([]);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('4 แท็บเปลี่ยนชุดคอลัมน์ · Returns แยก 6 แหล่งกำไร (USD: แหล่งค่าเงินเป็น "—") · คีย์บอร์ดลูกศรสลับแท็บได้', async ({ page }) => {
      await openHoldings(page);
      const tabs = page.getByRole('tablist', { name: 'Holdings columns' });
      for (const name of ['My holdings', 'General', 'Dividends', 'Returns']) await expect(tabs.getByRole('tab', { name })).toBeVisible();
      await expect(tabs.getByRole('tab', { name: 'My holdings' })).toHaveAttribute('aria-selected', 'true');

      await tabs.getByRole('tab', { name: 'General' }).click();
      for (const h of ['Weight', 'Avg cost / share', 'Last price']) await expect(page.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
      await tabs.getByRole('tab', { name: 'Dividends' }).click();
      for (const h of ['Dividends (12 months)', 'Yield', 'Yield on cost']) await expect(page.getByRole('columnheader', { name: h, exact: true })).toBeVisible();

      await tabs.getByRole('tab', { name: 'Returns' }).click();
      for (const h of ['Price (unrealized)', 'Price (realized)', 'Options', 'Dividends', 'Currency', 'Fees & tax', 'Total profit']) {
        await expect(page.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
      }
      await expect(page.getByText('The currency source is not shown in USD view')).toBeVisible();
      await page.getByRole('button', { name: '฿ THB', exact: true }).click();
      await expect(page.getByText('The currency source is not shown in USD view')).toHaveCount(0);

      await tabs.getByRole('tab', { name: 'Returns' }).focus();
      await page.keyboard.press('ArrowLeft');
      await expect(tabs.getByRole('tab', { name: 'Dividends' })).toBeFocused();
      await expect(tabs.getByRole('tab', { name: 'Dividends' })).toHaveAttribute('aria-selected', 'true');
    });

    test('แบบร่าง 20: อวาตาร์ตัวอักษรย่อ + บรรทัดล่างต่อหุ้น + แท็บ/ค้นหาแถวเดียวบนคอม · มือถือไม่เปลี่ยน (ซ่อน)', async ({ page }) => {
      await openHoldings(page);
      const row = page.getByRole('row', { name: /Demo Alpha Tech/ });
      const avatar = row.locator('.hd-avatar');
      const perShare = row.locator('.hd-persub');
      if (w.width >= 1024) {
        await expect(avatar).toBeVisible();
        await expect(avatar).toHaveText('DEMA');
        await expect(perShare.first()).toBeVisible();
        await expect(perShare.first()).toContainText('$100.03'); // ต้นทุนเฉลี่ยต่อหุ้น (domain คำนวณ)
        const tabs = await page.getByRole('tablist', { name: 'Holdings columns' }).boundingBox();
        const search = await page.getByRole('searchbox', { name: 'Search' }).boundingBox();
        expect(Math.abs((tabs!.y + tabs!.height / 2) - (search!.y + search!.height / 2))).toBeLessThan(20); // อยู่แถวเดียวกัน
      } else {
        await expect(avatar).toBeHidden();
        await expect(perShare.first()).toBeHidden();
      }
    });

    test('ค้นหา · เรียง · Show sold', async ({ page }) => {
      await openHoldings(page);
      await page.getByRole('searchbox', { name: 'Search' }).fill('beta');
      await expect(page.locator('.hd-table').getByRole('row')).toHaveCount(3); // หัวตาราง + 1 หุ้น + แถวรวม
      await expect(page.getByRole('row', { name: /Demo Beta Health/ })).toBeVisible();
      await page.getByRole('searchbox', { name: 'Search' }).fill('zzz');
      await expect(page.getByText('No holdings match your search.')).toBeVisible();
      await page.getByRole('searchbox', { name: 'Search' }).fill('');

      await page.getByRole('combobox', { name: 'Sort by' }).selectOption('value');
      await page.getByRole('button', { name: /Sort direction/ }).click(); // มาก → น้อย
      const firstName = await page.locator('.hd-table').getByRole('row').nth(1).getByRole('rowheader').innerText();
      expect(firstName).toContain('DEMA'); // 30 หุ้น × ราคาสูงสุดในข้อมูลสมมติ

      await page.getByRole('checkbox', { name: /Show sold/ }).check();
      await expect(page.getByRole('checkbox', { name: /Show sold/ })).toBeChecked();
    });

    test('Delete: Esc ปิด confirm แล้วโฟกัสกลับปุ่ม ⋯ · ปุ่ม Delete N records ลบจริง แถวหาย โฟกัสไปหัวข้อหน้า · Tab วนอยู่ในกรอบ', async ({ page }) => {
      await openHoldings(page);
      const more = page.getByRole('button', { name: 'Actions for DEMB' });
      await more.click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const dialog = page.getByRole('alertdialog', { name: /Delete DEMB/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Delete 1 record' })).toBeVisible(); // DEMB มี 1 รายการซื้อ
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused(); // วนกลับต้นกรอบ
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(more).toBeFocused();

      await more.click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('button', { name: 'Delete 1 record' }).click();
      await expect(page.getByText('Deleted DEMB: 1 record')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Holdings', level: 2, exact: true })).toBeFocused();
      // ลบรายการหมดแล้ว หุ้นถือ 0 หน่วย: ซ่อนเป็นค่าเริ่มต้น (เจ้าของสั่ง 20 พ.ย. 2569) แสดงเมื่อติ๊ก Show sold ตัวเลขเป็น 0
      await expect(page.getByRole('row', { name: /Demo Beta Health/ })).toHaveCount(0);
      await page.getByRole('checkbox', { name: /Show sold/ }).check();
      await expect(page.getByRole('row', { name: /Demo Beta Health/ }).getByRole('cell').first()).toHaveText('0');
      await expect(page.getByRole('row', { name: /Demo Beta Health/ })).toContainText('$0.00');
    });

    test('เมนู ⋯: 4 รายการ · Open holding ขยายรายละเอียด · Delete มี confirm และ Keep ไม่ลบ · Esc ปิดแล้วโฟกัสกลับปุ่ม', async ({ page }) => {
      await openHoldings(page);
      const more = page.getByRole('button', { name: 'Actions for DEMA' });
      await more.click();
      const menu = page.getByRole('menu', { name: 'Actions for DEMA' });
      await expect(menu.getByRole('menuitem')).toHaveText(['Add a transaction', 'Open holding', 'Edit', 'Delete']);
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused();

      await more.click();
      await menu.getByRole('menuitem', { name: 'Open holding' }).click();
      await expect(page.locator('dl[aria-label="Details of DEMA"]')).toBeVisible();

      await more.click();
      await menu.getByRole('menuitem', { name: 'Delete' }).click();
      const dialog = page.getByRole('alertdialog', { name: /Delete DEMA/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
      await dialog.getByRole('button', { name: 'Keep' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toBeVisible(); // ยังอยู่

      await more.click();
      await menu.getByRole('menuitem', { name: 'Add a transaction' }).click();
      await expect(page.getByRole('heading', { level: 2, name: /DEMA/ }).first()).toBeVisible();
    });
  });
}
