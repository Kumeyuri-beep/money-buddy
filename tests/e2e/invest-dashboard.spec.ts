import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';
import { obscured, openHarness, overflowing, watch } from './helpers/layoutChecks';
import { openDesktopView } from './helpers/nav';

/**
 * แท็บ "แดชบอร์ด" ของโหมดพอร์ต (ลูกน้อง 1): ทดสอบบน harness (ที่เก็บในเครื่อง ยังไม่มีข้อมูลลงทุน) จึงตรวจ empty state ของทุกการ์ด การจัดวาง ปุ่ม ฿/USD ปุ่มสลับสัดส่วน contrast ไม่ล้นจอ
 * ตัวเลขและการจัดวางการ์ดตอนมีข้อมูล ตรวจโดย tests/unit/investDashboard.test.ts (harness ไม่มีข้อมูลลงทุน)
 */
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
] as const;

async function openDashboard(page: Page, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'พอร์ต', exact: true }).first().click();
    await expect(dialog).toBeHidden();
  } else {
    await openDesktopView(page, 'พอร์ตการลงทุน');
  }
  await expect(page.getByRole('heading', { name: 'Main portfolio', level: 2 }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Portfolio', level: 2, exact: true })).toBeVisible();
}

for (const w of WIDTHS) {
  test.describe(`แดชบอร์ดพอร์ต ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });

    test('ยังไม่มีหุ้น: ทุกการ์ดเป็นสถานะว่าง ไม่มีเลขปลอม ไม่มีปุ่ม Warning · ปุ่มที่ยังไม่เปิดใช้เป็น aria-disabled · ปุ่ม ฿/USD ไม่ทำให้พัง · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openDashboard(page, w.mobile);
      for (const name of ['Value', 'Total profit', 'IRR', 'Passive income', 'Portfolio']) await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
      await expect(page.getByText('No holdings yet. Use + Add')).toBeVisible();
      await expect(page.getByText('Warning', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Holdings', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Sector', exact: true })).toHaveAttribute('aria-disabled', 'true');
      for (const name of ['Ask AI', 'Search', 'Watchlist']) await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-disabled', 'true');
      await page.getByRole('button', { name: '$ USD', exact: true }).click();
      await expect(page.getByText('No holdings yet. Use + Add')).toBeVisible();
      await page.getByRole('button', { name: '฿ THB', exact: true }).click();

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });

    for (const theme of ['dark', 'light'] as const) {
      test(`ตัวหนังสือผ่าน WCAG AA (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openHarness(page);
        await openDashboard(page, w.mobile);
        await page.waitForTimeout(500);
        const { failures, checked } = await pageContrastFailures(page);
        expect(checked, 'ต้องตรวจข้อความได้จริง').toBeGreaterThan(10);
        expect(failures.slice(0, 12), 'ข้อความที่ contrast ต่ำ').toEqual([]);
      });
    }
  });
}
