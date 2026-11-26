import { expect, test, type Page } from '@playwright/test';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * Delete asset ในเมนู ⋯ ของหน้า Holdings (R2 ข้อ 4 ส่วน B · เฉพาะคอม ≥1024px) · harness ?investDemo=1 (ข้อมูลสมมติในหน่วยความจำ)
 * คอม: กดได้เฉพาะสินทรัพย์ที่ไม่เหลือรายการ (ที่เหลือรายการปิดพร้อม "Delete its N transaction(s) first") · มี dialog ยืนยัน · Keep ไม่ลบ
 * มือถือ (<1024px): ไม่มีรายการ Delete asset ในเมนูเลย (หน้าตาและพฤติกรรมเดิม)
 */
async function openHoldings(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=1#/invest/portfolio/holdings');
  await expect(page.getByRole('heading', { name: 'Holdings', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toBeVisible();
}

for (const w of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test.describe(`Delete asset (คอม ${w.width}px)`, () => {
    test.use({ viewport: w, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('ยังมีรายการ: ปิดพร้อมเหตุผล กดแล้วไม่เปิด dialog · ลบรายการก่อนแล้วจึงลบสินทรัพย์ได้ (Keep ไม่ลบ)', async ({ page }) => {
      const seen = watch(page);
      await openHoldings(page);
      const more = page.getByRole('button', { name: 'Actions for DEMF' });
      await more.click();
      const menu = page.getByRole('menu', { name: 'Actions for DEMF' });
      const del = menu.getByRole('menuitem', { name: /^Delete asset/ });
      await expect(del).toHaveAttribute('aria-disabled', 'true');
      await expect(del).toContainText('Delete its 1 transaction first');
      await del.click({ force: true }); // aria-disabled: ผู้ใช้กดได้ แต่ต้องไม่เกิดอะไร
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(menu).toBeVisible(); // ปิดอยู่: กดแล้วเมนูไม่ปิดและไม่ทำอะไร

      // ลบรายการทั้งหมดของ DEMF ก่อน (ปุ่ม Delete เดิม) สินทรัพย์ยังอยู่ในตารางโดยไม่มีรายการ
      await menu.getByRole('menuitem', { name: 'Delete all records', exact: true }).click();
      await page.getByRole('button', { name: 'Delete 1 record' }).click();
      await expect(page.getByText('Deleted DEMF: 1 record')).toBeVisible();
      await expect(page.getByRole('row', { name: /Demo Foxtrot Income ETF/ })).toBeVisible();

      await more.click();
      const del2 = page.getByRole('menu', { name: 'Actions for DEMF' }).getByRole('menuitem', { name: 'Delete asset', exact: true });
      await expect(del2).not.toHaveAttribute('aria-disabled', 'true');
      await del2.click();
      const dialog = page.getByRole('alertdialog', { name: /Delete asset DEMF/ });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('It has no transactions left, so no money changes');
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(more).toBeFocused();
      await expect(page.getByRole('row', { name: /Demo Foxtrot Income ETF/ })).toBeVisible(); // ยกเลิก = ไม่ลบ

      await more.click();
      await page.getByRole('menuitem', { name: 'Delete asset', exact: true }).click();
      await page.getByRole('alertdialog', { name: /Delete asset DEMF/ }).getByRole('button', { name: 'Delete asset' }).click();
      await expect(page.getByText('Deleted asset DEMF')).toBeVisible();
      await expect(page.getByRole('row', { name: /Demo Foxtrot Income ETF/ })).toHaveCount(0);
      expect(await overflowing(page), 'ล้นจอ').toEqual([]);
      expect(await obscured(page), 'ถูกบัง').toEqual([]);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('เมนู ⋯ อยู่ติดปุ่มและอยู่ในจอทุกแถว (ไม่หลุดไปใต้การ์ดกระจก)', async ({ page }) => {
      await openHoldings(page);
      for (const t of ['DEMA', 'DEMC', 'DEMF']) {
        const btn = page.getByRole('button', { name: `Actions for ${t}` });
        await btn.click();
        const b = (await btn.boundingBox())!;
        const m = (await page.getByRole('menu', { name: `Actions for ${t}` }).boundingBox())!;
        const view = page.viewportSize()!;
        expect(m.y, `${t}: เมนูอยู่ในจอด้านบน`).toBeGreaterThanOrEqual(0);
        expect(m.y + m.height, `${t}: เมนูอยู่ในจอด้านล่าง`).toBeLessThanOrEqual(view.height);
        // เมนูเปิดลงใต้ปุ่ม หรือพลิกขึ้นเหนือปุ่ม (ติดขอบปุ่ม ห่างไม่เกิน 12px)
        const below = Math.abs(m.y - (b.y + b.height));
        const above = Math.abs(m.y + m.height - b.y);
        expect(Math.min(below, above), `${t}: เมนูต้องอยู่ติดปุ่ม`).toBeLessThanOrEqual(12);
        await page.keyboard.press('Escape');
      }
    });

    test('Esc ปิดเมนูแล้วโฟกัสกลับปุ่ม ⋯ (รายการที่ปิดอยู่ไม่ขวางคีย์บอร์ด)', async ({ page }) => {
      await openHoldings(page);
      const more = page.getByRole('button', { name: 'Actions for DEMA' });
      await more.click();
      await page.keyboard.press('End');
      await expect(page.getByRole('menuitem', { name: /^Delete asset/ })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(more).toBeFocused();
    });
  });
}

for (const w of [{ width: 360, height: 740 }, { width: 390, height: 844 }]) {
  test.describe(`Delete asset (มือถือ ${w.width}px: ไม่แสดง)`, () => {
    test.use({ viewport: w, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('เมนู ⋯ ไม่มีรายการ Delete asset · เมนูเดิม 4 รายการยังทำงาน', async ({ page }) => {
      const seen = watch(page);
      await openHoldings(page);
      await page.getByRole('button', { name: 'Actions for DEMF' }).click();
      const menu = page.getByRole('menu', { name: 'Actions for DEMF' });
      await expect(menu.getByRole('menuitem')).toHaveCount(4);
      await expect(menu.getByRole('menuitem', { name: /Delete asset/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
      expect(seen.errors).toEqual([]);
    });
  });
}
