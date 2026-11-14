import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';

/**
 * บันทึกช่วยจำแบบเดาคำ (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569) · ทั้งมืดและสว่าง · 360 และ 1280
 * พิมพ์ 1 ตัวอักษรก็แสดง · ไม่เกิน 5 · แตะ/ลูกศร+Enter เลือก · หมวดตั้งให้เมื่อเคยใช้หมวดเดียวกันทุกครั้ง · ไม่เติมจำนวนเงิน · ลบคำแนะนำได้และจำหลังโหลดใหม่
 * คำนวณในเครื่อง: ไม่มีคำขอออกนอกเครื่อง · มือถือแป้นพิมพ์ไม่บัง (จำลองด้วยจอเตี้ย) · ข้อมูลสมมติจาก harness (ข้าวมันไก่ ฯลฯ ในหมวดอาหาร)
 */
async function openApp(page: Page): Promise<string[]> {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!/^(http:\/\/localhost:5199|data:|blob:|about:)/.test(r.url())) external.push(r.url());
  });
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
  return external;
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

/** เพิ่มรายการสมมติผ่านฟอร์ม (ใช้เตรียมประวัติให้มีหลายข้อความ) */
async function addEntry(page: Page, mobile: boolean, memo: string, amount: string, category?: string): Promise<void> {
  await openAddDialog(page, mobile);
  await page.locator('#entry-amount').fill(amount);
  if (category) await page.locator('#entry-counter').selectOption({ label: category });
  await page.locator('#entry-memo').fill(memo);
  await page.locator('#entry-amount').focus(); // ออกจากช่องบันทึกช่วยจำ: รายการคำแนะนำปิดเอง
  await page.locator('dialog[open]').getByRole('button', { name: /^บันทึก/ }).last().click();
  await expect(page.locator('dialog[open]')).toBeHidden();
}

const options = (page: Page) => page.locator('.memo-suggest [role=option]');

