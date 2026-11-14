import { expect, test, type Page } from '@playwright/test';

/**
 * การ์ดเงินเข้า-ออก (14 พ.ย. 2569): มือถือมีปุ่มสลับ "แผนภาพ / รายการ" (ค่าเริ่มต้นแผนภาพ จำค่าไว้ใน settings) · จอใหญ่เป็น Sankey เดิม
 * แผนภาพมือถือต้องอ่านได้ที่ 360px โดยไม่เลื่อนซ้ายขวา · แตะแท่งเพื่อดูยอด · ทั้งโหมดมืดและสว่าง · ข้อมูลสมมติจาก harness
 */
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
] as const;

async function open(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
}

/** ค่าที่บันทึกลง settings จริงแล้ว (อ่านจาก IndexedDB ของ harness) · ใช้รอให้บันทึกเสร็จก่อนโหลดหน้าใหม่ กันแข่งกับการบันทึก */
const storedView = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open('money-buddy');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction('meta', 'readonly').objectStore('meta').get('settings');
          get.onsuccess = () => resolve((get.result?.value?.cashFlowView as string | undefined) ?? null);
          get.onerror = () => reject(get.error);
        };
      }),
  );

const card = (page: Page) => page.locator('section.sankey');

for (const theme of ['dark', 'light'] as const) {
  for (const w of WIDTHS) {
    test.describe(`เงินเข้า-ออก ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });

      if (w.mobile) {
        test('ค่าเริ่มต้นเป็นแผนภาพ ไม่ล้นจอ ป้ายอยู่ในกรอบ แตะแท่งแล้วเห็นยอด', async ({ page }) => {
          await open(page);
          await expect(card(page)).toHaveAttribute('data-view', 'diagram');
          await expect(page.getByRole('button', { name: /^(✓ )?แผนภาพ$/ })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('.sankey-compact')).toBeVisible();
          await expect(page.locator('.sankey-bars')).toBeHidden();
          await expect(page.locator('.sankey-svg')).toBeHidden();
          const docWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(docWidth.scroll, 'หน้าเลื่อนแนวนอนได้').toBeLessThanOrEqual(docWidth.client + 1);
          // แผนภาพกว้างไม่เกินการ์ด (ไม่ต้องเลื่อนซ้ายขวา) และป้ายทุกอันอยู่ในกรอบแผนภาพ
          const fit = await page.evaluate(() => {
            const svg = document.querySelector('.sankey-compact svg') as SVGSVGElement;
            const box = svg.getBoundingClientRect();
            const sec = document.querySelector('section.sankey') as HTMLElement;
            const outside = Array.from(svg.querySelectorAll('text')).filter((t) => {
              const r = t.getBoundingClientRect();
              return r.left < box.left - 1 || r.right > box.right + 1;
            }).length;
            return { svgRight: box.right, secRight: sec.getBoundingClientRect().right, scrollable: sec.scrollWidth > sec.clientWidth + 1, outside, texts: svg.querySelectorAll('text').length };
          });
          expect(fit.svgRight).toBeLessThanOrEqual(fit.secRight + 1);
          expect(fit.outside, 'ป้ายล้นกรอบแผนภาพ').toBe(0);
          expect(fit.texts).toBeGreaterThan(3);
          // ปุ่มแตะสูงพอ (≥ 28px)
          const hits = page.locator('.sankey-compact [role=button]');
          expect(await hits.count()).toBeGreaterThan(1);
          for (const i of [0, (await hits.count()) - 1]) {
            const b = await hits.nth(i).boundingBox();
            expect(b!.height, 'ขนาดจุดแตะ').toBeGreaterThanOrEqual(30);
          }
          await expect(page.locator('.sankey-detail')).toContainText('แตะชื่อหรือแถบสีเพื่อดู');
          await hits.first().click();
          await expect(hits.first()).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('.sankey-detail')).toContainText('฿');
          await expect(page.locator('.sankey-detail')).toContainText('%');
        });

        test('สลับเป็นรายการ: แสดงกราฟแท่ง ซ่อนแผนภาพ จำค่าหลังโหลดใหม่ · สลับกลับได้', async ({ page }) => {
          await open(page);
          await page.getByRole('button', { name: /^(✓ )?รายการ$/ }).click();
          await expect(card(page)).toHaveAttribute('data-view', 'list');
          await expect(page.locator('.sankey-bars')).toBeVisible();
          await expect(page.locator('.sankey-compact')).toBeHidden();
          await expect.poll(() => storedView(page)).toBe('list');
          await page.reload();
          await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
          await expect(card(page)).toHaveAttribute('data-view', 'list');
          await expect(page.getByRole('button', { name: /^(✓ )?รายการ$/ })).toHaveAttribute('aria-pressed', 'true');
          await page.getByRole('button', { name: /^(✓ )?แผนภาพ$/ }).click();
          await expect(page.locator('.sankey-compact')).toBeVisible();
          await expect.poll(() => storedView(page)).toBeNull();
          await page.reload();
          await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
          await expect(card(page)).toHaveAttribute('data-view', 'diagram');
        });

        test('คีย์บอร์ด: โฟกัสแท่งแล้วกด Enter แสดงยอด', async ({ page }) => {
          await open(page);
          const first = page.locator('.sankey-compact [role=button]').first();
          await first.focus();
          await page.keyboard.press('Enter');
          await expect(first).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('.sankey-detail')).toContainText('฿');
        });
      } else {
        test('จอใหญ่: Sankey เดิม ไม่มีปุ่มสลับ ไม่มีแผนภาพกะทัดรัด', async ({ page }) => {
          await open(page);
          await expect(page.locator('.sankey-svg')).toBeVisible();
          await expect(page.locator('.sankey-compact')).toBeHidden();
          await expect(page.locator('.sankey-viewtoggle')).toBeHidden();
          await expect(page.locator('.sankey-bars')).toBeHidden();
        });
      }
    });
  }
}
