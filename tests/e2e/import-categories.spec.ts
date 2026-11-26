import { expect, test, type Page } from '@playwright/test';

/** นำเข้าไฟล์สำรองเมื่อมีหมวดเดิมค้าง: ต้องถามก่อนลบ · ค่าเริ่มต้นคือยกเลิก (ข้อมูลสมมติทั้งหมด) */
async function chooseFile(page: Page, categories: number) {
  await page.goto(`/harness.html?reset=1&importCategories=${categories}`);
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
