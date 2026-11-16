import { expect, test, type Page } from '@playwright/test';
import { openDesktopView } from './helpers/nav';
import { obscured, openHarness, overflowing, watch } from './helpers/layoutChecks';

/**
 * โหมดการลงทุน /invest และโหมดภาษี /tax (ขั้น 1 ปรับโครงเว็บ) บน harness (ที่เก็บในเครื่อง · ใช้ hash #/invest #/tax แทน path เพราะเป็นไฟล์ .html)
 * ตรวจ: หน้าหลักไม่มีส่วนลงทุนแล้ว · หัวโหมด/ปุ่ม ฿-USD/ป้ายอัปเดต/4 แท็บ · การ์ดรอราคาอัตโนมัติ · URL เปลี่ยนตามหน้า · ปุ่ม back/forward · เปิดตรงที่ URL ได้ · ไม่ล้นจอ
 * 360/390 (มือถือต้องไม่พัง) และ 1280/1440 (คอม) · ข้อมูลสมมติ ห้ามข้อมูลจริง
 */
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
] as const;

async function openInvest(page: Page, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'พอร์ต', exact: true }).first().click();
    await expect(dialog).toBeHidden();
  } else {
    await openDesktopView(page, 'พอร์ตการลงทุน');
  }
  await expect(page.getByRole('heading', { name: 'Main portfolio', level: 2 }).first()).toBeVisible();
}

for (const w of WIDTHS) {
  test.describe(`ความกว้าง ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    test('โหมดการลงทุน: ชื่อพอร์ต ปุ่ม ฿/USD ป้ายอัปเดต 4 แท็บ (ภาษาอังกฤษ) · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openInvest(page, w.mobile);

      const tabs = page.getByRole('tablist', { name: 'Portfolio sections' });
      for (const name of ['Dashboard', 'Analytics', 'Portfolio', 'Tools']) await expect(tabs.getByRole('tab', { name, exact: true })).toBeVisible();
      await expect(tabs.getByRole('tab', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-selected', 'true');

      const thb = page.getByRole('button', { name: '฿ THB', exact: true });
      const usd = page.getByRole('button', { name: '$ USD', exact: true });
      await expect(thb).toHaveAttribute('aria-pressed', 'true');
      await usd.click();
      await expect(usd).toHaveAttribute('aria-pressed', 'true');
      await expect(thb).toHaveAttribute('aria-pressed', 'false');
      await thb.click();
      await expect(page.getByText('No prices or rates yet')).toBeVisible();

      await tabs.getByRole('tab', { name: 'Analytics', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'วิเคราะห์พอร์ต', level: 2 })).toBeVisible();
      await tabs.getByRole('tab', { name: 'Tools', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Tools', level: 2 })).toBeVisible();

      await tabs.getByRole('tab', { name: 'Tools', exact: true }).focus();
      await page.keyboard.press('ArrowRight'); // วนกลับแท็บแรก
      await expect(tabs.getByRole('tab', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.getByRole('tab', { name: 'Dashboard', exact: true })).toBeFocused();

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });

    test('หน้าหลักเหลือเฉพาะเงินใช้จ่าย: ไม่มีสัดส่วนพอร์ตลงทุนและความมั่งคั่งรวม · ยังมีการ์ดใช้ได้ต่อวันอย่างปลอดภัย', async ({ page }) => {
      await openHarness(page);
      await expect(page.getByText('ใช้ได้ต่อวันอย่างปลอดภัย').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'สัดส่วนพอร์ตลงทุน' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'ความมั่งคั่งรวม (ราคาตลาด)' })).toHaveCount(0);
      await expect(page.getByText('มูลค่าสุทธิ (ราคาทุน)')).toBeVisible();
    });

    test('แท็บ Portfolio มีฟังก์ชันหุ้นสหรัฐเดิมครบ (แท็บย่อยหุ้นสหรัฐ ปุ่มสร้างบัญชีเงินสด USD)', async ({ page }) => {
      await openHarness(page);
      await openInvest(page, w.mobile);
      await page.getByRole('tab', { name: 'Portfolio', exact: true }).click();
      await page.getByRole('tab', { name: 'หุ้นสหรัฐ', exact: true }).click();
      await expect(page.getByRole('button', { name: 'สร้างบัญชีเงินสด USD' })).toBeVisible();
    });
  });
}

test.describe('เส้นทางและปุ่ม back/forward (1280)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('พอร์ต → #/invest · ภาษี → #/tax · back/forward กลับหน้าเดิมตามลำดับ', async ({ page }) => {
    const seen = watch(page);
    await openHarness(page);
    await openDesktopView(page, 'พอร์ตการลงทุน');
    await expect(page.getByRole('heading', { name: 'Main portfolio', level: 2 }).first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/invest');

    await openDesktopView(page, 'คำนวณภาษี');
    await expect(page.getByRole('heading', { name: 'คำนวณภาษี', level: 2 }).first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/tax');

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Main portfolio', level: 2 }).first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/invest');
    await page.goBack();
    await expect(page.getByText('ใช้ได้ต่อวันอย่างปลอดภัย').first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Main portfolio', level: 2 }).first()).toBeVisible();
    expect(seen.errors, 'error ใน console').toEqual([]);
  });

  test('เปิดตรงที่ URL (#/invest และ #/tax) แล้วอยู่หน้านั้นเลย · รีเฟรชแล้วยังอยู่หน้าเดิม', async ({ page }) => {
    await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
    await page.goto('/harness.html?seed=1#/invest');
    await expect(page.getByRole('heading', { name: 'Main portfolio', level: 2 }).first()).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Main portfolio', level: 2 }).first()).toBeVisible({ timeout: 20_000 });
    await page.goto('/harness.html?seed=1#/tax');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'คำนวณภาษี', level: 2 }).first()).toBeVisible({ timeout: 20_000 });
  });
});
