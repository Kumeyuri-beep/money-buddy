import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';

/**
 * เพิ่ม/ซ่อนหมวดรายรับ-รายจ่าย (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569) · ทั้งมืดและสว่าง · 360 และ 1280
 * ไม่ลบจริง: หมวดที่ซ่อนไม่แสดงในฟอร์ม แต่รายการเก่ายังเห็นชื่อหมวดเดิม ตัวกรองยังกรองได้ แก้รายการเก่าไม่เปลี่ยนหมวดเงียบๆ · เปิดกลับได้
 * ข้อมูลสมมติจาก harness (ที่เก็บในเครื่อง)
 */
async function openApp(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
}

async function goTo(page: Page, mobile: boolean, desktop: string, phone: string): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: phone, exact: true }).first().click();
  } else {
    await page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name: desktop }).click();
  }
  await expect(page.locator('#main h2, #main h1').first()).toBeVisible();
}

async function openCategorySection(page: Page): Promise<void> {
  const details = page.locator('details.archived-details').filter({ has: page.locator('#cn-group-expense') });
  if (!(await details.getAttribute('open'))) await details.locator('summary').click();
  await expect(page.locator('#cn-group-expense')).toBeVisible();
}

async function openAddDialog(page: Page, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
  } else {
    await page.getByRole('button', { name: /เพิ่มรายการ/ }).first().click();
  }
  await expect(page.locator('dialog[open]')).toBeVisible();
}

