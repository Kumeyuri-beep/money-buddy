import { expect, test, type Page } from '@playwright/test';
import { goInvest, investNav } from './helpers/investNav';
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
  await expect(page.getByRole('navigation', { name: 'Portfolio sections' }).first()).toBeVisible();
}

for (const w of WIDTHS) {
  test.describe(`ความกว้าง ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    test('โหมดการลงทุน: ชื่อพอร์ต ปุ่ม ฿/USD ป้ายอัปเดต 4 แท็บ (ภาษาอังกฤษ) · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openInvest(page, w.mobile);

      const nav = investNav(page);
      await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
      for (const name of ['Analytics', 'Portfolio', 'Tools']) await expect(nav.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');

      const thb = page.getByRole('button', { name: '฿ THB', exact: true });
      const usd = page.getByRole('button', { name: '$ USD', exact: true });
      // ค่าเริ่มต้น USD (R26.1) · สลับแล้วจำค่า
      await expect(usd).toHaveAttribute('aria-pressed', 'true');
      await expect(thb).toHaveAttribute('aria-pressed', 'false');
      await thb.click();
      await expect(thb).toHaveAttribute('aria-pressed', 'true');
      await expect(usd).toHaveAttribute('aria-pressed', 'false');
      await usd.click();
      await expect(page.getByText('No prices or rates yet')).toBeVisible();

      await goInvest(page, 'Analytics', 'Common');
      await expect(page.getByRole('heading', { name: 'Analytics', level: 2 })).toBeVisible();
      await goInvest(page, 'Tools', 'Find the Dip');
      await expect(page.getByRole('heading', { name: 'Find the Dip', level: 2 })).toBeVisible();
      await page.getByRole('button', { name: 'Back to Dashboard' }).click();
      await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');

      const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
      expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
      expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
      expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
      expect(seen.errors, 'error ใน console').toEqual([]);
    });

    test('ปุ่มสกุล: ค่าเริ่มต้น USD · เลือก THB แล้วจำค่าหลังโหลดใหม่ (R26.1) · ไม่มีข้อความ Sample data / Main portfolio ใต้แถบบน', async ({ page }) => {
      await openHarness(page);
      await openInvest(page, w.mobile);
      const thb = page.getByRole('button', { name: '฿ THB', exact: true });
      const usd = page.getByRole('button', { name: '$ USD', exact: true });
      await expect(usd).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('Sample data')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Main portfolio' })).toHaveCount(0);
      await thb.click();
      await expect(thb).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(investNav(page)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: '฿ THB', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: '$ USD', exact: true }).click(); // คืนค่า
    });

    test('เมนูย่อย: ครบตามโครง มีเส้นคั่นกลุ่ม ไม่มี Community · My goal เป็นหน้า · ลิงก์ปฏิทินปันผลเปิดแท็บใหม่', async ({ page }) => {
      await openHarness(page);
      await openInvest(page, w.mobile);
      const nav = investNav(page);
      const expected: [string, string[][]][] = [
        ['Analytics', [['Common', 'Diversification', 'Dividends', 'Growth'], ['Metrics', 'Report']]],
        ['Portfolio', [['Holdings', 'Transactions', 'Dividend calendar', 'My goal'], ['Cash', 'Categories', 'Corporate actions']]],
        ['Tools', [['Portfolio rebalancing', 'Top dividend stocks', 'Dividend payout calendar', 'Find the Dip']]],
      ];
      for (const [group, sections] of expected) {
        await nav.getByRole('button', { name: group }).click();
        const panel = nav.getByRole('group', { name: group });
        await expect(panel).toBeVisible();
        const lists = panel.getByRole('list');
        await expect(lists).toHaveCount(sections.length); // 1 ส่วน = 1 กลุ่ม (เส้นคั่นอยู่ระหว่างกลุ่ม)
        for (let i = 0; i < sections.length; i++) {
          const names = await lists.nth(i).getByRole('listitem').evaluateAll((els) => els.map((e) => (e.querySelector('a,button')?.firstChild?.textContent ?? '').trim()));
          expect(names).toEqual(sections[i]);
        }
        await page.keyboard.press('Escape');
        await expect(nav.getByRole('button', { name: group })).toHaveAttribute('aria-expanded', 'false');
      }
      await expect(page.getByText('Community')).toHaveCount(0);

      await nav.getByRole('button', { name: 'Portfolio' }).click();
      // ปฏิทินปันผลเป็นลิงก์ภายนอก: แท็บใหม่ + noopener + ไอคอน ↗ (ไม่เปิดจริงในเทสต์: ห้ามคำขอออกนอกเครื่อง)
      await nav.getByRole('button', { name: 'Tools' }).click();
      const cal = nav.getByRole('link', { name: /^Dividend payout calendar/ });
      await expect(cal).toHaveAttribute('href', 'https://snowball-analytics.com/calendars/dividend-calendar');
      await expect(cal).toHaveAttribute('target', '_blank');
      expect(await cal.getAttribute('rel')).toContain('noopener');
      await expect(cal).toContainText('↗');
      // Top dividend stocks: ลิงก์ภายนอกแบบเดียวกัน
      const top = nav.getByRole('link', { name: /^Top dividend stocks/ });
      await expect(top).toHaveAttribute('href', 'https://snowball-analytics.com/tools/investing-ideas/stocks/dividend-stocks');
      await expect(top).toHaveAttribute('target', '_blank');
      expect(await top.getAttribute('rel')).toContain('noopener');
      await expect(top).toContainText('↗');
      await page.keyboard.press('Escape');

      await goInvest(page, 'Portfolio', 'My goal');
      await expect(page.getByRole('heading', { name: 'My goal', level: 2 })).toBeVisible();
    });

    test('ทุกหน้าย่อยมี URL ของตัวเอง · ปุ่ม back/forward ทำงาน · เปิดตรงที่ URL ได้ · หน้า Coming soon ไม่ว่างเปล่า', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openInvest(page, w.mobile);
      const hash = () => new URL(page.url()).hash;
      expect(hash()).toBe('#/invest');

      await goInvest(page, 'Analytics', 'Common');
      expect(hash()).toBe('#/invest/analytics/common');
      await goInvest(page, 'Analytics', 'Growth');
      expect(hash()).toBe('#/invest/analytics/growth');
      await expect(page.getByRole('heading', { name: 'Analytics · Growth', level: 2 })).toBeVisible();
      await goInvest(page, 'Portfolio', 'Categories');
      expect(hash()).toBe('#/invest/portfolio/categories');
      await expect(page.getByRole('heading', { name: 'Categories', level: 2 })).toBeVisible();
      await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(0); // Categories เป็นหน้าจริงแล้ว
      await goInvest(page, 'Tools', 'Find the Dip');
      expect(hash()).toBe('#/invest/tools/find-the-dip');
      await expect(page.getByText(/Needs automatic market data/)).toBeVisible();

      await page.goBack();
      expect(hash()).toBe('#/invest/portfolio/categories');
      await expect(page.getByRole('heading', { name: 'Categories', level: 2 })).toBeVisible();
      await page.goBack();
      await page.goBack();
      expect(hash()).toBe('#/invest/analytics/common');
      await expect(page.getByRole('heading', { name: 'Analytics', level: 2 })).toBeVisible();
      await page.goForward();
      expect(hash()).toBe('#/invest/analytics/growth');
      await expect(page.getByRole('heading', { name: 'Analytics · Growth', level: 2 })).toBeVisible();

      await page.goto('/harness.html?seed=1#/invest/portfolio/transactions');
      await page.reload();
      await expect(page.locator('#pf-panel-overview')).toBeVisible({ timeout: 20_000 });
      expect(hash()).toBe('#/invest/portfolio/transactions');
      expect(seen.errors, 'error ใน console').toEqual([]);
    });

    test('คีย์บอร์ด: ลูกศรลงเปิดเมนูและโฟกัสรายการแรก · ลูกศรเลื่อนรายการ · Esc ปิดแล้วโฟกัสกลับปุ่ม · ซ้าย/ขวาข้ามเมนูหลัก · Enter เลือกหน้า', async ({ page }) => {
      test.skip(w.mobile, 'ทดสอบคีย์บอร์ดบนคอม');
      await openHarness(page);
      await openInvest(page, w.mobile);
      const nav = investNav(page);
      const analytics = nav.getByRole('button', { name: 'Analytics' });
      await analytics.focus();
      await page.keyboard.press('ArrowDown');
      await expect(analytics).toHaveAttribute('aria-expanded', 'true');
      await expect(nav.getByRole('link', { name: /^Common/ })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(nav.getByRole('link', { name: /^Diversification/ })).toBeFocused();
      await page.keyboard.press('End');
      await expect(nav.getByRole('link', { name: /^Report/ })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(analytics).toHaveAttribute('aria-expanded', 'false');
      await expect(analytics).toBeFocused();

      await page.keyboard.press('ArrowRight');
      await expect(nav.getByRole('button', { name: 'Portfolio' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter'); // Transactions
      await expect(page.locator('#pf-panel-overview')).toBeVisible();
      await expect(page.locator('#inv-panel')).toBeFocused();

      await nav.getByRole('button', { name: 'Tools' }).focus();
      await page.keyboard.press('ArrowRight'); // วนกลับ Dashboard
      await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused();
    });

    test('หน้าหลักเหลือเฉพาะเงินใช้จ่าย: ไม่มีสัดส่วนพอร์ตลงทุนและความมั่งคั่งรวม · ยังมีการ์ดใช้ได้ต่อวันอย่างปลอดภัย', async ({ page }) => {
      await openHarness(page);
      await expect(page.getByText('ใช้ได้ต่อวันอย่างปลอดภัย').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'สัดส่วนพอร์ตลงทุน' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'ความมั่งคั่งรวม (ราคาตลาด)' })).toHaveCount(0);
      await expect(page.getByText('มูลค่าสุทธิ (ราคาทุน)')).toBeVisible();
    });

    test('Portfolio → Holdings มีฟังก์ชันหุ้นสหรัฐเดิมครบ (ปุ่มสร้างบัญชีเงินสด USD)', async ({ page }) => {
      await openHarness(page);
      await openInvest(page, w.mobile);
      await goInvest(page, 'Portfolio', 'Holdings');
      await expect(page.getByRole('button', { name: 'Create USD cash account' })).toBeVisible();
    });
  });
}

test.describe('เส้นทางและปุ่ม back/forward (1280)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('พอร์ต → #/invest · ภาษี → #/tax · back/forward กลับหน้าเดิมตามลำดับ', async ({ page }) => {
    const seen = watch(page);
    await openHarness(page);
    await openDesktopView(page, 'พอร์ตการลงทุน');
    await expect(page.getByRole('navigation', { name: 'Portfolio sections' }).first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/invest');

    await openDesktopView(page, 'คำนวณภาษี');
    await expect(page.getByRole('heading', { name: 'คำนวณภาษี', level: 2 }).first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/tax');

    await page.goBack();
    await expect(page.getByRole('navigation', { name: 'Portfolio sections' }).first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/invest');
    await page.goBack();
    await expect(page.getByText('ใช้ได้ต่อวันอย่างปลอดภัย').first()).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    await page.goForward();
    await expect(page.getByRole('navigation', { name: 'Portfolio sections' }).first()).toBeVisible();
    expect(seen.errors, 'error ใน console').toEqual([]);
  });

  test('เปิดตรงที่ URL (#/invest และ #/tax) แล้วอยู่หน้านั้นเลย · รีเฟรชแล้วยังอยู่หน้าเดิม', async ({ page }) => {
    await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
    await page.goto('/harness.html?seed=1#/invest');
    await expect(page.getByRole('navigation', { name: 'Portfolio sections' }).first()).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Portfolio sections' }).first()).toBeVisible({ timeout: 20_000 });
    await page.goto('/harness.html?seed=1#/tax');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'คำนวณภาษี', level: 2 }).first()).toBeVisible({ timeout: 20_000 });
  });
});
