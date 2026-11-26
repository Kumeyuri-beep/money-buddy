import { expect, test, type Page } from '@playwright/test';

/** นำเข้าไฟล์สำรองเมื่อมีหมวดเดิมค้าง: ต้องถามก่อนลบ · ค่าเริ่มต้นคือยกเลิก (ข้อมูลสมมติทั้งหมด) */
async function chooseFile(page: Page, categories: number, countDelay = 0) {
  await page.goto(`/harness.html?reset=1&importCategories=${categories}&countDelay=${countDelay}`);
  await page.getByRole('button', { name: 'นำเข้าจากไฟล์สำรอง' }).click();
  await page.getByLabel('ไฟล์สำรอง', { exact: true }).setInputFiles('tests/fixtures/import-categories-backup.json');
  await page.getByRole('button', { name: 'นำเข้า', exact: true }).click();
}

const options = (page: Page) => page.evaluate(() => (window as unknown as { __importOptions?: unknown[] }).__importOptions ?? []);

for (const width of [360, 390, 1280, 1440]) test.describe('นำเข้าเมื่อมีหมวดเดิม · ' + width + 'px', () => {
  test.use({ viewport: { width, height: width < 1024 ? 740 : 900 } });
  test('ถามก่อน บอกจำนวน โฟกัสเริ่มที่ยกเลิก · Esc และยกเลิก = ไม่นำเข้าอะไร', async ({ page }) => {
    await chooseFile(page, 2);
    const dialog = page.getByRole('dialog', { name: 'ลบหมวดเดิมก่อนนำเข้า?' });
    await expect(dialog).toContainText('พบหมวดเดิม 2 หมวด');
    await expect(dialog.getByRole('button', { name: 'ยกเลิก' })).toBeFocused();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'นำเข้า', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter'); // ค่าเริ่มต้น = ยกเลิก
    await expect(dialog).toBeHidden();
    expect(await options(page)).toEqual([]);
  });

  test('บอกว่าเป็นหมวดพอร์ตลงทุน และปุ่มอยู่ในกล่องครบ ไม่มีเลื่อนแนวนอน', async ({ page }) => {
    await chooseFile(page, 2);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('หมวดในพอร์ตลงทุน หมวดรายรับรายจ่ายไม่ถูกลบ');
    await expect(dialog).toContainText('กดยกเลิก จะไม่นำเข้าอะไรเลย');
    const box = (await dialog.boundingBox())!;
    for (const button of await dialog.getByRole('button').all()) {
      const b = (await button.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    }
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('ระหว่างนับหมวด: บอกสถานะ ปุ่มย้อนกลับกดไม่ได้', async ({ page }) => {
    await chooseFile(page, 2, 1500);
    await expect(page.getByRole('status').filter({ hasText: 'กำลังตรวจหมวดเดิม' })).toBeVisible();
    const back = page.getByRole('button', { name: 'เลือกไฟล์อื่น' });
    await expect(back).toHaveAttribute('aria-disabled', 'true');
    await back.click({ force: true });
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await options(page)).toEqual([]);
  });

  test('ยืนยันลบแล้วจึงนำเข้า พร้อมจำนวนที่เห็น', async ({ page }) => {
    await chooseFile(page, 2);
    await page.getByRole('button', { name: 'ลบหมวดเดิมแล้วนำเข้า' }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await options(page)).toEqual([{ replaceCategories: 2 }]);
  });

  test('ไม่มีหมวดเดิม: นำเข้าทันทีเหมือนเดิม ไม่มีกล่องถาม', async ({ page }) => {
    await chooseFile(page, 0);
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await options(page)).toEqual([null]);
  });
});
