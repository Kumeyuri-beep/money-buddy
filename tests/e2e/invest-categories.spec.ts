import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * หน้า Portfolio → Categories ของ /invest (invest-v2 · แบบร่าง 25) บน harness ?investDemo=cat (src/dev/categoriesDemo.ts · เก็บใน sessionStorage จึงรีโหลดแล้วยังอยู่)
 * ตรวจ: ตั้งหมวดและเป้า → Save → รีโหลดยังอยู่ · เป้ารวมไม่ครบ Save ไม่ได้ · สร้างจาก sector · ลบหมวดแล้วสินทรัพย์เป็น Uncategorized · คีย์บอร์ดใช้ได้ · ไม่ล้นจอ
 * 1280/1440 = หลัก · 360/390 = ต้องไม่พัง · ข้อมูลสมมติทั้งหมด
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

async function open(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=cat#/invest/portfolio/categories');
  await expect(page.getByRole('heading', { name: 'Categories', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
}

async function reopen(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Categories', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
}

async function noOverflow(page: Page): Promise<void> {
  const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(doc.scroll, `page scrolls sideways (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
  expect(await overflowing(page), 'overflowing elements').toEqual([]);
  expect(await obscured(page), 'covered controls').toEqual([]);
}

const tableRow = (page: Page, name: string) => page.locator('.cg-table').getByRole('row', { name: new RegExp(`^${name}`) });

for (const w of WIDTHS) {
  test.describe(`Categories ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ยังไม่มีหมวด: ข้อความนำทาง ไม่ใช่ Coming soon · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await open(page);
      await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'No categories yet' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create categories from sectors' })).toBeEnabled();
      await noOverflow(page);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('สร้างจาก sector → ตารางต่อหมวด + Uncategorized (หุ้นไม่มี sector) → Save แล้วรีโหลดยังอยู่', async ({ page }) => {
      const seen = watch(page);
      await open(page);
      await page.getByRole('button', { name: 'Create categories from sectors' }).click();
      await expect(page.getByRole('heading', { name: 'Edit categories' })).toBeVisible();
      await expect(page.getByText(/Created 5 categories from sectors/)).toBeVisible();
      await noOverflow(page);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Categories saved.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Edit categories' })).toHaveCount(0);
      for (const n of ['Information Technology', 'Health Care', 'Communication Services', 'Consumer Staples', 'Real Estate', 'Uncategorized']) await expect(tableRow(page, n)).toBeVisible();
      await expect(tableRow(page, 'Information Technology')).toContainText('1 item');
      await expect(tableRow(page, 'Uncategorized')).toContainText('1 item');
      await expect(tableRow(page, 'Health Care')).toContainText('$');
      await noOverflow(page);

      await reopen(page);
      await expect(tableRow(page, 'Information Technology')).toBeVisible();
      await expect(tableRow(page, 'Uncategorized')).toBeVisible();
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('เป้ารวมไม่ครบ 100% = Save ไม่ได้ (บอกส่วนที่ขาด/เกิน) · ครบแล้ว Save ได้ · รีโหลดแล้วเป้ายังอยู่', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Change' }).click();
      await page.getByRole('button', { name: 'Add category' }).click();
      await page.getByRole('button', { name: 'Add category' }).click();
      const save = page.getByRole('button', { name: 'Save', exact: true });
      await expect(save).toBeEnabled(); // ยังไม่ตั้งเป้าเลย = บันทึกได้
      const names = page.getByLabel('Name', { exact: true });
      await names.nth(0).fill('Growth');
      await names.nth(1).fill('Income');
      const targets = page.getByLabel('Target %');

      await targets.nth(0).fill('60');
      await expect(page.locator('#cg-total')).toContainText('Set a target for every category');
      await expect(save).toBeDisabled();

      await targets.nth(1).fill('39.99');
      await expect(page.locator('#cg-total')).toContainText('Add 0.01% more to reach 100%');
      await expect(save).toBeDisabled();
      await targets.nth(1).fill('40.01');
      await expect(page.locator('#cg-total')).toContainText('Remove 0.01% to reach 100%');
      await expect(save).toBeDisabled();
      await targets.nth(1).fill('4x');
      await expect(page.locator('#cg-total')).toContainText('number from 0 to 100');
      await expect(save).toBeDisabled();

      await targets.nth(1).fill('40');
      await expect(page.locator('#cg-total')).toContainText('Targets total 100%');
      await expect(save).toBeEnabled();
      await noOverflow(page);
      await save.click();
      await expect(page.getByText('Categories saved.')).toBeVisible();
      await expect(tableRow(page, 'Growth')).toContainText('target 60%');
      await expect(tableRow(page, 'Income')).toContainText('target 40%');

      await reopen(page);
      await expect(tableRow(page, 'Growth')).toContainText('target 60%');
      await page.getByRole('button', { name: 'Change' }).click();
      await expect(page.getByLabel('Target %').first()).toHaveValue('60');
    });

    test('ย้ายหุ้นเข้าหมวด → ลบหมวด → หุ้นกลับเป็น Uncategorized · ยกเลิกไม่เปลี่ยนอะไร', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Change' }).click();
      await page.getByRole('button', { name: 'Add category' }).click();
      await page.getByLabel('Name', { exact: true }).first().fill('Core');
      await page.getByLabel('DEMA', { exact: false }).selectOption({ label: 'Core' });
      await page.getByLabel('DEMB', { exact: false }).selectOption({ label: 'Core' });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(tableRow(page, 'Core')).toContainText('2 items');
      await expect(tableRow(page, 'Uncategorized')).toContainText('4 items');

      await page.getByRole('button', { name: 'Change' }).click();
      await page.getByRole('button', { name: 'Cancel' }).click(); // ยกเลิก = ไม่เปลี่ยน
      await expect(page.getByRole('heading', { name: 'Edit categories' })).toHaveCount(0);
      await expect(tableRow(page, 'Core')).toContainText('2 items');

      await page.getByRole('button', { name: 'Change' }).click();
      await page.getByRole('button', { name: 'Delete Core' }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Categories saved.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No categories yet' })).toBeVisible();
      await reopen(page);
      await expect(page.getByRole('heading', { name: 'No categories yet' })).toBeVisible();
    });

    test('รวมหมวด: หุ้นและเป้าของหมวดแรกย้ายไปหมวดที่สอง', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Create categories from sectors' }).click();
      await page.getByLabel('Move everything from').selectOption({ label: 'Consumer Staples' });
      await page.getByLabel('into', { exact: true }).selectOption({ label: 'Health Care' });
      await page.getByRole('button', { name: 'Merge', exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Categories saved.')).toBeVisible();
      await expect(tableRow(page, 'Health Care')).toContainText('2 items');
      await expect(tableRow(page, 'Consumer Staples')).toHaveCount(0);
    });

    test('คีย์บอร์ด: Tab ไปปุ่ม Change แล้วกด Enter เปิดตัวแก้ · เพิ่มหมวดแล้วโฟกัสไปที่ช่องชื่อใหม่', async ({ page }) => {
      await open(page);
      const change = page.getByRole('button', { name: 'Change' });
      await change.focus();
      await expect(change).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Edit categories' })).toBeVisible();
      await page.getByRole('button', { name: 'Add category' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Name', { exact: true }).first()).toBeFocused();
      await page.getByRole('button', { name: 'Cancel' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Categories', level: 2, exact: true })).toBeFocused();
    });
  });
}
