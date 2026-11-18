import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * หน้า My goal (R28) บน harness ที่ใส่ข้อมูลลงทุนสมมติด้วย ?investDemo=1 · ข้อมูลสมมติทั้งหมด
 * ตรวจ: บันทึกเป้าแล้วจำค่าหลังโหลดใหม่ · สลับ Value/Passive income · ข้อความ "Projection, not a promise" · ปุ่ม ฿/USD เปลี่ยนตัวเลข · ไม่ล้นจอ
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

async function openGoal(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=1#/invest/portfolio/goal');
  await expect(page.getByRole('heading', { name: 'My goal', level: 2 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Save and calculate' })).toBeVisible({ timeout: 20_000 });
}

for (const w of WIDTHS) {
  test.describe(`My goal ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ตั้งเป้า บันทึก จำค่าหลังโหลดใหม่ · มีข้อความ Projection, not a promise · ไม่ล้นจอ', async ({ page }) => {
      const seen = watch(page);
      await openGoal(page);
      await expect(page.locator('.iv-goal-disclaimer')).toBeVisible();
      await page.getByLabel('Target value').fill('9999999');
      await page.getByLabel(/^Contributions/).fill('1000');
      await page.getByLabel('Expected return per year (%)').fill('7');
      await page.getByRole('button', { name: 'Save and calculate' }).click();
      await expect(page.locator('.iv-goal-disclaimer')).toBeVisible();
      await expect(page.getByText(/(On track|Behind) ·/).or(page.getByText(/^Needs (data|rate)/))).toBeVisible();
      await page.reload();
      await expect(page.getByLabel('Target value')).toHaveValue(/9,?999,?999/, { timeout: 20_000 });
      await expect(page.locator('.iv-goal-disclaimer')).toBeVisible();

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });

    test('ฟอร์มไม่ล้นการ์ดของตัวเอง แม้ฟอนต์กว้างกว่าปกติ (CI Linux ใช้ฟอนต์ต่างจากเครื่องเรา)', async ({ page }) => {
      await openGoal(page);
      await page.addStyleTag({ content: '.iv-goal-page, .iv-goal-page * { font-family: "Courier New", monospace !important; }' });
      const bad = await page.evaluate(() => {
        const form = document.querySelector('.iv-goal-form') as HTMLElement;
        const fr = form.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(form).paddingRight) || 0;
        return Array.from(form.querySelectorAll('*'))
          .filter((e) => !e.closest('.iv-tip') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
          .filter((e) => e.getBoundingClientRect().right > fr.right - pad + 1)
          .map((e) => `${e.tagName}.${String((e as HTMLElement).className)} ${Math.round(e.getBoundingClientRect().right)} > ${Math.round(fr.right - pad)}`);
      });
      expect(bad, 'องค์ประกอบในฟอร์มล้นขอบการ์ด').toEqual([]);
    });

    test('สลับ Value / Passive income และ ฿ / USD', async ({ page }) => {
      await openGoal(page);
      await page.getByRole('button', { name: 'Passive income', exact: true }).click();
      await expect(page.getByLabel('Target passive income per month')).toBeVisible();
      await page.getByRole('button', { name: 'Value', exact: true }).click();
      await expect(page.getByLabel('Target value')).toBeVisible();
      await page.getByLabel('Target value').fill('500000');
      await page.getByLabel('Expected return per year (%)').fill('7');
      await page.getByRole('button', { name: 'Save and calculate' }).click();
      await expect(page.locator('.iv-goal-badge')).toBeVisible();
      await page.getByRole('button', { name: '฿ THB', exact: true }).click();
      await expect(page.locator('.iv-goal-disclaimer')).toBeVisible();
      // ฟอร์มแสดงจำนวนและสกุลที่เก็บจริง ไม่แปลงตามปุ่มสกุลด้านบน (R26)
      await expect(page.getByRole('group', { name: 'Goal currency' }).getByRole('button', { name: 'USD', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Target value')).toHaveValue('500000.00');
      await page.getByRole('button', { name: 'Save and calculate' }).click();
      await expect(page.getByLabel('Target value')).toHaveValue('500000.00');
      await page.getByRole('button', { name: '$ USD', exact: true }).click();
      await expect(page.getByLabel('Target value')).toHaveValue('500000.00');
    });
  });
}
