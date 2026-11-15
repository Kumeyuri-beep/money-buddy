import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';
import { obscured, openHarness, overflowing, watch } from './helpers/layoutChecks';
import { openDesktopView } from './helpers/nav';

/**
 * แท็บ "แดชบอร์ด" ของโหมดพอร์ต (ลูกน้อง 1): ทดสอบบน harness (ที่เก็บในเครื่อง ยังไม่มีข้อมูลลงทุน) จึงตรวจ empty state ของทุกการ์ด การจัดวาง ปุ่ม ฿/USD ปุ่มสลับสัดส่วน contrast ไม่ล้นจอ
 * ตัวเลขจริงของแต่ละการ์ด (ตัวอย่างหลัก R24 รวม 774,113) ตรวจโดย tests/unit/investDashboard.test.ts
 * 1280/1440 = คอม (แถวบน 5 การ์ดเรียงแถวเดียว) · 360/390 = มือถือ (ต้องไม่พัง: คอลัมน์เดียว ไม่ล้นจอ)
 */
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
] as const;

const TOP_TITLES = ['มูลค่าพอร์ต', 'เงินลงทุน', 'กำไรรวม', 'ผลตอบแทนต่อปี (IRR)', 'รายได้ปันผลต่อปี'];
const OTHER_TITLES = ['มูลค่าพอร์ตย้อนหลัง', 'สัดส่วนพอร์ต', 'วันนี้ขึ้น/ลง', 'ปันผลรายเดือนปีนี้ (ก่อนภาษี)', 'กำไรมาจากไหน', 'ความคืบหน้าเป้าหมาย'];

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
  await expect(page.getByRole('heading', { name: 'พอร์ตการลงทุน', level: 2 }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'มูลค่าพอร์ต', level: 2, exact: true })).toBeVisible();
}

for (const w of WIDTHS) {
  test.describe(`แดชบอร์ดพอร์ต ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });

    test('ทุกการ์ดมีอยู่ + empty state ไม่มีเลขปลอม + ปุ่ม ฿/USD และสลับสัดส่วนได้ · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openDashboard(page, w.mobile);

      for (const title of [...TOP_TITLES, ...OTHER_TITLES]) {
        await expect(page.getByRole('heading', { name: title, level: 2, exact: true }), `การ์ด ${title}`).toBeVisible();
      }
      // ยังไม่มีหุ้น: การ์ดตัวเลขขึ้น empty state ไม่แสดงเลขเงิน
      await expect(page.getByText('ยังไม่มีหุ้น').first()).toBeVisible();
      // การ์ดที่ต้องมีราคาอัตโนมัติ
      expect(await page.getByText('ใช้ได้เมื่อเปิดราคาอัตโนมัติ').count()).toBeGreaterThanOrEqual(2);
      await expect(page.getByText('ยังไม่ได้ตั้งเป้าหมาย')).toBeVisible();

      // ปุ่ม ฿/USD ไม่ทำให้หน้าพัง
      await page.getByRole('button', { name: 'ดอลลาร์สหรัฐ', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'มูลค่าพอร์ต', level: 2, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'บาท', exact: true }).click();

      // สลับสัดส่วน หุ้น/สกุลเงิน
      const byCurrency = page.getByRole('button', { name: 'สกุลเงิน', exact: true });
      await byCurrency.click();
      await expect(byCurrency).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'หุ้น', exact: true })).toHaveAttribute('aria-pressed', 'false');

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });

    test(w.mobile ? 'มือถือ: การ์ดเรียงคอลัมน์เดียว (หน้าตาเดิมไม่พัง)' : 'คอม: แถวบน 5 การ์ดอยู่แถวเดียว · แถวกลางและล่างแถวละ 3 การ์ด', async ({ page }) => {
      await openHarness(page);
      await openDashboard(page, w.mobile);
      const boxes = async (titles: string[]) => {
        const out: { x: number; y: number; w: number }[] = [];
        for (const t of titles) {
          const b = await page.getByRole('heading', { name: t, level: 2, exact: true }).locator('xpath=ancestor::section[1]').boundingBox();
          expect(b, `ไม่พบกรอบการ์ด ${t}`).not.toBeNull();
          out.push({ x: b!.x, y: b!.y, w: b!.width });
        }
        return out;
      };
      const top = await boxes(TOP_TITLES);
      const mid = await boxes(OTHER_TITLES.slice(0, 3));
      const bottom = await boxes(OTHER_TITLES.slice(3));
      if (w.mobile) {
        for (const b of [...top, ...mid, ...bottom]) expect(Math.abs(b.x - top[0]!.x)).toBeLessThanOrEqual(1);
        expect(top[1]!.y).toBeGreaterThan(top[0]!.y);
      } else {
        for (const row of [top, mid, bottom]) {
          for (const b of row) expect(Math.abs(b.y - row[0]!.y), 'การ์ดในแถวเดียวกันต้องบรรทัดเดียวกัน').toBeLessThanOrEqual(1);
          const xs = row.map((b) => b.x);
          expect([...xs].sort((a, b) => a - b), 'การ์ดเรียงซ้ายไปขวา').toEqual(xs);
        }
        expect(top[0]!.w, 'การ์ดมูลค่าพอร์ตใหญ่สุด').toBeGreaterThan(top[1]!.w);
        expect(mid[0]!.y).toBeGreaterThan(top[0]!.y);
        expect(bottom[0]!.y).toBeGreaterThan(mid[0]!.y);
      }
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
