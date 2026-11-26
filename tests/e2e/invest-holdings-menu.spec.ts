import { expect, test } from '@playwright/test';

/**
 * เมนู ⋯ ของ Holdings ต้องอยู่ติดปุ่ม อยู่ในจอ และไม่ถูกแถบอื่นบัง ทุกขนาดจอ (บั๊กการ์ดกระจกทำให้ position: fixed อิงกรอบการ์ด)
 * ลองทั้งตอนปุ่มอยู่กลางจอ ติดขอบล่าง และติดขอบบน · harness ?investDemo=1 (ข้อมูลสมมติ)
 */
for (const vp of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  test.describe(`เมนูแถว Holdings ${vp.width}px`, () => {
    test.use({ viewport: vp, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('อยู่ติดปุ่ม อยู่ในจอ ทุกรายการกดถึง', async ({ page }) => {
      await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=1#/invest/portfolio/holdings');
      await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toBeVisible({ timeout: 20_000 });
      for (const t of ['DEMA', 'DEMC', 'DEMF']) {
        for (const block of ['center', 'end', 'start'] as const) {
          const at = `${t} (${block})`;
          const btn = page.getByRole('button', { name: `Actions for ${t}` });
          await btn.evaluate((el, b) => el.scrollIntoView({ block: b, inline: 'end' }), block);
          await btn.click();
          const menu = page.getByRole('menu', { name: `Actions for ${t}` });
          await expect(menu).toBeVisible();
          const b = (await btn.boundingBox())!;
          const m = (await menu.boundingBox())!;
          expect(m.x, `${at}: ซ้าย`).toBeGreaterThanOrEqual(0);
          expect(m.x + m.width, `${at}: ขวา`).toBeLessThanOrEqual(vp.width + 1);
          expect(m.y, `${at}: บน`).toBeGreaterThanOrEqual(-1);
          expect(m.y + m.height, `${at}: ล่าง`).toBeLessThanOrEqual(vp.height + 1);
          const gap = Math.min(Math.abs(m.y - (b.y + b.height)), Math.abs(m.y + m.height - b.y));
          expect(gap, `${at}: ติดปุ่ม`).toBeLessThanOrEqual(12);
          const covered = await menu.evaluate((el) =>
            [...el.querySelectorAll('[role="menuitem"]')]
              .filter((item) => {
                const r = item.getBoundingClientRect();
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return !hit || !item.contains(hit);
              })
              .map((item) => item.textContent),
          );
          expect(covered, `${at}: รายการที่ถูกบัง`).toEqual([]);
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
        }
      }
    });
  });
}

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test.describe(`เมนูแถว Holdings คีย์บอร์ด ${vp.width}px`, () => {
    test.use({ viewport: vp, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('Tab / Shift+Tab ปิดเมนูแล้วโฟกัสไปต่อจากปุ่ม ⋯ ของแถวเดิม (ไม่หลุดไปท้ายหน้า)', async ({ page }) => {
      await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=1#/invest/portfolio/holdings');
      await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toBeVisible({ timeout: 20_000 });
      const first = page.getByRole('button', { name: 'Actions for DEMA' });
      await first.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Actions for DEMB' })).toBeFocused();

      const second = page.getByRole('button', { name: 'Actions for DEMB' });
      await second.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(first).toBeFocused();
    });
  });
}
