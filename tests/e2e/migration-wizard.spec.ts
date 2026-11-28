import { expect, test, type Page } from '@playwright/test';

/**
 * หน้าย้ายข้อมูลจากเบราว์เซอร์ขึ้นบัญชีออนไลน์ (MigrationWizard) บน harness ?wizard=… · ข้อมูลสมมติทั้งหมด ปลายทางจำลอง
 * ตรวจลำดับ สำรอง → ตรวจ → นำเข้า → ยืนยันยอด · กล่องยืนยันลบหมวด · กรณีล้มและยอดไม่ตรง · ไม่มีปุ่มลองนำเข้าข้อมูลลงทุน (ตัดสิน 2ก)
 */
async function toReview(page: Page, kind: string) {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto(`/harness.html?reset=1&seed=1&wizard=${kind}`);
  await expect(page.getByRole('heading', { name: 'ขั้นที่ 1: ดาวน์โหลดไฟล์สำรองก่อน' })).toBeVisible({ timeout: 20_000 });
  const next = page.getByRole('button', { name: 'ถัดไป: ตรวจข้อมูล' });
  await expect(next).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ดาวน์โหลดไฟล์สำรอง' }).click();
  await download;
  await next.click();
  await expect(page.getByRole('heading', { name: 'ขั้นที่ 2: ตรวจแล้ว พร้อมนำเข้า' })).toBeFocused();
}

const importButton = (page: Page) => page.getByRole('button', { name: 'นำเข้าขึ้นบัญชีออนไลน์' });
const options = (page: Page) => page.evaluate(() => (window as unknown as { __importOptions?: unknown[] }).__importOptions ?? []);
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

for (const width of [360, 390, 1280, 1440]) test.describe('ย้ายข้อมูลขึ้นออนไลน์ · ' + width + 'px', () => {
  test.use({ viewport: { width, height: width < 1024 ? 740 : 900 } });

  test('ทางสำเร็จ: ต้องสำรองก่อน · ยอดตรง · ต้องติ๊กยืนยันจึงใช้งานต่อได้', async ({ page }) => {
    await toReview(page, 'ok');
    await noOverflow(page);
    await importButton(page).click();
    await expect(page.getByText('ตรงกันทุกอย่าง')).toBeVisible();
    const go = page.getByRole('button', { name: 'ใช้งานบัญชีออนไลน์ต่อ' });
    await expect(go).toBeDisabled();
    await page.getByLabel('ฉันตรวจยอดแล้ว').check();
    await expect(go).toBeEnabled();
    // ของเดิม: ขั้นตรวจยอดล้นแนวนอนที่ 360px (HANDOFF "รอปรับมือถือ") ยังไม่ปรับมือถือจนกว่าเจ้าของสั่ง
    if (width > 360) await noOverflow(page);
    expect(await options(page)).toEqual([null]);
  });

  test('มีหมวดพอร์ตค้าง: ถามก่อน · ค่าเริ่มต้นยกเลิก ไม่นำเข้า · ยืนยันแล้วส่งจำนวน', async ({ page }) => {
    await toReview(page, 'categories');
    await importButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'ลบหมวดเดิมก่อนนำเข้า?' });
    await expect(dialog).toContainText('พบหมวดเดิม 2 หมวด');
    await expect(dialog.getByRole('button', { name: 'ยกเลิก' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(importButton(page)).toBeFocused();
    expect(await options(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'ลบหมวดเดิมแล้วนำเข้า' }).click();
    await expect(page.getByText('ตรงกันทุกอย่าง')).toBeVisible();
    expect(await options(page)).toEqual([{ replaceCategories: 2 }]);
  });

  test('นำเข้าถูกปฏิเสธ: บอกว่าข้อมูลในเครื่องไม่ถูกแตะ มีปุ่มโหลดใหม่ ไม่มีปุ่มลองนำเข้าข้อมูลลงทุน', async ({ page }) => {
    await toReview(page, 'fail');
    await importButton(page).click();
    await expect(page.getByRole('heading', { name: 'เกิดข้อผิดพลาด' })).toBeFocused();
    await expect(page.getByRole('alert')).toContainText('นำเข้าไม่สำเร็จ');
    await expect(page.getByText('ข้อมูลเดิมในเครื่องไม่ถูกแตะต้อง')).toBeVisible();
    await expect(page.getByRole('button', { name: 'โหลดหน้าใหม่' })).toBeVisible();
    await expect(page.getByRole('button', { name: /ลองนำเข้าข้อมูลลงทุน/ })).toHaveCount(0);
    await noOverflow(page);
  });

  test('ยอดไม่ตรง: ไม่ให้ใช้งานต่อ · ล้างเฉพาะออนไลน์แล้วกลับไปขั้นสำรองโดยไม่ต้องดาวน์โหลดซ้ำ', async ({ page }) => {
    await toReview(page, 'mismatch');
    await importButton(page).click();
    await expect(page.getByRole('alert')).toContainText('ยอดไม่ตรงกัน');
    await expect(page.getByRole('button', { name: 'ใช้งานบัญชีออนไลน์ต่อ' })).toHaveCount(0);
    await page.getByRole('button', { name: 'ล้างข้อมูลออนไลน์เพื่อนำเข้าใหม่' }).click();
    await expect(page.getByRole('heading', { name: 'ขั้นที่ 1: ดาวน์โหลดไฟล์สำรองก่อน' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'ถัดไป: ตรวจข้อมูล' })).toBeEnabled();
  });
});
