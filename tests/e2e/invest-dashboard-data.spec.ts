import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';
import { obscured, overflowing, watch } from './helpers/layoutChecks';

/**
 * แดชบอร์ด /invest ตอนมีข้อมูล (PR 1 · แบบร่างใหม่ ภาษาอังกฤษ) บน harness ที่ใส่ข้อมูลลงทุนสมมติด้วย ?investDemo=1 (src/dev/investDemo.ts)
 * ตรวจ: 4 การ์ด + การ์ด Portfolio · ปุ่ม Warning (หุ้นตัวเดียวเกิน 20%) ขึ้นเมื่อชี้/โฟกัสและหายเมื่อออก · ชี้แถว/ชิ้นแล้วที่เหลือจาง กลางวงเปลี่ยน
 * ซ่อน/แสดงตัวเลข (จำค่า) · เมนูพอร์ต (แก้ชื่อแล้วจำค่า) · ปุ่มที่ยังไม่เปิดใช้ · ไม่ล้นจอ · contrast ทั้งโหมดมืดและสว่าง · เคารพ reduced-motion
 * ถ้าตั้ง SHOT_DIR จะบันทึกภาพหน้าจอไว้ที่นั่น (ใช้แนบ PR) · ข้อมูลสมมติทั้งหมด
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

async function openDemo(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1&investDemo=1#/invest');
  await expect(page.getByRole('navigation', { name: 'Portfolio sections' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Portfolio', level: 2, exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toBeVisible();
}

const shot = async (page: Page, name: string): Promise<void> => {
  const dir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

for (const w of WIDTHS) {
  test.describe(`แดชบอร์ดมีข้อมูล ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });
    const desktop = w.width >= 1024;

    test('การ์ดตัวเลขและตาราง Holdings · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openDemo(page);
      for (const name of ['Value', 'Total profit', 'IRR', 'Passive income']) await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Hide amounts' })).toBeVisible();
      await expect(page.getByText(/invested$/)).toBeVisible();
      await expect(page.getByText('Today', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('row')).toHaveCount(7); // หัวตาราง + 6 หุ้น
      await expect(page.getByRole('button', { name: 'Holdings', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const first = page.getByRole('row', { name: /Demo Alpha Tech/ });
      await expect(first).toContainText('DEMA');
      await expect(first).toContainText('%');
      await shot(page, `dashboard-${w.width}`);

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `page scrolls sideways (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'overflowing elements').toEqual([]);
      expect(await obscured(page), 'covered controls').toEqual([]);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('ปุ่ม Warning: ชี้/โฟกัสแล้วขึ้นป๊อปอัพ ออกแล้วหาย · Esc ปิด · มีข้อความอธิบายและ 5 อันดับ', async ({ page }) => {
      await openDemo(page);
      const warn = page.getByRole('button', { name: 'Warning' });
      await expect(warn).toBeVisible();
      const pop = page.getByRole('tooltip').filter({ hasText: 'Your asset allocation' });
      await expect(pop).toBeHidden();
      await warn.focus();
      await expect(pop).toBeVisible();
      await expect(pop).toContainText('Concentration risk');
      await expect(pop).toContainText('Largest portfolio weights');
      await expect(pop).toContainText('Demo Alpha Tech (DEMA)');
      await expect(pop).toContainText('not counted yet');
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
      await warn.blur();
      if (desktop) {
        await warn.hover();
        await expect(pop).toBeVisible();
        await shot(page, 'warning-popover-1280');
        await page.mouse.move(5, 5);
        await expect(pop).toBeHidden();
      }
    });

    test('ซ่อน/แสดงตัวเลขใน Value และจำค่าหลังโหลดใหม่', async ({ page }) => {
      await openDemo(page);
      await page.getByRole('button', { name: 'Hide amounts' }).click();
      await expect(page.getByRole('button', { name: 'Show amounts' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Hidden').first()).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Show amounts' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Show amounts' }).click();
      await expect(page.getByRole('button', { name: 'Hide amounts' })).toBeVisible();
    });

    test('สลับ Currency และสลับ ฿/USD: ตัวเลขเปลี่ยนสกุล', async ({ page }) => {
      await openDemo(page);
      await page.getByRole('button', { name: '$ USD', exact: true }).click();
      await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toContainText('$');
      await page.getByRole('button', { name: 'Currency', exact: true }).click();
      await expect(page.getByRole('row', { name: /US Dollar/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Currency', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Holdings', exact: true }).click();
      await page.getByRole('button', { name: '฿ THB', exact: true }).click();
      await expect(page.getByRole('row', { name: /Demo Alpha Tech/ })).toContainText('฿');
    });

    test('เมนูพอร์ต: แก้ชื่อแล้วจำค่า · Add a portfolio / My portfolios ยังไม่เปิดใช้ · Esc ปิด', async ({ page }) => {
      await openDemo(page);
      const btn = page.getByRole('button', { name: /Main portfolio/ });
      await btn.click();
      const menu = page.getByRole('dialog', { name: 'Portfolio' });
      await expect(menu).toBeVisible();
      await expect(menu.getByText('Edit portfolio')).toBeVisible();
      for (const name of ['+ Add a portfolio', 'My portfolios']) await expect(menu.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true');
      await shot(page, `portfolio-menu-${w.width}`);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(btn).toBeFocused();

      await btn.click();
      await menu.getByLabel('Name').fill('Growth');
      await menu.getByLabel('Description (optional)').fill('Long-term US stocks');
      await menu.getByLabel('Default currency').selectOption('USD');
      await menu.getByRole('button', { name: 'Save' }).click();
      await expect(menu).toBeHidden();
      await expect(page.getByRole('button', { name: /Growth/ })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: /Growth/ })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: '$ USD', exact: true })).toHaveAttribute('aria-pressed', 'true');
      // คืนค่าเริ่มต้น เพื่อไม่ให้กระทบเทสต์อื่น (ที่เก็บเป็นของเบราว์เซอร์นี้เท่านั้น)
      await page.getByRole('button', { name: /Growth/ }).click();
      await menu.getByLabel('Name').fill('Main portfolio');
      await menu.getByLabel('Description (optional)').fill('');
      await menu.getByLabel('Default currency').selectOption('USD');
      await menu.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('button', { name: /Main portfolio/ })).toBeVisible();
    });

    test('ชื่อว่างบันทึกไม่ได้ และบอกเหตุผล', async ({ page }) => {
      await openDemo(page);
      await page.getByRole('button', { name: /Main portfolio/ }).click();
      const menu = page.getByRole('dialog', { name: 'Portfolio' });
      await menu.getByLabel('Name').fill('   ');
      await menu.getByRole('button', { name: 'Save' }).click();
      await expect(menu.getByRole('alert')).toContainText('Enter a name');
    });

    test('ปุ่ม + Add ไปแท็บ Portfolio หุ้นสหรัฐ (ฟอร์มเดิม) · ปุ่มที่ยังไม่เปิดใช้มี tooltip', async ({ page }) => {
      await openDemo(page);
      for (const [name, tip] of [
        ['Ask AI', 'Ask AI — coming soon'],
        ['Search', 'automatic data'],
        ['Watchlist', 'automatic data'],
      ] as const) {
        const b = page.getByRole('button', { name, exact: true });
        await b.focus();
        await expect(page.getByRole('tooltip').filter({ hasText: tip }).first()).toBeVisible();
      }
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      expect(new URL(page.url()).hash).toBe('#/invest/portfolio/holdings'); // Add → Portfolio → Holdings (ฟอร์มเพิ่มรายการหุ้นสหรัฐ)
      await expect(page.getByRole('heading', { name: 'US stock portfolio', level: 2 })).toBeVisible();
    });

    test('ชี้แถว/โฟกัสแถว: ชิ้นนั้นพองออก ชิ้นอื่นจางลง แถวไฮไลต์ กลางวงแสดงรายการ', async ({ page }) => {
      await openDemo(page);
      const row = page.getByRole('row', { name: /Demo Beta Health/ });
      await row.focus();
      await expect(row).toHaveClass(/is-active/);
      await expect(page.locator('.iv-slice.is-active')).toHaveCount(1);
      await expect(page.locator('.iv-slice.is-dim')).toHaveCount(5);
      await expect(page.locator('.iv-donut-center')).toContainText('Demo Beta Health');
      await expect(page.locator('.iv-donut-center')).toContainText('%');
      if (desktop) {
        await page.getByRole('row', { name: /Demo Gamma Media/ }).hover();
        await expect(page.locator('.iv-donut-center')).toContainText('Demo Gamma Media');
        await shot(page, 'hover-row-1280');
        const box = (await page.locator('.iv-donut').boundingBox())!;
        const a = 0.17 * 2 * Math.PI; // กลางชิ้นแรก (34.5% ของวง เริ่มที่ 12 นาฬิกา)
        await page.mouse.move(box.x + ((200 + 108 * Math.sin(a)) / 400) * box.width, box.y + ((180 - 108 * Math.cos(a)) / 360) * box.height);
        await expect(page.locator('.iv-slice.is-active')).toHaveCount(1);
        await page.mouse.move(5, 5);
        await expect(page.locator('.iv-slice.is-dim')).toHaveCount(0);
      }
    });

    test('การ์ดล่าง (PR 2): empty state ตามที่กำหนด · ปุ่ม sort สลับทันที คำอธิบายขึ้นเฉพาะตอนชี้/โฟกัส · ⓘ ขึ้นข้อความ · แท่ง Received ใช้ปันผลจริง', async ({ page }) => {
      await openDemo(page);
      for (const name of ['Top day gainers', 'Top day losers', 'Recent and upcoming events', 'Future payments', 'My goal']) await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
      expect(await page.getByText('Available after automatic data is enabled', { exact: true }).count()).toBeGreaterThanOrEqual(3);
      await expect(page.getByRole('button', { name: 'See all →' })).toHaveAttribute('aria-disabled', 'true');

      const sort = page.getByRole('button', { name: /currently by percentage change/ }).first();
      const sortTip = page.getByRole('tooltip').filter({ hasText: 'Sort by the asset price change as a percentage' }).first();
      await expect(sortTip).toBeHidden();
      await sort.focus();
      await expect(sortTip).toBeVisible();
      await sort.click();
      await expect(page.getByRole('button', { name: /currently by value change/ }).first()).toContainText('$');
      await expect(page.getByRole('tooltip').filter({ hasText: 'Sort by change in the value of assets in the portfolio' }).first()).toBeVisible();

      await page.getByRole('button', { name: 'About Top day gainers' }).focus();
      await expect(page.getByRole('tooltip').filter({ hasText: 'intraday' }).first()).toBeVisible();
      await page.getByRole('button', { name: 'About Future payments' }).focus();
      await expect(page.getByRole('tooltip').filter({ hasText: 'BEFORE tax' })).toBeVisible();

      // ปันผลสมมติ 1 ครั้ง (ส.ค.) → แท่งเดียวที่สูงกว่า 0
      const heights = await page.locator('.iv-bar').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.height));
      expect(heights).toHaveLength(12);
      expect(heights.filter((h) => h !== '0%')).toHaveLength(1);
      const px = await page.locator('.iv-bar').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(Math.max(...px), 'the Received bar must have a visible height at every width').toBeGreaterThan(20);
      await shot(page, `lower-cards-${w.width}`);
    });

    test('My goal: Set a target ไปหน้าแผนเกษียณ', async ({ page }) => {
      await openDemo(page);
      await page.getByRole('button', { name: 'Set a target' }).click();
      await expect(page.getByRole('heading', { level: 2, name: /เกษียณ/ }).first()).toBeVisible();
    });

    for (const theme of ['dark', 'light'] as const) {
      test(`ตัวหนังสือผ่าน WCAG AA (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await openDemo(page);
        await page.waitForTimeout(500);
        await shot(page, `dashboard-${theme}-${w.width}`);
        const { failures, checked } = await pageContrastFailures(page);
        expect(checked).toBeGreaterThan(20);
        expect(failures.slice(0, 12), 'low-contrast text').toEqual([]);
      });
    }
  });
}

test.describe('reduced motion (1280)', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  test('ชิ้นโดนัทไม่ขยับ/ไม่มี transition แต่ยังจางลงและแถวไฮไลต์', async ({ page }) => {
    await openDemo(page);
    const row = page.getByRole('row', { name: /Demo Beta Health/ });
    await row.hover();
    const active = page.locator('.iv-slice.is-active');
    await expect(active).toHaveCount(1);
    expect(await active.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    expect(parseFloat(await active.evaluate((el) => getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
    await expect(page.locator('.iv-slice.is-dim')).toHaveCount(5);
  });
});
