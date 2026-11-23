import { expect, test, type Page } from '@playwright/test';
import { REBALANCE_DISCLAIMER } from '../../src/domain/invest/rebalanceView';
import { pageContrastFailures } from './helpers/contrast';
import { obscured, overflowing, watch } from './helpers/layoutChecks';
import { goInvest } from './helpers/investNav';

/**
 * หน้า Tools → Rebalancing ของ /invest (invest-v2 · แบบร่าง 30 · R29) บน harness ?investDemo=rebal (src/dev/rebalanceDemo.ts · ข้อมูลสมมติชุดเดียวกับตัวอย่าง R29)
 * ตรวจ: ตัวอย่าง A (เปิด/ปิดเศษหุ้น) · ถอน (Short by) · ข้อความบังคับ · ไม่มีคำต้องห้ามและไม่มีปุ่มสร้างรายการ · ข้อมูลผิดรูป · ไม่ครบเงื่อนไข · ส่งออก CSV · จำค่าตั้ง · ไม่ล้นจอ
 * 1280/1440 = หลัก · 360/390 = ต้องไม่พัง · ข้อมูลสมมติทั้งหมด
 */
const WIDTHS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const HEADING = { name: 'Portfolio rebalancing', level: 2, exact: true } as const;

async function open(page: Page, demo = 'rebal'): Promise<void> {
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.goto(`/harness.html?seed=1&investDemo=${demo}#/invest/tools/rebalancing`);
  await expect(page.getByRole('heading', HEADING)).toBeVisible({ timeout: 20_000 });
}

