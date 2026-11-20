import { expect, test } from '@playwright/test';
import { investNav } from './helpers/investNav';
import { openHarness } from './helpers/layoutChecks';

/**
 * เมนูย่อยของแถบบน /invest ต้องไม่ปิดเองเมื่อ "หน้าเลื่อนไปใต้เมาส์ที่ไม่ได้ขยับ" (บั๊กที่พบขณะไล่เทสต์ไม่นิ่ง 390px):
 * เบราว์เซอร์ส่ง pointerleave แบบสังเคราะห์หลังเลื่อนหน้า ถ้าเมนูปิดตามจะหายไประหว่างผู้ใช้เมาส์กำลังเลื่อนไปหารายการที่อยู่ใต้ขอบจอ (หน้าต่างแคบ/เตี้ย)
 * แต่เมื่อผู้ใช้ขยับเมาส์ออกจริง เมนูต้องปิดเหมือนเดิม (พฤติกรรมชี้เมาส์บนคอมไม่เปลี่ยน)
 */
for (const vp of [{ width: 390, height: 500 }, { width: 1280, height: 420 }]) {
  test.describe(`เมนูย่อยไม่ปิดเพราะหน้าเลื่อน ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, locale: 'en-US' });
    test('เลื่อนหน้าใต้เมาส์ที่นิ่ง = ยังเปิด · ขยับเมาส์ออกจริง = ปิด', async ({ page }) => {
      await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=1#/invest');
      await expect(investNav(page)).toBeVisible({ timeout: 20_000 });
      await page.mouse.move(1, 1);
      const trigger = investNav(page).getByRole('button', { name: 'Portfolio' });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const before = await page.evaluate(() => window.scrollY);
      // เลื่อนหน้าด้วยโปรแกรม (เหมือนที่ Playwright/เบราว์เซอร์เลื่อนเพื่อให้เห็นรายการ) ให้เมาส์ที่นิ่งอยู่ไปชี้ที่อื่น
      await page.evaluate(() => window.scrollBy(0, 400));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
      await page.waitForTimeout(700); // รอให้เบราว์เซอร์ส่ง pointer event สังเคราะห์หลังเลื่อน (ยืนยันว่าไม่ปิด)
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await page.mouse.move(1, 1); // ขยับเมาส์ออกจริง
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });
}
