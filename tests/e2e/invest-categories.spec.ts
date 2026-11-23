import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';
import { goInvest } from './helpers/investNav';

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

    test('ช่อง Sector ในฟอร์มเพิ่มหุ้น: คอมมี (เลือกจากรายการหรือพิมพ์เอง) แล้วไปอยู่ในหมวดที่สร้างจาก sector · มือถือฟอร์มไม่เปลี่ยน (ไม่มีช่องนี้)', async ({ page }) => {
      const seen = watch(page);
      await page.route((url) => !/^(localhost|127.0.0.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=cat#/invest/portfolio/holdings');
      await expect(page.getByRole('heading', { name: 'Holdings', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Add US stock' })).toBeVisible();
      const sector = page.getByLabel('Sector (optional)');
      if (w.width < 1024) {
        await expect(sector).toHaveCount(0);
        expect(seen.errors).toEqual([]);
        return;
      }
      await page.getByLabel('Stock name').fill('Demo Zeta Energy');
      await page.getByLabel('Ticker').fill('DEMZ');
      await sector.fill('Energy ');
      await page.getByRole('dialog').getByRole('button', { name: 'Add stock', exact: true }).click();
      await expect(page.getByText('Stock added', { exact: false }).first()).toBeVisible();
      await expect(page.getByText(/sector was not saved/)).toHaveCount(0);
      await goInvest(page, 'Portfolio', 'Categories');
      // หุ้นที่เพิ่งเพิ่ม (ยังไม่มีรายการซื้อ) ยังไม่ถือ จึงไม่ถูกนับในปุ่ม "Create categories from sectors" แต่ sector ถูกเก็บและเห็นในรายการจัดหมวด
      await page.getByRole('button', { name: 'Change' }).click();
      await expect(page.getByText('Sector: Energy', { exact: true })).toBeVisible();
      expect(seen.errors).toEqual([]);
    });

    test('ช่อง Sector: ข้อความไม่ผ่านตรวจ (อักขระควบคุม) ถูกปฏิเสธก่อนบันทึก', async ({ page }) => {
      test.skip(w.width < 1024, 'ช่อง Sector มีเฉพาะคอม');
      await page.route((url) => !/^(localhost|127.0.0.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=cat#/invest/portfolio/holdings');
      await expect(page.getByRole('heading', { name: 'Holdings', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByLabel('Stock name').fill('Demo Eta');
      await page.getByLabel('Ticker').fill('DEMH');
      await page.getByLabel('Sector (optional)').fill('x'.repeat(61));
      await page.getByRole('dialog').getByRole('button', { name: 'Add stock', exact: true }).click();
      await expect(page.getByText(/Sector must be 1-60 characters/)).toBeVisible();
    });

    test('Export CSV/JSON + Import JSON: ส่งออกแล้วนำเข้ากลับเป็นร่าง (ยังไม่บันทึกจนกด Save) · ไฟล์ผิดถูกปฏิเสธด้วยข้อความ · ไม่มีหมวด = ปุ่ม Export ปิด', async ({ page }) => {
      const seen = watch(page);
      // เก็บไฟล์ที่แอปสร้างให้ดาวน์โหลด (Blob) ไว้อ่านในเทสต์
      await page.addInitScript(() => {
        const w = window as unknown as { __blobs: Blob[] };
        w.__blobs = [];
        const orig = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (b: Blob | MediaSource) => {
          if (b instanceof Blob) w.__blobs.push(b);
          return orig(b);
        };
      });
      const lastBlobText = () => page.evaluate(() => (window as unknown as { __blobs: Blob[] }).__blobs.at(-1)!.text());
      const importText = (text: string) =>
        page.evaluate((content) => {
          const input = document.querySelector('#cg-import-file') as HTMLInputElement;
          const dt = new DataTransfer();
          dt.items.add(new File([content], 'categories.json', { type: 'application/json' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, text);
      await open(page);
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
      await page.getByRole('button', { name: 'Create categories from sectors' }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Categories saved.')).toBeVisible();

      const csvDl = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export CSV' }).click();
      expect((await csvDl).suggestedFilename()).toMatch(/^categories-[0-9]{4}-[0-9]{2}-[0-9]{2}[.]csv$/);
      const csvRaw = await lastBlobText();
      const csvText = csvRaw.charCodeAt(0) === 0xfeff ? csvRaw.slice(1) : csvRaw;
      expect(csvText.startsWith('Category,Target (%),Stocks')).toBe(true);
      expect(csvText).toContain('Health Care,,DEMB');

      const jsonDl = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON' }).click();
      await jsonDl;
      const jsonText = await lastBlobText();
      expect(JSON.parse(jsonText).format).toBe('money-buddy-categories');

      // นำเข้าไฟล์เดิม → เข้าสู่ตัวแก้เป็นร่าง
      await importText(jsonText);
      await expect(page.getByRole('heading', { name: 'Edit categories' })).toBeVisible();
      await expect(page.getByText(/Imported 5 categories/)).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();

      // ไฟล์ผิด: ข้อความชัด ไม่เปิดตัวแก้ ไม่แสดงเนื้อหาไฟล์
      await importText('{"secret":"do-not-echo"}');
      await expect(page.getByText('Import failed: This is not a Money Buddy categories file.')).toBeVisible();
      await expect(page.getByText('do-not-echo')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Edit categories' })).toHaveCount(0);
      await importText(JSON.stringify({ format: 'money-buddy-categories', version: 1, categories: [{ name: 'A', target: '60' }, { name: 'B', target: '39.99' }], assignments: [] }));
      await expect(page.getByText(/Import failed: .*100%/)).toBeVisible();
      expect(seen.errors).toEqual([]);
      expect(seen.external).toEqual([]);
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
