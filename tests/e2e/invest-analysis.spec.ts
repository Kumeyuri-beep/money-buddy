import { expect, test, type Page } from '@playwright/test';
import { goInvest } from './helpers/investNav';
import { openDesktopView } from './helpers/nav';
import { obscured, openHarness, overflowing, watch } from './helpers/layoutChecks';

/**
 * แท็บ "วิเคราะห์" ของโหมดการลงทุน (/invest) บน harness (ที่เก็บในเครื่อง ไม่มีข้อมูลหุ้นสหรัฐ จึงตรวจสถานะว่าง โครงหน้า การไม่ล้นจอ)
 * หน้าที่มีข้อมูลหุ้นตรวจโดยเทสต์หน่วย tests/unit/investAnalysisModel.test.ts (เรนเดอร์จริงด้วยข้อมูลสมมติ: ตัวอย่างหลัก R25.4 10.69% / 10.00% / 21.76%)
 * 360/390 (มือถือ ต้องไม่พัง) และ 1280/1440 (คอม) · ข้อมูลสมมติ ห้ามข้อมูลจริง
 */
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
] as const;

async function openAnalysis(page: Page, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'พอร์ต', exact: true }).first().click();
    await expect(dialog).toBeHidden();
  } else {
    await openDesktopView(page, 'พอร์ตการลงทุน');
  }
  await expect(page.getByRole('navigation', { name: 'Portfolio sections' }).first()).toBeVisible();
  await goInvest(page, 'Analytics', 'Common');
  await expect(page.getByRole('heading', { name: 'Analytics', level: 2 })).toBeVisible();
}

for (const w of WIDTHS) {
  test.describe(`ความกว้าง ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    test('แท็บ Analytics ยังไม่มีหุ้นสหรัฐ: ทุกการ์ดมีสถานะว่าง ไม่มีตัวเลขปลอม · สลับ ฿/USD ได้ · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openAnalysis(page, w.mobile);

      await expect(page.getByRole('heading', { name: 'No US stocks yet', level: 2 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Monthly returns' })).toHaveCount(0);
      await expect(page.locator('.invest-analysis').getByText(/฿\d|\$\d/)).toHaveCount(0);

      await page.getByRole('button', { name: '$ USD', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'No US stocks yet', level: 2 })).toBeVisible();
      await page.getByRole('button', { name: '฿ THB', exact: true }).click();

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });
  });
}
