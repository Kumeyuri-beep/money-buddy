import { expect, test, type Page } from '@playwright/test';

/**
 * ตัวเลือกธีม (โหมดสว่าง เฟส 3): ตามเครื่อง / มืด / สว่าง · จำในเครื่อง · ตั้งก่อนวาดหน้า (ไม่กะพริบ) · สีแถบมือถือตามโหมด
 * ข้อมูลสมมติจาก harness (ที่เก็บในเครื่อง ไม่ออกนอกเครื่อง)
 */
test.use({ viewport: { width: 1280, height: 800 }, locale: 'th-TH' });

const DARK_BAR = '#07080d';
const LIGHT_BAR = '#eef1f8';

const state = (page: Page) =>
  page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    bar: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    stored: window.localStorage.getItem('mb.theme'),
    bg: getComputedStyle(document.body).backgroundColor,
  }));

async function open(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
}

async function openProfile(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name: 'โปรไฟล์' }).click();
  await expect(page.getByRole('heading', { name: 'สีหน้าจอ' })).toBeVisible();
}

test.describe('เครื่องตั้งสีมืด', () => {
  test.use({ colorScheme: 'dark' });

  test('เลือก "สว่าง": เปลี่ยนทันที จำในเครื่อง สีแถบมือถือตาม และยังอยู่หลังโหลดใหม่ (สคริปต์ก่อนวาดหน้า)', async ({ page }) => {
    await open(page);
    expect((await state(page)).attr).toBeNull();
    await openProfile(page);
    await page.getByRole('radio', { name: /^สว่าง/ }).check();
    await expect.poll(async () => (await state(page)).attr).toBe('light');
    const s = await state(page);
    expect(s.stored).toBe('light');
    expect(s.bar).toBe(LIGHT_BAR);
    expect(s.bg).not.toBe('rgb(7, 8, 13)');
    await page.reload();
    // ตั้งโดยสคริปต์ใน <head> ก่อนที่แอปจะโหลด: ตรวจทันทีที่ DOM พร้อม ยังไม่รอข้อมูล
    await page.waitForLoadState('domcontentloaded');
    const early = await state(page);
    expect(early.attr).toBe('light');
    expect(early.bar).toBe(LIGHT_BAR);
  });

  test('เลือก "ตามเครื่อง" แล้วกลับไปตามเครื่อง (มืด) และล้างค่าในเครื่อง', async ({ page }) => {
    await open(page);
    await openProfile(page);
    await page.getByRole('radio', { name: /^สว่าง/ }).check();
    await expect.poll(async () => (await state(page)).attr).toBe('light');
    await page.getByRole('radio', { name: /^ตามเครื่อง/ }).check();
    await expect.poll(async () => (await state(page)).attr).toBeNull();
    const s = await state(page);
    expect(s.stored).toBeNull();
    expect(s.bar).toBe(DARK_BAR);
  });

  test('คีย์บอร์ด: ลูกศรเลือกธีมได้ และตัวเลือกที่เลือกอยู่ถูกติ๊ก', async ({ page }) => {
    await open(page);
    await openProfile(page);
    await expect(page.getByRole('radio', { name: /^ตามเครื่อง/ })).toBeChecked();
    await page.getByRole('radio', { name: /^ตามเครื่อง/ }).focus();
    await page.keyboard.press('ArrowDown'); // → มืด
    await page.keyboard.press('ArrowDown'); // → สว่าง
    await expect(page.getByRole('radio', { name: /^สว่าง/ })).toBeChecked();
    await expect.poll(async () => (await state(page)).attr).toBe('light');
  });
});

test.describe('เครื่องตั้งสีสว่าง', () => {
  test.use({ colorScheme: 'light' });

  test('ไม่เคยเลือก = ตามเครื่อง (สว่าง) สีแถบมือถือเป็นสว่างตั้งแต่เปิด · เลือก "มืด" ชนะค่าเครื่อง', async ({ page }) => {
    await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
    await page.goto('/harness.html?seed=1', { waitUntil: 'domcontentloaded' });
    expect((await state(page)).bar).toBe(LIGHT_BAR);
    await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
    await openProfile(page);
    await page.getByRole('radio', { name: /^มืด/ }).check();
    await expect.poll(async () => (await state(page)).attr).toBe('dark');
    const s = await state(page);
    expect(s.bar).toBe(DARK_BAR);
    expect(s.bg).toBe('rgb(7, 8, 13)');
  });
});
