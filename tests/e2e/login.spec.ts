import { expect, test, type Page } from '@playwright/test';

/**
 * หน้าล็อกอิน (โคมไฟ · 14 พ.ย. 2569): กด/แตะ/Enter ที่โคมเพื่อเปิดปิดไฟ · ฟอร์มมองเห็นและใช้ได้เสมอ · ล็อกอินด้วยคีย์บอร์ดอย่างเดียวได้ · เคารพลดการเคลื่อนไหว
 * ใช้ตัวล็อกอินจำลองจาก src/dev/loginHarness.tsx (ไม่ต่อเครือข่าย) · มืด/สว่าง × 360/390/1280
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

async function open(page: Page): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto('/login-harness.html');
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
}

const scene = (page: Page) => page.locator('main.login-scene');
const lamp = (page: Page) => page.getByRole('button', { name: /ไฟบนหน้านี้/ });

for (const theme of ['dark', 'light'] as const) {
  for (const w of WIDTHS) {
    test.describe(`ล็อกอิน ${theme} ${w.width}px`, () => {
      test.use({ viewport: { width: w.width, height: w.height }, colorScheme: theme, locale: 'th-TH' });

      test('โคมเปิด/ปิดด้วยการคลิก · ฟอร์มมองเห็นและใช้ได้ทั้งสองสถานะ · ไม่ล้นจอ', async ({ page }) => {
        await open(page);
        await expect(scene(page)).toHaveAttribute('data-lit', 'on');
        await expect(lamp(page)).toHaveAttribute('aria-pressed', 'true');
        const box = await lamp(page).boundingBox();
        expect(box!.width, 'ขนาดโคมที่แตะได้').toBeGreaterThanOrEqual(44);
        for (const state of ['on', 'off'] as const) {
          if (state === 'off') {
            await lamp(page).click();
            await expect(scene(page)).toHaveAttribute('data-lit', 'off');
            await expect(lamp(page)).toHaveAttribute('aria-pressed', 'false');
          }
          await expect(page.locator('#login-username')).toBeVisible();
          await expect(page.locator('#login-password')).toBeVisible();
          await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeEnabled();
          const docWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(docWidth.scroll).toBeLessThanOrEqual(docWidth.client + 1);
          // ฟอร์มต้องไม่ถูกอะไรบัง
          const covered = await page.evaluate(() => {
            const el = document.getElementById('login-username')!;
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return hit !== el;
          });
          expect(covered, 'ช่องชื่อผู้ใช้ถูกบัง').toBe(false);
        }
      });

      test('ล็อกอินได้ด้วยคีย์บอร์ดอย่างเดียว (Tab → พิมพ์ → Enter) และโคมสลับด้วย Enter/Space', async ({ page }) => {
        await open(page);
        // โฟกัสแรกต้องเป็นช่องชื่อผู้ใช้ (โคมอยู่หลังฟอร์มในลำดับโฟกัส)
        await page.keyboard.press('Tab');
        await expect(page.locator('#login-username')).toBeFocused();
        await page.keyboard.type('tester01');
        await page.keyboard.press('Tab');
        await expect(page.locator('#login-password')).toBeFocused();
        await page.keyboard.type('wrong-password');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('alert')).toContainText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        await expect(page.locator('#login-password')).toBeFocused(); // โฟกัสกลับมาพิมพ์ต่อ
        await page.keyboard.type('correct-password-123');
        // โคมด้วยคีย์บอร์ด: Enter / Space
        await lamp(page).focus();
        await page.keyboard.press('Enter');
        await expect(scene(page)).toHaveAttribute('data-lit', 'off');
        await page.keyboard.press('Space');
        await expect(scene(page)).toHaveAttribute('data-lit', 'on');
        await page.keyboard.press('Enter');
        await expect(scene(page)).toHaveAttribute('data-lit', 'off');
        // ไฟปิดอยู่ก็ล็อกอินได้
        await page.locator('#login-password').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#signed-in')).toBeVisible();
      });
    });
  }
}

test.describe('ลดการเคลื่อนไหว (prefers-reduced-motion)', () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

  test('อนิเมชันและการเปลี่ยนแสงหยุดทั้งหมด แต่โคมยังสลับได้', async ({ page }) => {
    await open(page);
    const motion = await page.evaluate(() => {
      const q = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        swing: q('.lamp-swing').animationName,
        glow: q('.login-glow').transitionDuration,
        dim: q('.login-dim').transitionDuration,
        bulb: q('.lamp-bulb').transitionDuration,
      };
    });
    expect(motion.swing).toBe('none');
    for (const d of [motion.glow, motion.dim, motion.bulb]) expect(parseFloat(d), 'ระยะเวลาเปลี่ยน (วินาที)').toBeLessThanOrEqual(0.001); // ตาข่ายนิรภัยรวมของแอปตั้ง 0.001ms
    await lamp(page).click();
    await expect(scene(page)).toHaveAttribute('data-lit', 'off');
  });
});

test.describe('ปกติ (ไม่ลดการเคลื่อนไหว)', () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });

  test('มีอนิเมชันโคมแกว่งเบาๆ และแสงเปลี่ยนแบบนุ่ม (ใช้เฉพาะ transform/opacity)', async ({ page }) => {
    await open(page);
    const motion = await page.evaluate(() => {
      const q = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return { swing: q('.lamp-swing').animationName, glowProp: q('.login-glow').transitionProperty, dimProp: q('.login-dim').transitionProperty };
    });
    expect(motion.swing).toBe('lamp-sway');
    expect(motion.glowProp).toBe('opacity');
    expect(motion.dimProp).toBe('opacity');
  });
});
