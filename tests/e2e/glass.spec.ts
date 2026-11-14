import { expect, test, type Page } from '@playwright/test';
import { pageContrastFailures } from './helpers/contrast';

/**
 * เอฟเฟกต์ liquid glass (14 พ.ย. 2569): แสงสะท้อนบนกระจกตามเมาส์ (คอม) · ตอบสนองตอนแตะและลอยเบาๆ เอง (มือถือ) · หยุดเมื่อลดการเคลื่อนไหว
 * ใช้เฉพาะ transform/opacity · ไม่ขอสิทธิ์เซ็นเซอร์ · ทั้งโหมดมืดและสว่าง · 360/390/1280 · ข้อมูลสมมติจาก harness
 */
async function openApp(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/harness.html?seed=1');
  await expect(page.getByText('ข้าวมันไก่').first()).toBeVisible({ timeout: 20_000 });
}

const shineOpacity = (page: Page, selector: string, pseudo: boolean) =>
  page.evaluate(
    ([sel, usePseudo]) => {
      const el = document.querySelector(sel as string)!;
      return Number(getComputedStyle(el, usePseudo ? '::after' : null).opacity);
    },
    [selector, pseudo] as const,
  );

for (const theme of ['dark', 'light'] as const) {
  test.describe(`liquid glass คอม ${theme} 1280px`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: theme, locale: 'th-TH' });

    test('แสงตามเมาส์บนการ์ดกระจก: เปิดเมื่อเมาส์อยู่บนการ์ด ตำแหน่งตามเมาส์ ย้ายใบแล้วใบเก่าดับ ออกนอกการ์ดดับ', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openApp(page);
      const cards = page.locator('article.glass.card');
      expect(await cards.count()).toBeGreaterThan(1);
      const first = cards.nth(0);
      const second = cards.nth(1);
      const b1 = (await first.boundingBox())!;
      await page.mouse.move(b1.x + 40, b1.y + 30);
      await page.mouse.move(b1.x + 90, b1.y + 50);
      await expect(first).toHaveAttribute('data-fx', 'on');
      await expect.poll(() => first.evaluate((el) => el.style.getPropertyValue('--fx-x'))).toBe('90px');
      expect(await first.evaluate((el) => el.style.getPropertyValue('--fx-y'))).toBe('50px');
      await expect.poll(() => shineOpacity(page, 'article.glass.card', true)).toBe(1);
      // ย้ายไปการ์ดใบที่สอง
      const b2 = (await second.boundingBox())!;
      await page.mouse.move(b2.x + 20, b2.y + 20);
      await expect(second).toHaveAttribute('data-fx', 'on');
      await expect(first).not.toHaveAttribute('data-fx', 'on');
      // ออกนอกการ์ดทั้งหมด (มุมซ้ายบนของจอ ซึ่งไม่ใช่การ์ด)
      await page.mouse.move(2, 2);
      await expect(second).not.toHaveAttribute('data-fx', 'on');
      expect(errors).toEqual([]);
    });

    test('ตัวหนังสือบนการ์ดที่มีแสงอยู่ยังชัด (contrast AA ตอนเมาส์อยู่บนการ์ด)', async ({ page }) => {
      await openApp(page);
      const b = (await page.locator('article.glass.card').first().boundingBox())!;
      // จุดเมาส์ใกล้ขอบบนการ์ด (กึ่งกลางการ์ดใบนี้อยู่ใต้ dock ที่ลอยกลางล่างของจอ ≥1024px)
      await page.mouse.move(b.x + b.width / 2, b.y + 30);
      await expect(page.locator('article.glass.card').first()).toHaveAttribute('data-fx', 'on');
      const { failures, checked } = await pageContrastFailures(page);
      expect(checked).toBeGreaterThan(10);
      expect(failures.slice(0, 12)).toEqual([]);
    });

    test('การ์ด glass-lite (กระเป๋า ฯลฯ) ก็มีแสง · Sankey (เลื่อนแนวนอนเอง) ไม่มี', async ({ page }) => {
      await openApp(page);
      const wallets = page.locator('section.glass-lite.card.wallets');
      await wallets.scrollIntoViewIfNeeded();
      const b = (await wallets.boundingBox())!;
      await page.mouse.move(b.x + 30, b.y + 30);
      await expect(wallets).toHaveAttribute('data-fx', 'on');
      const sankey = page.locator('section.sankey');
      await sankey.scrollIntoViewIfNeeded();
      const sb = (await sankey.boundingBox())!;
      await page.mouse.move(sb.x + 30, sb.y + 30);
      await expect(sankey).not.toHaveAttribute('data-fx', /.+/);
    });
  });

  test.describe(`liquid glass หน้าล็อกอิน ${theme} 1280px`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: theme, locale: 'th-TH' });

    test('แสงตามเมาส์บนการ์ดล็อกอิน และล็อกอินยังพิมพ์ได้ปกติ', async ({ page }) => {
      await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/login-harness.html');
      const card = page.locator('section.auth-card');
      await expect(card).toBeVisible();
      const b = (await card.boundingBox())!;
      await page.mouse.move(b.x + 60, b.y + 60);
      await page.mouse.move(b.x + 120, b.y + 90);
      await expect(card).toHaveAttribute('data-fx', 'on');
      await expect.poll(() => card.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--fx-x'))).toBe('120px');
      await expect.poll(() => card.locator('.fx-shine').evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
      await page.locator('#login-username').fill('tester01');
      await expect(page.locator('#login-username')).toHaveValue('tester01');
    });
  });

  test.describe(`liquid glass มือถือ ${theme}`, () => {
    for (const w of [360, 390]) {
      test.describe(`${w}px`, () => {
        test.use({ viewport: { width: w, height: 800 }, colorScheme: theme, locale: 'th-TH', hasTouch: true, isMobile: true });

        test('ลอยเบาๆ เองบนกระจกแท้ และตอบสนองตอนแตะ แล้วกลับเป็นปกติ', async ({ page }) => {
          await openApp(page);
          const card = page.locator('article.glass.card').first();
          const drift = await page.evaluate(() => getComputedStyle(document.querySelector('article.glass.card')!, '::after').animationName);
          expect(drift).toBe('fx-drift');
          await card.scrollIntoViewIfNeeded();
          await card.tap({ position: { x: 40, y: 30 } });
          await expect(card).toHaveAttribute('data-fx', 'tap');
          expect(parseFloat(await card.evaluate((el) => el.style.getPropertyValue('--fx-x')))).toBeCloseTo(40, -1); // ±5px (เส้นขอบการ์ด 1px)
          await expect(card).not.toHaveAttribute('data-fx', /.+/, { timeout: 4000 }); // อนิเมชันแตะจบแล้วถอดเอง
        });

        test('เลื่อนหน้าด้วยนิ้ว (ไม่ใช่แตะ) ไม่มีคลื่นแสง · การ์ดที่ลอยเองมีแค่ 3 ใบแรก', async ({ page }) => {
          await openApp(page);
          const names = await page.evaluate(() => Array.from(document.querySelectorAll('article.glass.card')).map((el) => getComputedStyle(el, '::after').animationName));
          expect(names.filter((n) => n === 'fx-drift').length).toBe(Math.min(3, names.length));
          const card = page.locator('article.glass.card').first();
          await card.scrollIntoViewIfNeeded();
          const b = (await card.boundingBox())!;
          const cdp = await page.context().newCDPSession(page);
          // ลากนิ้วจากบนการ์ดขึ้น 120px (เลื่อนหน้า) แล้วปล่อย
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 40, y: b.y + 40 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + 40, y: b.y - 80 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await page.waitForTimeout(150);
          await expect(card).not.toHaveAttribute('data-fx', 'tap');
        });

        test('ตั้งลดการเคลื่อนไหว: ไม่มีแสง ไม่มีอนิเมชัน แตะแล้วไม่มีอะไรเกิด', async ({ browser }) => {
          const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, colorScheme: theme, locale: 'th-TH', hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
          const page = await ctx.newPage();
          await openApp(page);
          const card = page.locator('article.glass.card').first();
          const style = await page.evaluate(() => {
            const cs = getComputedStyle(document.querySelector('article.glass.card')!, '::after');
            return { display: cs.display, anim: cs.animationName };
          });
          expect(style.display).toBe('none');
          expect(style.anim).toBe('none');
          await card.scrollIntoViewIfNeeded();
          await card.tap({ position: { x: 40, y: 30 } });
          await expect(card).not.toHaveAttribute('data-fx', /.+/);
          await ctx.close();
        });
      });
    }
  });
}