for (const theme of ['dark', 'light'] as const) {
  for (const w of [
    { width: 360, height: 740, mobile: true },
    { width: 1280, height: 800, mobile: false },
  ]) {
    test.describe(`บันทึกช่วยจำเดาคำ ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH' });

      test('พิมพ์ 1 ตัวอักษรแสดงคำแนะนำ (ไม่เกิน 5) เรียงตามที่ใช้บ่อย · ลูกศร+Enter เลือก · ตั้งหมวดให้ · ไม่เติมจำนวนเงิน · ไม่มีคำขอออกนอกเครื่อง', async ({ page }) => {
        const external = await openApp(page);
        // ประวัติ: "ก๋วยเตี๋ยวเจ้าเก่า" 3 ครั้งหมวดอาหาร · "กาแฟร้านหน้า" 1 ครั้งหมวดเดินทาง (ตั้งใจหมวดต่าง)
        await addEntry(page, w.mobile, 'ก๋วยเตี๋ยวเจ้าเก่า', '60');
        await addEntry(page, w.mobile, 'ก๋วยเตี๋ยวเจ้าเก่า', '60');
        await addEntry(page, w.mobile, 'ก๋วยเตี๋ยวเจ้าเก่า', '65');
        await addEntry(page, w.mobile, 'กาแฟร้านหน้า', '55', 'เดินทาง');
        for (const m of ['กอไก่ 1', 'กอไก่ 2', 'กอไก่ 3', 'กอไก่ 4']) await addEntry(page, w.mobile, m, '10');

        await openAddDialog(page, w.mobile);
        const memo = page.locator('#entry-memo');
        await memo.click();
        await memo.pressSequentially('ก');
        await expect(options(page).first()).toBeVisible();
        const count = await options(page).count();
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(5);
        // ใช้บ่อยสุดมาก่อน
        await expect(options(page).first()).toContainText('ก๋วยเตี๋ยวเจ้าเก่า');
        // รายการคำแนะนำอ่านชัด (contrast) ทั้งสองโหมด
        const { failures, checked } = await pageContrastFailures(page);
        expect(checked).toBeGreaterThan(5);
        expect(failures.slice(0, 12)).toEqual([]);

        // รายการทุกอันอยู่ในกล่องโต้ตอบครบ (ไม่ถูกตัดที่ขอบกล่อง: เดสก์ท็อปดันเนื้อหา · มือถือจำกัดความสูงและเลื่อนในรายการ)
        const clipped = await page.evaluate((mobile) => {
          const dlg = document.querySelector('dialog[open]')!.getBoundingClientRect();
          const list = document.querySelector('.memo-suggest') as HTMLElement;
          const lr = list.getBoundingClientRect();
          return mobile ? lr.top < dlg.top - 1 : lr.height < list.scrollHeight - 1 && lr.bottom > dlg.bottom + 1;
        }, w.mobile);
        expect(clipped, 'รายการถูกตัดที่ขอบกล่อง').toBe(false);
        // ลูกศรลง → Enter เลือกตัวแรก: ใส่ข้อความ ตั้งหมวดอาหารให้ (เคยใช้หมวดเดียวกันทุกครั้ง) ไม่เติมจำนวนเงิน ไม่บันทึกฟอร์ม
        await page.locator('#entry-counter').selectOption({ label: 'เดินทาง' }); // ตั้งค่าเริ่มต้นให้ต่างจากที่จะถูกตั้ง
        await memo.focus();
        await memo.press('ArrowDown');
        await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
        await memo.press('Enter');
        await expect(memo).toHaveValue('ก๋วยเตี๋ยวเจ้าเก่า');
        await expect(page.locator('dialog[open]')).toBeVisible(); // Enter ไม่ได้บันทึกฟอร์ม
        await expect(page.locator('#entry-counter')).toHaveValue(/expense-food|food/i);
        await expect(page.locator('#entry-amount')).toHaveValue(''); // ห้ามเติมจำนวนเงิน
        await expect(options(page)).toHaveCount(0); // เลือกแล้วรายการปิด

        // ข้อความที่เคยใช้หลายหมวด/หมวดต่าง: "กาแฟร้านหน้า" ใช้หมวดเดินทางครั้งเดียว → ตั้งหมวดเดินทางให้
        await memo.fill('');
        await memo.pressSequentially('กาแฟ');
        await options(page).filter({ hasText: 'กาแฟร้านหน้า' }).first().click(); // แตะ/คลิกเลือก
        await expect(memo).toHaveValue('กาแฟร้านหน้า');
        await expect(page.locator('#entry-counter option:checked')).toHaveText('เดินทาง');
        await expect(page.locator('#entry-amount')).toHaveValue('');
        // บอกผู้ใช้บนจอว่าหมวดถูกตั้งให้ · เปลี่ยนหมวดเองทีหลังได้ (ข้อความหาย)
        await expect(page.locator('#entry-counter-auto')).toHaveText('ตั้งหมวดให้ตามที่เคยใช้ · เปลี่ยนได้');
        await page.locator('#entry-counter').selectOption({ label: 'อาหาร' });
        await expect(page.locator('#entry-counter option:checked')).toHaveText('อาหาร');
        await expect(page.locator('#entry-counter-auto')).toHaveCount(0);
        expect(external, 'คำนวณในเครื่อง ไม่มีคำขอออกนอกเครื่อง').toEqual([]);
      });

      test('Esc ปิดแค่รายการคำแนะนำ (ไม่ปิดกล่องบันทึกรายการ) · ลบคำแนะนำด้วย Delete และปุ่ม ✕ · จำหลังโหลดใหม่', async ({ page }) => {
        await openApp(page);
        await addEntry(page, w.mobile, 'ซื้อของเข้าบ้าน', '100');
        await addEntry(page, w.mobile, 'ซื้อของฝาก', '100');
        await openAddDialog(page, w.mobile);
        const memo = page.locator('#entry-memo');
        await memo.click();
        await memo.pressSequentially('ซื้อ');
        await expect(options(page)).toHaveCount(2);
        await memo.press('Escape');
        await expect(options(page)).toHaveCount(0);
        await expect(page.locator('dialog[open]')).toBeVisible();
        // เปิดรายการอีกครั้งด้วยการพิมพ์ต่อ แล้วลบตัวที่เลือกด้วย Delete
        await memo.pressSequentially('ข');
        await memo.press('ArrowDown');
        await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
        const firstText = (await options(page).first().innerText()).replace('✕', '').trim();
        await memo.press('Delete');
        await expect(options(page).filter({ hasText: firstText })).toHaveCount(0);
        // ลบด้วยปุ่ม ✕ (ตัวที่เหลือ)
        await memo.fill('');
        await memo.pressSequentially('ซื้อ');
        const remain = await options(page).count();
        if (remain > 0) {
          await options(page).first().getByRole('button', { name: /ไม่ต้องแนะนำ/ }).click({ force: true });
          await expect(options(page)).toHaveCount(remain - 1);
        }
        // ปิดแล้วเปิดใหม่ทั้งหน้า: ที่ลบไว้ไม่กลับมา (เก็บในเครื่อง)
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.reload();
        await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
        await openAddDialog(page, w.mobile);
        await page.locator('#entry-memo').click();
        await page.locator('#entry-memo').pressSequentially('ซื้อ');
        await expect(options(page).filter({ hasText: firstText })).toHaveCount(0);
      });

      test('ไม่มีคำแนะนำเมื่อช่องว่าง · ไม่เกิน 5 รายการ · เฉพาะประเภทที่เลือก (รายรับไม่เห็นข้อความรายจ่าย)', async ({ page }) => {
        await openApp(page);
        for (let i = 1; i <= 7; i++) await addEntry(page, w.mobile, `เติมน้ำมัน${i}`, '100');
        await openAddDialog(page, w.mobile);
        const memo = page.locator('#entry-memo');
        await memo.click();
        await expect(options(page)).toHaveCount(0);
        await memo.pressSequentially('เ');
        await expect(options(page)).toHaveCount(5);
        await memo.fill('');
        // แท็บรายรับ: ไม่เห็น "เติมน้ำมัน" (เป็นรายจ่าย)
        await page.getByRole('radio', { name: 'รายรับ' }).check();
        await memo.click();
        await memo.pressSequentially('เติม');
        await expect(options(page)).toHaveCount(0);
      });
    });
  }
}

test.describe('มือถือ: แป้นพิมพ์ไม่บังรายการ (จำลองด้วยพื้นที่มองเห็นเตี้ยลง)', () => {
  // แป้นพิมพ์มือถือกินพื้นที่ล่างราว 40-50% ของจอ: จำลองด้วยหน้าต่างสูง 380px ที่ 360 กว้าง
  test.use({ viewport: { width: 360, height: 380 }, hasTouch: true, isMobile: true, locale: 'th-TH' });

  test('รายการคำแนะนำเด้งเหนือช่องและอยู่ในพื้นที่ที่เห็นทั้งหมด (ไม่ล้นล่าง/บน)', async ({ page }) => {
    await openApp(page);
    await addEntry(page, true, 'กะเพราร้านเดิม', '60');
    await addEntry(page, true, 'กะเพราไก่ไข่ดาว', '70');
    await addEntry(page, true, 'กาแฟเย็น', '50');
    await openAddDialog(page, true);
    const memo = page.locator('#entry-memo');
    await memo.scrollIntoViewIfNeeded();
    await memo.tap();
    await memo.pressSequentially('ก');
    await expect(options(page).first()).toBeVisible();
    const box = await page.evaluate(() => {
      const list = document.querySelector('.memo-suggest')!.getBoundingClientRect();
      const input = document.getElementById('entry-memo')!.getBoundingClientRect();
      return { listTop: list.top, listBottom: list.bottom, inputTop: input.top, vh: window.innerHeight };
    });
    expect(box.listBottom, 'รายการอยู่เหนือช่อง ไม่ทับช่องกรอก').toBeLessThanOrEqual(box.inputTop + 1);
    // ส่วนที่เห็นอยู่ในจอ: ไม่ใช่ว่าครึ่งหนึ่งหลุดเหนือจอ (เลื่อนดูได้ในกล่องโต้ตอบ แต่ต้องเห็นตัวแรกอย่างน้อย)
    const firstVisible = await options(page).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    expect(firstVisible, 'คำแนะนำแรกอยู่ในจอ').toBe(true);
  });
});