async function noOverflow(page: Page): Promise<void> {
  const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(doc.scroll, `page scrolls sideways (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
  expect(await overflowing(page), 'overflowing elements').toEqual([]);
  expect(await obscured(page), 'covered controls').toEqual([]);
}

const amountField = (page: Page, kind: 'Deposit' | 'Withdrawal' = 'Deposit') => page.getByLabel(new RegExp(`^${kind} amount`));
const seeResult = (page: Page) => page.getByRole('button', { name: 'See result' });
const tradeRow = (page: Page, ticker: string) => page.getByRole('table', { name: /Trades needed/ }).getByRole('row', { name: new RegExp(`^${ticker}`) });

async function openSetup(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /^Set up/ });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
}

/** ยอดฝากของตัวอย่าง A (35,000 เซนต์ใน tests/fixtures/r29-examples.json) · ผลที่คาดเขียนตรงๆ ด้านล่างเพราะ e2e ตรวจสิ่งที่ผู้ใช้เห็นบนหน้าจอ (unit test ตรวจตรงกับ fixture แล้ว) */
const DEPOSIT_A = '350';

for (const w of WIDTHS) {
  test.describe(`Rebalancing ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, locale: 'en-US', timezoneId: 'Asia/Bangkok' });

    test('เปิดจากเมนู Tools: ไม่ใช่ Coming soon · ฟอร์มมี label · ยังไม่มี Result · ไม่ล้นจอ ไม่มี error', async ({ page }) => {
      const seen = watch(page);
      await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
      await page.goto('/harness.html?seed=1&investDemo=rebal#/invest');
      await goInvest(page, 'Tools', 'Portfolio rebalancing');
      await expect(page.getByRole('heading', HEADING)).toBeVisible();
      await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(0);
      await expect(amountField(page)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Result', exact: true })).toHaveCount(0);
      await noOverflow(page);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('ตัวอย่าง A เปิดเศษหุ้น: CCC 2.187 = $131.22 · DDD 8.750 = $218.75 · Left over $0.03 · ข้อความบังคับ · ไม่มีคำต้องห้าม/ปุ่มสร้างรายการ', async ({ page }) => {
      const seen = watch(page);
      await open(page);
      await amountField(page).fill(DEPOSIT_A);
      await seeResult(page).click();
      await expect(page.getByRole('heading', { name: 'Result', exact: true, level: 3 })).toBeVisible();
      await expect(page.getByText('Trades needed to reach your target', { exact: true }).first()).toBeVisible();
      await expect(tradeRow(page, 'CCC')).toContainText('2.187');
      await expect(tradeRow(page, 'CCC')).toContainText('$131.22');
      await expect(tradeRow(page, 'CCC')).toContainText('Buy');
      await expect(tradeRow(page, 'DDD')).toContainText('8.750');
      await expect(tradeRow(page, 'DDD')).toContainText('$218.75');
      await expect(tradeRow(page, 'DDD')).toContainText('as of 2026-11-12');
      await expect(page.getByText('Left over', { exact: true })).toBeVisible();
      await expect(page.locator('.rb-totals')).toContainText('$0.03');
      await expect(page.getByRole('table', { name: /Allocation before and after/ })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'After (closest without selling)' })).toBeVisible();
      // ข้อความบังคับ (ตรงตัว) ติดกับ Result
      const result = page.locator('.rb-result');
      await expect(result).toContainText(REBALANCE_DISCLAIMER);
      // ไม่มีคำต้องห้ามทั้งหน้า (ยกเว้นประโยคบังคับที่ต้องมีคำว่า advice/adviser ตามกฎ) และไม่มีปุ่มสร้างรายการ
      const body = ((await page.locator('#main').innerText()) ?? '').replace(REBALANCE_DISCLAIMER, '');
      expect(body).not.toMatch(/recommend|advice|advis|คำแนะนำ|ควร|ดีที่สุด|เหมาะสม|guarantee/i);
      await expect(page.getByRole('button', { name: /planned|create|add .*(buy|trade)|record|log trade/i })).toHaveCount(0);
      await noOverflow(page);
      expect(seen.external).toEqual([]);
      expect(seen.errors).toEqual([]);
    });

    test('ตัวอย่าง A ปิดเศษหุ้น: เต็มหุ้น CCC 2 = $120.00 · DDD 8 = $200.00 · Left over $30.00 · จำค่าตั้งหลังรีโหลด', async ({ page }) => {
      await open(page);
      await openSetup(page);
      await page.getByLabel('Fractional shares').uncheck();
      await amountField(page).fill(DEPOSIT_A);
      await seeResult(page).click();
      await expect(tradeRow(page, 'CCC')).toContainText('$120.00');
      await expect(tradeRow(page, 'CCC')).not.toContainText('2.000');
      await expect(tradeRow(page, 'DDD')).toContainText('$200.00');
      await expect(page.locator('.rb-totals')).toContainText('$30.00');
      await page.reload();
      await expect(page.getByRole('heading', HEADING)).toBeVisible({ timeout: 20_000 });
      await openSetup(page);
      await expect(page.getByLabel('Fractional shares')).not.toBeChecked();
      await expect(page.getByLabel('Allow sales')).not.toBeChecked();
    });

    test('Allow sales ว่างยอด (ตัวอย่าง B): ขาย AAA/BBB ก่อนซื้อ · ตารางมีหัว After ธรรมดา', async ({ page }) => {
      await open(page);
      await openSetup(page);
      await page.getByLabel('Allow sales').check();
      await seeResult(page).click();
      const rows = page.getByRole('table', { name: /Trades needed/ }).getByRole('row');
      await expect(tradeRow(page, 'AAA')).toContainText('Sell');
      await expect(tradeRow(page, 'AAA')).toContainText('1.687');
      await expect(tradeRow(page, 'AAA')).toContainText('$168.70');
      await expect(tradeRow(page, 'BBB')).toContainText('1.125');
      await expect(tradeRow(page, 'CCC')).toContainText('0.749');
      await expect(tradeRow(page, 'DDD')).toContainText('7.198');
      await expect(page.locator('.rb-totals')).toContainText('$0.06');
      expect(await rows.count()).toBeGreaterThan(5);
      await expect(page.getByRole('columnheader', { name: 'After', exact: true })).toBeVisible();
      await noOverflow(page);
    });

    test('ถอน (ตัวอย่าง C): ขาย AAA 0.862 / BBB 0.575 · Short by $0.05 · ไม่มีแถวซื้อ', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Withdrawal', exact: true }).click();
      await amountField(page, 'Withdrawal').fill('115');
      await seeResult(page).click();
      await expect(tradeRow(page, 'AAA')).toContainText('0.862');
      await expect(tradeRow(page, 'AAA')).toContainText('Sell');
      await expect(tradeRow(page, 'BBB')).toContainText('0.575');
      await expect(page.getByText('Short by', { exact: true })).toBeVisible();
      await expect(page.locator('.rb-totals')).toContainText('$0.05');
      await expect(page.getByRole('row', { name: /^(CCC|DDD)/ })).toHaveCount(0);
      await expect(page.locator('.rb-warnings')).toHaveCount(0);
      await noOverflow(page);
    });

    test('อินพุตผิด: ลบ · ทศนิยมเกิน 2 ตำแหน่ง · ไม่ใช่ตัวเลข ถูกปฏิเสธและไม่ขึ้น Result', async ({ page }) => {
      await open(page);
      for (const [text, message] of [
        ['-5', /cannot be negative/],
        ['1.005', /at most 2 decimal places/],
        ['abc', /Enter a number/],
      ] as const) {
        await amountField(page).fill(text);
        await seeResult(page).click();
        await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Result', exact: true })).toHaveCount(0);
      }
      await amountField(page).fill('');
      await seeResult(page).click();
      await expect(page.getByText(/Not calculated\./)).toBeVisible();
      await expect(page.getByText(/turn on "Allow sales"/).last()).toBeVisible();
    });

    test('ถอนเกินมูลค่า: ไม่คำนวณ พร้อมเหตุผล · ข้อความบังคับยังติดอยู่', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Withdrawal', exact: true }).click();
      await amountField(page, 'Withdrawal').fill('5000');
      await seeResult(page).click();
      await expect(page.getByText(/more than the market value/)).toBeVisible();
      await expect(page.locator('.rb-result')).toContainText(REBALANCE_DISCLAIMER);
    });

    test('ยังไม่มีหมวด/เป้า: ข้อความนำทางไปหน้า Categories · สินทรัพย์บาทในหมวด: ไม่คำนวณ', async ({ page }) => {
      await open(page, 'rebal-empty');
      await expect(page.getByRole('heading', { name: 'Set up categories and target allocations first' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'See result' })).toHaveCount(0);
      await page.getByRole('main').getByRole('button', { name: 'Categories' }).last().click();
      await expect(page.getByRole('heading', { name: 'Categories', level: 2, exact: true })).toBeVisible();
      await noOverflow(page);

      await open(page, 'rebal-baht');
      await amountField(page).fill('350');
      await seeResult(page).click();
      await expect(page.getByText(/priced in baht/)).toBeVisible();
      await expect(page.getByRole('table', { name: /Trades needed/ })).toHaveCount(0);
    });

    test('ส่งออก CSV: มีข้อความบังคับท้ายไฟล์ · แถวซื้อตรงกับหน้าจอ', async ({ page }) => {
      await open(page);
      await amountField(page).fill('350');
      await seeResult(page).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
      expect(download.suggestedFilename()).toMatch(/^rebalancing-result-\d{4}-\d{2}-\d{2}\.csv$/);
      const stream = await download.createReadStream();
      let text = '';
      for await (const chunk of stream) text += chunk.toString('utf8');
      expect(text).toContain('Buy,CCC,CCC Corp,Health,2.187,60.00,2026-11-12,131.22');
      expect(text).toContain('Buy,DDD,DDD Corp,Funds,8.750,25.00,2026-11-12,218.75');
      expect(text).toContain('Left over (USD),0.03');
      expect(text.trimEnd().endsWith(`"${REBALANCE_DISCLAIMER}"`)).toBe(true);
    });

    for (const theme of ['dark', 'light'] as const) {
      test(`ตัวหนังสือผ่าน WCAG AA (${theme}) ตอนมี Result และ Set up เปิดอยู่`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await open(page);
        await openSetup(page);
        await amountField(page).fill(DEPOSIT_A);
        await seeResult(page).click();
        await expect(tradeRow(page, 'CCC')).toBeVisible();
        const { failures, checked } = await pageContrastFailures(page);
        expect(checked).toBeGreaterThan(20);
        expect(failures.slice(0, 12), 'low-contrast text').toEqual([]);
      });
    }

    test('แก้อินพุตหลังกด See result: ผลจางลง + aria-busy + Export ปิด · ข้อความบังคับอยู่ใต้หัว Result ก่อนตาราง · ช่องประกาศผลเดียว', async ({ page }) => {
      await open(page);
      await amountField(page).fill(DEPOSIT_A);
      await seeResult(page).click();
      await expect(tradeRow(page, 'CCC')).toBeVisible();
      await expect(page.locator('.rb-page [aria-live]')).toHaveCount(1);
      await expect(page.locator('.rb-page [aria-live]')).toHaveText('Result updated: 2 trades');
      await expect(page.locator('.rb-result [role="status"], .rb-result [aria-live]')).toHaveCount(0);
      const order = await page.evaluate(() => {
        const d = document.querySelector('.rb-disclaimer');
        const t = document.querySelector('.rb-result table');
        return !!d && !!t && (d.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      });
      expect(order).toBe(true);
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
      await amountField(page).fill('360');
      await expect(page.getByText('Inputs changed. Press See result to update.')).toBeVisible();
      await expect(page.locator('.rb-result')).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('.rb-body.is-stale')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
      await seeResult(page).click();
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
      await expect(page.locator('.rb-body.is-stale')).toHaveCount(0);
    });

    test('ยอดขั้นต่ำผิดรูป: เปิด Set up เองและแสดงข้อผิดพลาด', async ({ page }) => {
      await open(page);
      await openSetup(page);
      await page.getByLabel('Minimum order amount (USD)').fill('1.234');
      await page.getByRole('button', { name: /^Set up/ }).click(); // ปิด
      await seeResult(page).click();
      await expect(page.getByRole('alert').filter({ hasText: /at most 2 decimal places/ })).toBeVisible();
    });

    test('คีย์บอร์ด: Tab ถึงฟิลด์ยอด กรอกแล้ว Enter ส่งฟอร์ม · ผลลัพธ์อยู่ใน aria-live สุภาพ', async ({ page }) => {
      await open(page);
      await expect(page.locator('.rb-form')).toBeVisible();
      await amountField(page).focus();
      await page.keyboard.type('350');
      await page.keyboard.press('Enter');
      await expect(tradeRow(page, 'CCC')).toContainText('2.187');
      await expect(page.locator('.rb-page [aria-live="polite"]')).toHaveText('Result updated: 2 trades');
    });
  });
}
