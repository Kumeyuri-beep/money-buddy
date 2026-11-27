import { expect, test, type Page } from '@playwright/test';

/**
 * ปุ่มลองนำเข้าข้อมูลลงทุนอีกครั้ง หลังสมุดบัญชีเข้าแล้วแต่ขั้นลงทุนล้ม (ข้อมูลสมมติทั้งหมด)
 * ?importRetry=<ผลของแต่ละรอบ คั่นด้วย , : fail | lost | ok> · ?online=<empty|match|different|error> = สิ่งที่อ่านได้จากออนไลน์ก่อนลองใหม่
 * ?importCategories=N หมวดค้างที่นับได้ตอนลองใหม่ (รอบแรกนับได้ 0)
 */
const RETRY = 'ลองนำเข้าข้อมูลลงทุนอีกครั้ง';

async function failFirst(page: Page, query: string, fixture = 'import-retry-backup') {
  await page.goto(`/harness.html?reset=1&${query}`);
  await page.getByRole('button', { name: 'นำเข้าจากไฟล์สำรอง' }).click();
  await page.getByLabel('ไฟล์สำรอง', { exact: true }).setInputFiles(`tests/fixtures/${fixture}.json`);
  await page.getByRole('button', { name: 'นำเข้า', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('นำเข้าสมุดบัญชีสำเร็จแล้ว');
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __retryCalls?: unknown[] }).__retryCalls ?? []);