for (const theme of ['dark', 'light'] as const) {
  for (const w of [
    { width: 360, height: 740, mobile: true },
    { width: 1280, height: 800, mobile: false },
  ]) {
    test.describe(`หมวด เพิ่ม/ซ่อน ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH' });

      test('เพิ่มหมวดใหม่ได้ · ชื่อซ้ำ/ว่างถูกปฏิเสธ · หมวดใหม่โผล่ในฟอร์มบันทึกรายการ', async ({ page }) => {
        await openApp(page);
        await goTo(page, w.mobile, 'โปรไฟล์', 'โปรไฟล์');
        await openCategorySection(page);
        const input = page.locator('#cn-add-expense');
        const addBtn = page.getByRole('button', { name: 'เพิ่มหมวด' }).nth(1); // ปุ่มที่สองคือของรายจ่าย (แรกคือรายรับ)
        await expect(addBtn).toBeDisabled(); // ว่าง = กดไม่ได้
        await input.fill('ค่ากาแฟทดสอบ');
        await addBtn.click();
        await expect(page.getByText('✓ เพิ่มหมวด "ค่ากาแฟทดสอบ" แล้ว')).toBeVisible();
        // ซ้ำ (ไม่สนช่องว่าง/ตัวพิมพ์) ถูกปฏิเสธ
        await input.fill('  ค่ากาแฟทดสอบ ');
        await addBtn.click();
        await expect(page.getByRole('alert').filter({ hasText: 'มีหมวดชื่อนี้อยู่แล้ว' })).toBeVisible();
        // ฟอร์มบันทึกรายการเห็นหมวดใหม่
        await goTo(page, w.mobile, 'ภาพรวม', 'ภาพรวม');
        await openAddDialog(page, w.mobile);
        const options = await page.locator('#entry-counter option').allTextContents();
        expect(options.map((o) => o.trim())).toContain('ค่ากาแฟทดสอบ');
      });

      test('ซ่อนหมวดที่มีรายการ: ฟอร์มไม่เห็น · รายการเก่ายังแสดงชื่อเดิม · ตัวกรองยังเลือกได้ · แก้รายการเก่าไม่เปลี่ยนหมวด · เปิดกลับได้', async ({ page }) => {
        await openApp(page);
        await goTo(page, w.mobile, 'โปรไฟล์', 'โปรไฟล์');
        await openCategorySection(page);
        await page.getByRole('button', { name: 'ซ่อนหมวดรายจ่าย อาหาร', exact: true }).click();
        await expect(page.getByText('✓ ซ่อนหมวด "อาหาร" แล้ว')).toBeVisible();
        await expect(page.locator('#cn-hidden-title')).toBeVisible();
        await expect(page.getByRole('button', { name: 'เปิดหมวด อาหาร กลับมาใช้' })).toBeVisible();
        // ตัวหนังสือชัดทั้งส่วนจัดการหมวดที่ขยายอยู่
        const { failures, checked } = await pageContrastFailures(page);
        expect(checked).toBeGreaterThan(10);
        expect(failures.slice(0, 12)).toEqual([]);

        // ฟอร์มบันทึกรายการไม่เห็นหมวดที่ซ่อน
        await goTo(page, w.mobile, 'ภาพรวม', 'ภาพรวม');
        await openAddDialog(page, w.mobile);
        expect((await page.locator('#entry-counter option').allTextContents()).map((o) => o.trim())).not.toContain('อาหาร');
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open]')).toBeHidden();

        // รายการเก่ายังแสดงชื่อหมวดเดิม · ตัวกรองมี "อาหาร (ซ่อนอยู่)"
        await goTo(page, w.mobile, 'รายรับ-รายจ่าย', 'รายการ');
        const row = page.getByText('ข้าวมันไก่').first();
        await expect(row).toBeVisible();
        await expect(page.locator('.ledger-tx').filter({ hasText: 'ข้าวมันไก่' }).first()).toContainText('อาหาร');
        const filterOptions = (await page.locator('#f-account option').allTextContents()).map((o) => o.trim());
        expect(filterOptions).toContain('อาหาร (ซ่อนอยู่)');

        // แก้รายการเก่า: ช่องหมวดยังเป็น "อาหาร (ซ่อนอยู่)" ไม่ถูกเปลี่ยนเป็นหมวดแรก และบันทึกได้
        await page.getByRole('button', { name: /แก้ไข ข้าวมันไก่/ }).click();
        await expect(page.locator('dialog[open]')).toBeVisible();
        const selected = await page.locator('#entry-counter').evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim());
        expect(selected).toBe('อาหาร (ซ่อนอยู่)');
        await page.locator('#entry-amount').fill('70');
        await page.getByRole('button', { name: /^บันทึก/ }).last().click();
        await expect(page.locator('dialog[open]')).toBeHidden();
        await expect(page.locator('.ledger-tx').filter({ hasText: 'ข้าวมันไก่' }).first()).toContainText('อาหาร'); // ยังอยู่ในหมวดอาหารเหมือนเดิม

        // เปิดกลับ → ฟอร์มเห็นอีกครั้ง
        await goTo(page, w.mobile, 'โปรไฟล์', 'โปรไฟล์');
        await openCategorySection(page);
        await page.getByRole('button', { name: 'เปิดหมวด อาหาร กลับมาใช้' }).click();
        await goTo(page, w.mobile, 'ภาพรวม', 'ภาพรวม');
        await openAddDialog(page, w.mobile);
        expect((await page.locator('#entry-counter option').allTextContents()).map((o) => o.trim())).toContain('อาหาร');
      });

      test('ซ่อนตัวสุดท้ายของประเภทไม่ได้ (ปุ่มซ่อนกดไม่ได้พร้อมคำอธิบาย) และไม่มีหมวดผลการลงทุนในรายการจัดการ', async ({ page }) => {
        await openApp(page);
        await goTo(page, w.mobile, 'โปรไฟล์', 'โปรไฟล์');
        await openCategorySection(page);
        const expenseHide = page.locator('#cn-group-expense').locator('xpath=..').getByRole('button', { name: /^ซ่อนหมวดรายจ่าย/ });
        const total = await expenseHide.count();
        expect(total).toBeGreaterThan(1);
        for (let i = 0; i < total - 1; i++) await expenseHide.first().click();
        const last = page.locator('#cn-group-expense').locator('xpath=..').getByRole('button', { name: /^ซ่อนหมวดรายจ่าย/ });
        await expect(last).toHaveCount(1);
        await expect(last).toBeDisabled();
        await expect(page.getByText('ต้องเหลือไว้อย่างน้อย 1 หมวด')).toBeVisible();
        await expect(page.locator('#main').getByText(/กำไรจากการลงทุน|ปันผล|ภาษีหัก/)).toHaveCount(0);
      });
    });
  }
}