test.describe('ลดการเคลื่อนไหวบนคอม', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', locale: 'th-TH' });

  test('ขยับเมาส์บนการ์ดแล้วไม่มีแสงและไม่มีการเขียนตำแหน่ง', async ({ page }) => {
    await openApp(page);
    const first = page.locator('article.glass.card').first();
    const b = (await first.boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + 30);
    await page.mouse.move(b.x + 90, b.y + 50);
    await expect(first).not.toHaveAttribute('data-fx', /.+/);
    expect(await first.evaluate((el) => el.style.getPropertyValue('--fx-x'))).toBe('');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('article.glass.card')!, '::after').display)).toBe('none');
  });
});

test.describe('วงโฟกัสไม่ถูกตัดโดยการ์ดที่ตัดขอบ (overflow: clip)', () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: 'th-TH' });

  test('ทุกองค์ประกอบที่โฟกัสได้ในการ์ดกระจกอยู่ในกรอบการ์ด (วงโฟกัส 4px ไม่เกิน clip margin) และกำหนด clip margin ไว้', async ({ page }) => {
    await openApp(page);
    const res = await page.evaluate(() => {
      const offenders: string[] = [];
      let margin = '';
      for (const card of Array.from(document.querySelectorAll('.glass, .glass-lite.card:not(.sankey)'))) {
        margin = getComputedStyle(card).overflowClipMargin;
        const c = card.getBoundingClientRect();
        for (const el of Array.from(card.querySelectorAll('a,button,input,select,textarea,summary,[tabindex]'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) offenders.push((el.textContent || el.tagName).trim().slice(0, 20));
        }
      }
      return { offenders, margin };
    });
    expect(res.offenders).toEqual([]);
    expect(res.margin).toContain('4px');
  });
});