for (const width of [360, 390, 1280, 1440]) test.describe('ลองนำเข้าข้อมูลลงทุนใหม่ · ' + width + 'px', () => {
  test.use({ viewport: { width, height: width < 1024 ? 740 : 900 } });

  test('หน้าข้อผิดพลาด: ปุ่มลองใหม่เป็นปุ่มหลัก โหลดหน้าใหม่เป็นปุ่มรอง มีคำเตือน ไม่ล้นจอ', async ({ page }) => {
    await failFirst(page, 'importRetry=fail&online=empty');
    await expect(page.getByRole('button', { name: RETRY })).toHaveClass(/btn-primary/);
    await expect(page.getByRole('button', { name: 'โหลดหน้าใหม่' })).toHaveClass(/btn-ghost/);
    await expect(page.getByText('ปิดหรือโหลดหน้าใหม่แล้ว ปุ่มลองใหม่จะหาย')).toBeVisible();
    const gone = page.getByRole('note', { name: 'ถ้าปุ่มลองใหม่หาย' });
    await expect(gone).toContainText('ข้อมูลของคุณไม่หาย');
    await expect(gone).toContainText('พอร์ตการลงทุน');
    await expect(gone).toContainText('ล้างข้อมูลและเริ่มใหม่');
    await expect(gone).toContainText('รายการที่เพิ่มหลังนำเข้าจะหายด้วย');
    await expect(gone).toContainText('ใช้ไฟล์สำรองเดิม');
    await expect(gone).toContainText('โปรไฟล์และตั้งค่า');
    await expect(gone).toContainText('เทียบยอดในหน้า "ภาพรวม"');
    await expect(gone.getByRole('heading', { name: 'ถ้าปุ่มลองใหม่หาย' })).toBeVisible();
    // คำเตือนว่าย้อนกลับไม่ได้ต้องมาก่อนขั้นกดล้าง
    const text = (await gone.textContent())!;
    expect(text.indexOf('ย้อนกลับไม่ได้')).toBeLessThan(text.indexOf('ล้างข้อมูลและเริ่มใหม่'));
    // กล่องช่วยเหลืออยู่ใต้ปุ่ม ปุ่มลองใหม่ไม่ถูกดันลง
    expect((await gone.boundingBox())!.y).toBeGreaterThan((await page.getByRole('button', { name: RETRY }).boundingBox())!.y);
    await expect(page.getByText('แอปจะไม่นำเข้าทับ โหลดหน้าใหม่')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('ลองแล้วล้มอีก ยังกดได้ · ครั้งต่อไปสำเร็จ = หน้าตรวจยอด', async ({ page }) => {
    await failFirst(page, 'importRetry=fail,fail,ok&online=empty');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByRole('alert')).toContainText('ข้อมูลลงทุนยังไม่เข้า');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    await expect(page.getByLabel('ฉันตรวจยอดแล้ว')).toBeVisible();
    expect(await calls(page)).toEqual([null, null]);
  });

  test('คำตอบหายแต่เข้าแล้ว: ตรงกับไฟล์ = ไปหน้าตรวจยอด ไม่เรียกนำเข้าซ้ำ', async ({ page }) => {
    await failFirst(page, 'importRetry=lost&online=match');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });

  test('ออนไลน์มีข้อมูลที่ไม่ตรง: หยุด ไม่เรียกนำเข้า ปุ่มลองใหม่หาย', async ({ page }) => {
    await failFirst(page, 'importRetry=lost&online=different');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByRole('alert')).toContainText('ไม่ตรงกับไฟล์');
    await expect(page.getByRole('button', { name: RETRY })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'โหลดหน้าใหม่' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'นำเข้าจากไฟล์สำรอง' })).toBeFocused(); // ปุ่มที่โฟกัสอยู่ถูกถอด
    expect(await calls(page)).toEqual([]);
  });

  test('อ่านออนไลน์ไม่ได้: ไม่ทำอะไร ปุ่มยังอยู่', async ({ page }) => {
    await failFirst(page, 'importRetry=fail&online=error');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByRole('alert')).toContainText('จึงยังไม่ได้ทำอะไร');
    await expect(page.getByRole('button', { name: RETRY })).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });

  test('มีหมวดค้าง: ถามก่อน ข้อความไม่อ้างว่าไม่นำเข้าอะไรเลย · ยกเลิก = ไม่เรียก · ยืนยัน = ส่งจำนวน', async ({ page }) => {
    await failFirst(page, 'importRetry=fail,ok&online=empty&importCategories=2');
    await page.getByRole('button', { name: RETRY }).click();
    const dialog = page.getByRole('dialog', { name: 'ลบหมวดเดิมก่อนนำเข้า?' });
    await expect(dialog).toContainText('สมุดบัญชีนำเข้าแล้วและจะไม่ถูกแตะ');
    await expect(dialog).toContainText('กดยกเลิก จะยังไม่ทำอะไรต่อ');
    await expect(dialog).not.toContainText('จะไม่นำเข้าอะไรเลย');
    await page.keyboard.press('Enter'); // ค่าเริ่มต้น = ยกเลิก
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: RETRY })).toBeFocused();
    expect(await calls(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'ลบหมวดเดิมแล้วนำเข้า' }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await calls(page)).toEqual([{ replaceCategories: 2 }]);
  });

  test('รอบลองใหม่ถูกปฏิเสธเพราะรอบก่อนเพิ่งบันทึกเสร็จ: ตรวจซ้ำแล้วตรง = หน้าตรวจยอด ไม่อ้างว่ายังไม่เข้า', async ({ page }) => {
    await failFirst(page, 'importRetry=lost,fail&online=late');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await calls(page)).toEqual([null]);
  });

  test('ตรวจยอดไม่ได้หลังข้อมูลเข้าแล้ว: ปุ่มเปลี่ยนเป็นตรวจยอดอีกครั้ง ไม่นำเข้าซ้ำ', async ({ page }) => {
    await failFirst(page, 'importRetry=fail,ok&online=empty&verify=fail');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByRole('alert')).toContainText('ข้อมูลลงทุนเข้าแล้ว แต่ตรวจยอดไม่ได้');
    await expect(page.getByRole('button', { name: RETRY })).toHaveCount(0);
    const gone = page.getByRole('note', { name: 'ถ้าปุ่มลองใหม่หาย' });
    await expect(gone).toContainText('ไม่ต้องนำเข้าใหม่');
    await expect(gone).not.toContainText('ล้างข้อมูล');
    await page.getByRole('button', { name: 'ตรวจยอดอีกครั้ง' }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await calls(page)).toEqual([null]);
  });

  test('ไฟล์ไม่มีข้อมูลลงทุน (ลบหมวดอย่างเดียว): ปุ่ม คำอธิบาย และกล่องถาม พูดเรื่องลบหมวดเท่านั้น', async ({ page }) => {
    await failFirst(page, 'importRetry=fail,ok&online=oldcats&importCategories=2', 'import-categories-backup');
    const main = page.getByRole('region', { name: 'นำเข้าจากไฟล์สำรอง' });
    await expect(main).toContainText('ปุ่มลองใหม่จะตรวจก่อนว่าลบหมวดเดิมแล้วหรือยัง');
    await expect(main).not.toContainText('ข้อมูลลงทุนเข้า');
    const gone = page.getByRole('note', { name: 'ถ้าปุ่มลองใหม่หาย' });
    await expect(gone).toContainText('ข้อมูลของคุณไม่หาย');
    await expect(gone).toContainText('ลบได้ที่ พอร์ตการลงทุน > Portfolio > Categories > Change แล้วกด Delete และ Save');
    await expect(gone).toContainText('เทียบยอดในหน้า "ภาพรวม"');
    await expect(gone).not.toContainText('ล้างข้อมูล');
    await page.getByRole('button', { name: 'ลองลบหมวดเดิมอีกครั้ง' }).click();
    const dialog = page.getByRole('dialog', { name: 'ลบหมวดเดิม?' });
    await expect(dialog).not.toContainText('ก่อนนำเข้า');
    await expect(dialog).toContainText('หลังลบแล้วจะไม่มีหมวดเลย');
    await expect(dialog).not.toContainText('หลังนำเข้า');
    await dialog.getByRole('button', { name: 'ลบหมวดเดิม', exact: true }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await calls(page)).toEqual([{ replaceCategories: 2 }]);
  });

  test('ล้มซ้ำด้วยข้อความเดิม: ข้อความเตือนถูกสร้างใหม่ให้โปรแกรมอ่านจออ่านอีกครั้ง', async ({ page }) => {
    await failFirst(page, 'importRetry=fail&online=error');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByRole('alert')).toContainText('จึงยังไม่ได้ทำอะไร');
    await page.getByRole('alert').evaluate((el) => el.setAttribute('data-old', '1'));
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.locator('[role="alert"]:not([data-old])')).toContainText('จึงยังไม่ได้ทำอะไร');
  });

  if (width >= 1024) test('ปุ่มสองปุ่มมีช่องว่างระหว่างกัน', async ({ page }) => {
    await failFirst(page, 'importRetry=fail&online=empty');
    const a = (await page.getByRole('button', { name: RETRY }).boundingBox())!;
    const b = (await page.getByRole('button', { name: 'โหลดหน้าใหม่' }).boundingBox())!;
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(8);
  });

  test('ตรวจยอดอีกครั้งแล้วพบว่าข้อมูลออนไลน์หายไป: ไม่นำเข้าเองโดยไม่ได้กด', async ({ page }) => {
    await failFirst(page, 'importRetry=fail,ok&online=empty&verify=fail&gone=1');
    await page.getByRole('button', { name: RETRY }).click();
    await page.getByRole('button', { name: 'ตรวจยอดอีกครั้ง' }).click();
    await expect(page.getByRole('alert')).toContainText('ข้อมูลออนไลน์เปลี่ยนไป');
    expect(await calls(page)).toEqual([null]);
    await expect(page.getByRole('button', { name: RETRY })).toBeVisible();
  });

  test('ไฟล์มีข้อมูลลงทุนแต่ไม่มีสินทรัพย์: ไม่แนะให้ล้างข้อมูล', async ({ page }) => {
    await failFirst(page, 'importRetry=fail&online=empty', 'import-retry-noassets-backup');
    const gone = page.getByRole('note', { name: 'ถ้าปุ่มลองใหม่หาย' });
    await expect(gone).toContainText('แจ้งผู้ดูแลระบบ');
    await expect(gone).not.toContainText('ล้างข้อมูล');
    await expect(gone).not.toContainText('ตรวจว่าสินทรัพย์');
  });

  test('ยืนยันผลสมุดไม่ได้ แต่ตรวจยอดตรง: มีปุ่มนำเข้าข้อมูลลงทุนต่อ', async ({ page }) => {
    await page.goto('/harness.html?reset=1&importRetry=unconfirmed,ok&online=empty');
    await page.getByRole('button', { name: 'นำเข้าจากไฟล์สำรอง' }).click();
    await page.getByLabel('ไฟล์สำรอง', { exact: true }).setInputFiles('tests/fixtures/import-retry-backup.json');
    await page.getByRole('button', { name: 'นำเข้า', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('ตรวจแล้ว ยอดสมุดบัญชีตรงกับไฟล์ ข้อมูลลงทุนยังไม่ได้นำเข้า');
    await page.getByRole('button', { name: RETRY }).click();
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await calls(page)).toEqual([null]);
  });

  test('ยืนยันผลสมุดไม่ได้ ไฟล์ไม่มีข้อมูลลงทุน และยอดตรง: ไปหน้าตรวจยอดเลย', async ({ page }) => {
    await page.goto('/harness.html?reset=1&importRetry=unconfirmed&online=empty');
    await page.getByRole('button', { name: 'นำเข้าจากไฟล์สำรอง' }).click();
    await page.getByLabel('ไฟล์สำรอง', { exact: true }).setInputFiles('tests/fixtures/import-categories-backup.json');
    await page.getByRole('button', { name: 'นำเข้า', exact: true }).click();
    await expect(page.getByLabel('ฉันตรวจยอดแล้ว')).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });

  test('ยืนยันผลสมุดไม่ได้ และยอดไม่ตรง (ไม่ได้เข้า): ไม่มีปุ่มนำเข้าลงทุน ข้อความเดิม', async ({ page }) => {
    await page.goto('/harness.html?reset=1&importRetry=unconfirmed-empty&online=empty');
    await page.getByRole('button', { name: 'นำเข้าจากไฟล์สำรอง' }).click();
    await page.getByLabel('ไฟล์สำรอง', { exact: true }).setInputFiles('tests/fixtures/import-retry-backup.json');
    await page.getByRole('button', { name: 'นำเข้า', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('ยืนยันผลไม่ได้');
    await expect(page.getByRole('button', { name: RETRY })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'โหลดหน้าใหม่' })).toBeVisible();
  });

  test('ยืนยันผลสมุดไม่ได้ และตรวจแล้วยอดไม่ตรง: แสดงผลตรวจที่ไม่ให้ใช้งานต่อ ไม่มีปุ่มนำเข้าลงทุน', async ({ page }) => {
    await page.goto('/harness.html?reset=1&importRetry=unconfirmed-wrong&online=empty');
    await page.getByRole('button', { name: 'นำเข้าจากไฟล์สำรอง' }).click();
    await page.getByLabel('ไฟล์สำรอง', { exact: true }).setInputFiles('tests/fixtures/import-retry-backup.json');
    await page.getByRole('button', { name: 'นำเข้า', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('ยอดไม่ตรงกัน');
    // จำกัดในกล่องนำเข้า: ฟอร์มตั้งต้นด้านบนมีปุ่มชื่อเดียวกัน
    await expect(page.getByRole('region', { name: 'นำเข้าจากไฟล์สำรอง' }).getByRole('button', { name: 'เริ่มใช้งาน' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: RETRY })).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });

  test('ยอดสมุดตรงแต่อ่านข้อมูลลงทุนไม่ได้: ปุ่มลองใหม่ยังอยู่', async ({ page }) => {
    await page.goto('/harness.html?reset=1&importRetry=unconfirmed&online=error');
    await page.getByRole('button', { name: 'นำเข้าจากไฟล์สำรอง' }).click();
    await page.getByLabel('ไฟล์สำรอง', { exact: true }).setInputFiles('tests/fixtures/import-retry-backup.json');
    await page.getByRole('button', { name: 'นำเข้า', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('ยอดสมุดบัญชีตรงกับไฟล์ แต่อ่านข้อมูลลงทุนไม่ได้');
    await expect(page.getByRole('button', { name: RETRY })).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });

  test('กดซ้ำระหว่างตรวจ: เรียกนำเข้าครั้งเดียว', async ({ page }) => {
    await failFirst(page, 'importRetry=fail,ok&online=empty&readDelay=800');
    const retry = page.getByRole('button', { name: RETRY });
    await retry.click();
    await expect(page.getByRole('status').filter({ hasText: 'กำลังตรวจข้อมูลออนไลน์' })).toBeVisible();
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await retry.click({ force: true });
    await expect(page.getByText('นำเข้าแล้ว:')).toBeVisible();
    expect(await calls(page)).toEqual([null]);
  });
});
