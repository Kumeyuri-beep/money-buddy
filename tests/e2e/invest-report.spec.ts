import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * หน้า Analytics → Report (/invest/analytics/report) บน harness ที่ใส่ข้อมูลสมมติมีประวัติราคารายเดือน (?investDemo=report)
 * ตรวจ: ตารางและแถวหลัก · กดชื่อ 2 แถวแล้วกราฟมี 2 สี · Clear all คืนค่า · สลับ USD/THB ตัวเลขเปลี่ยน · จัดกลุ่มไตรมาส/ปี
 * Export CSV ได้ไฟล์ในเครื่อง (ไม่มีคำขอออกนอกเครื่อง) · ไม่ล้นจอ · 1280/1440 และ 360/390 (มือถือต้องไม่พัง) · ข้อมูลสมมติทั้งหมด
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

async function openReport(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=report#/invest/analytics/report');
  await expect(page.getByRole('heading', { name: 'Analytics · Report', level: 2 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('table')).toBeVisible();
}

const rowOf = (page: Page, id: string) => page.locator(`tr[data-row="${id}"]`);
const nameBtn = (page: Page, id: string) => rowOf(page, id).getByRole('button');

for (const w of WIDTHS) {
  test.describe(`Report ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ตารางครบแถว · S&P 500 = Needs market data · ไม่ล้นจอ ไม่มี error ไม่มีคำขอออกนอกเครื่อง', async ({ page }) => {
      const seen = watch(page);
      await openReport(page);
      await expect(page.locator('tr.rp-group-row')).toHaveText(['Portfolio value', 'Total profit', 'Turnover', 'Total trades']);
      await expect(page.getByRole('columnheader', { name: 'Total', exact: true })).toBeVisible();
      await expect(rowOf(page, 'spx')).toContainText('Needs market data');
      await expect(rowOf(page, 'spxPct')).toContainText('Needs market data');
      await expect(rowOf(page, 'profitPct')).toContainText('%');
      await expect(page.getByTestId('report-incomplete')).toHaveCount(0); // ข้อมูลสมมติมีราคาและเรตครบทุกเดือน: ไม่ติดธง incomplete

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `page scrolls sideways (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'overflowing elements').toEqual([]);
      expect(await obscured(page), 'covered controls').toEqual([]);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('กดชื่อ 2 แถว = กราฟ 2 สี · Clear all คืนค่า · กดซ้ำเอาออก', async ({ page }) => {
      await openReport(page);
      await expect(page.getByTestId('report-chart-hint')).toBeVisible();
      await nameBtn(page, 'profit').click();
      await nameBtn(page, 'dividends').click();
      await expect(nameBtn(page, 'profit')).toHaveAttribute('aria-pressed', 'true');
      const chart = page.getByTestId('report-chart-money');
      await expect(chart).toBeVisible();
      await expect(page.getByTestId('report-legend-item')).toHaveCount(2);
      const fills = await chart.locator('rect[data-series]').evaluateAll((els) => [...new Set(els.map((e) => `${e.getAttribute('data-series')}:${e.getAttribute('fill')}`))]);
      expect(fills.length).toBe(2);
      expect(new Set(fills.map((f) => f.split(':')[1])).size).toBe(2);

      await nameBtn(page, 'dividends').click();
      await expect(page.getByTestId('report-legend-item')).toHaveCount(1);
      await nameBtn(page, 'dividends').click();
      await page.getByRole('button', { name: 'Clear all' }).click();
      await expect(page.getByTestId('report-chart-hint')).toBeVisible();
      await expect(page.getByTestId('report-legend-item')).toHaveCount(0);
      await expect(nameBtn(page, 'profit')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('button', { name: 'Clear all' })).toBeDisabled();
    });

    test('สลับ USD/THB ตัวเลขเปลี่ยน · FX ในมุมมอง USD เป็น — · จัดกลุ่มไตรมาส/ปี คอลัมน์เปลี่ยน', async ({ page }) => {
      await openReport(page);
      const usdText = await rowOf(page, 'end').innerText();
      expect(usdText).toContain('$');
      await expect(rowOf(page, 'fx').locator('td').nth(2)).toContainText('—');
      await page.getByRole('button', { name: '฿ THB', exact: true }).click();
      await expect(rowOf(page, 'end')).toContainText('฿');
      expect(await rowOf(page, 'end').innerText()).not.toBe(usdText);

      const monthly = await page.locator('thead th').count();
      await page.getByRole('button', { name: 'Quarterly', exact: true }).click();
      await expect(page.getByRole('columnheader', { name: /^Q\d 2026$/ }).first()).toBeVisible();
      expect(await page.locator('thead th').count()).toBeLessThan(monthly);
      await page.getByRole('button', { name: 'Yearly', exact: true }).click();
      await expect(page.getByRole('columnheader', { name: '2026', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Monthly', exact: true }).click();
      await page.getByLabel('Time period').selectOption('ytd');
      await expect(page.getByRole('columnheader', { name: 'Jan 2026' })).toBeVisible();
    });

    for (const theme of ['dark', 'light'] as const) {
      test(`ตัวหนังสือผ่าน WCAG AA (${theme}) ตอนเลือกแถวและมีกราฟ`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openReport(page);
        await nameBtn(page, 'profit').click();
        await nameBtn(page, 'fees').click();
        await page.waitForTimeout(300);
        const { failures, checked } = await pageContrastFailures(page);
        expect(checked).toBeGreaterThan(20);
        expect(failures.slice(0, 12), 'low-contrast text').toEqual([]);
      });
    }

    test('Export to Excel ได้ไฟล์ .csv ในเครื่อง ไม่มีคำขอออกนอกเครื่อง · สกุลตามปุ่ม · มี BOM', async ({ page }) => {
      const seen = watch(page);
      await openReport(page);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export to Excel/ }).click()]);
      expect(download.suggestedFilename()).toMatch(/^portfolio-report-USD-\d{4}-\d{2}-\d{2}\.csv$/);
      const stream = await download.createReadStream();
      const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
      let text = '';
      for await (const chunk of stream) text += decoder.decode(chunk as Uint8Array, { stream: true });
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain('Currency,USD');
      expect(text).toContain('Total profit (USD)');
      expect(seen.external).toEqual([]);
      await expect(page.getByRole('button', { name: 'Export to PDF' })).toBeVisible();
    });
  });
}
