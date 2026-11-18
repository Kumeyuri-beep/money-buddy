import { expect, test } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/** ข้อมูลสมมติที่ปันผลหนึ่งรายการไม่มีเรต (?investDemo=norate): ต้องเห็นกล่อง Needs rate และป้าย Incomplete ที่ยอดที่ได้รับผล (R26) */
const WIDTHS = [360, 390, 1280, 1440] as const;
for (const width of WIDTHS) {
  test.describe(`Needs rate ${width}px`, () => {
    test.use({ viewport: { width, height: width >= 1024 ? 900 : 800 }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });
    test('Dashboard และ Holdings แสดง Needs rate + Incomplete · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=norate#/invest');
      const notice = page.getByTestId('needs-rate-notice');
      await expect(notice).toBeVisible({ timeout: 20_000 });
      await expect(notice).toContainText('Incomplete totals:');
      await expect(notice).toContainText('Needs rate');
      await expect(page.getByText('Incomplete', { exact: false }).first()).toBeVisible();
      expect(await overflowing(page), 'ล้นจอ').toEqual([]);
      expect(await obscured(page), 'ถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });
    test('Holdings: ป้าย Needs rate ที่แถว · กล่องแจ้งเดียว · ไม่ล้นจอ', async ({ page }) => {
      const seen = watch(page);
      await page.route((url) => !/^(localhost|127.0.0.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=norate#/invest/portfolio/holdings');
      await expect(page.getByTestId('needs-rate-notice')).toHaveCount(1, { timeout: 20_000 });
      await expect(page.locator('.hd-badge', { hasText: 'Needs rate' }).first()).toBeVisible();
      expect(await overflowing(page), 'ล้นจอ').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });
  });
}
