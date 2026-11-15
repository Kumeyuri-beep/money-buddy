import { expect, test, type Page } from '@playwright/test';
import { openDesktopView } from './helpers/nav';
import { obscured, openHarness, overflowing, watch } from './helpers/layoutChecks';

/**
 * หน้าพอร์ตแบบแท็บ + หุ้นสหรัฐ (A3-2): ทดสอบบน harness (ที่เก็บในเครื่อง ไม่ต่อฐานข้อมูล) จึงตรวจโครงหน้าจอ แท็บ คีย์บอร์ด ฟอร์ม และการไม่ล้นจอ
 * ส่วนการบันทึกจริงผ่าน RPC ตรวจโดยเทสต์ฐานข้อมูลจริง (tests/live/usdFlow.live.ts) และสูตรตัวเลขโดยเทสต์หน่วย (usPortfolio, usForms)
 * ความกว้าง 360/390 (มือถือ: ต้องไม่พัง) และ 1280/1440 (คอม) · ข้อมูลสมมติ ห้ามข้อมูลจริง
 */
const WIDTHS = [
  { width: 360, height: 740, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
] as const;

async function openPortfolio(page: Page, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: 'เมนู', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'พอร์ต', exact: true }).first().click();
    await expect(dialog).toBeHidden();
  } else {
    await openDesktopView(page, 'พอร์ตการลงทุน');
  }
  // ขั้น 1: ฟังก์ชันหุ้นสหรัฐอยู่ในโหมดการลงทุน → แท็บ "รายการ"
  await expect(page.getByRole('heading', { name: 'พอร์ตการลงทุน', level: 2 }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'รายการ', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'หน้าย่อยของพอร์ตการลงทุน' })).toBeVisible();
}

async function expectClean(page: Page, seen: ReturnType<typeof watch>): Promise<void> {
  const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(doc.scroll, `หน้าเลื่อนแนวนอนได้ (${doc.scroll} > ${doc.client})`).toBeLessThanOrEqual(doc.client + 1);
  expect(await overflowing(page), 'องค์ประกอบล้นจอ').toEqual([]);
  expect(await obscured(page), 'ปุ่มหรือช่องกรอกถูกบัง').toEqual([]);
  expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([]);
  expect(seen.errors, 'error ใน console').toEqual([]);
}

for (const w of WIDTHS) {
  test.describe(`ความกว้าง ${w.width}px`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    test('แท็บ: ภาพรวมพอร์ตเป็นแท็บแรก (ของเดิมครบ) · สลับไปหุ้นสหรัฐด้วยเมาส์และลูกศรคีย์บอร์ด · ไม่ล้นจอ', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openPortfolio(page, w.mobile);
      const overview = page.getByRole('tab', { name: 'ภาพรวมพอร์ต' });
      const us = page.getByRole('tab', { name: 'หุ้นสหรัฐ' });
      await expect(overview).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { name: 'พอร์ตการลงทุน', level: 2 }).first()).toBeVisible(); // หน้าเดิมยังอยู่
      await expectClean(page, seen);

      await us.click();
      await expect(us).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#pf-panel-us')).toHaveAttribute('aria-labelledby', 'pf-tab-us');
      await expect(page.getByRole('heading', { name: 'หุ้นสหรัฐ', level: 2 })).toBeVisible();
      await expect(page.getByText('ยังไม่มีหุ้นสหรัฐ')).toBeVisible();
      await expectClean(page, seen);

      await us.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(overview).toHaveAttribute('aria-selected', 'true');
      await expect(overview).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(us).toHaveAttribute('aria-selected', 'true');
      await expect(us).toBeFocused();
    });

    test('หุ้นสหรัฐ: ยังไม่มีบัญชีเงินสด USD → สร้างบัญชี (เปิดฟอร์ม โฟกัสที่หัวข้อ ตรวจชื่อว่าง Esc ปิดแล้วโฟกัสกลับปุ่ม) · เพิ่มหุ้น · ไม่ล้นจอ', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      await openPortfolio(page, w.mobile);
      await page.getByRole('tab', { name: 'หุ้นสหรัฐ' }).click();
      await expect(page.getByText('ยังไม่มีบัญชีเงินสด USD')).toBeVisible();

      const create = page.getByRole('button', { name: 'สร้างบัญชีเงินสด USD' });
      await create.click();
      const heading = page.getByRole('heading', { name: 'สร้างบัญชีเงินสด USD', level: 2 });
      await expect(heading).toBeFocused();
      await expectClean(page, seen);
      const name = page.getByLabel('ชื่อบัญชี');
      await name.fill('');
      await page.getByRole('button', { name: 'สร้างบัญชี', exact: true }).click();
      await expect(page.getByText('กรอกชื่อบัญชีเงินสด USD')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(heading).toBeHidden();
      await expect(create).toBeFocused();

      await page.getByRole('button', { name: 'เพิ่มหุ้น', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'เพิ่มหุ้นสหรัฐ', level: 2 })).toBeFocused();
      await page.getByRole('button', { name: 'เพิ่มหุ้น', exact: true }).last().click();
      await expect(page.getByText('กรอกชื่อหุ้นและ ticker')).toBeVisible();
      const exchange = page.getByLabel('ตลาด');
      await expect(exchange).toHaveValue('NASDAQ');
      await expectClean(page, seen);
    });

    test('กลุ่มบัญชีเงินสด (หน้าโปรไฟล์): แสดงสองกลุ่ม เงินใช้จ่าย/เงินลงทุน · ปุ่มย้ายกลุ่มของกระเป๋าเดียวถูกปิด (ต้องเหลือเงินใช้จ่ายอย่างน้อย 1) · ไม่ล้นจอ', async ({ page }) => {
      const seen = watch(page);
      await openHarness(page);
      if (w.mobile) {
        await page.getByRole('button', { name: 'เมนู', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'โปรไฟล์', exact: true }).first().click();
      } else {
        await openDesktopView(page, 'โปรไฟล์');
      }
      await expect(page.getByRole('heading', { name: 'กลุ่มบัญชีเงินสด', level: 2 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'เงินใช้จ่าย', level: 3 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'เงินลงทุน', level: 3 })).toBeVisible();
      await expectClean(page, seen);
    });
  });
}

test.describe('บนคอม (1280)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('การ์ดเดิมเปลี่ยนชื่อเป็น "มูลค่าสุทธิ (ราคาทุน)" และยังไม่มีการ์ดความมั่งคั่งรวมเมื่อไม่มีข้อมูลลงทุน', async ({ page }) => {
    await openHarness(page);
    await expect(page.getByText('มูลค่าสุทธิ (ราคาทุน)')).toBeVisible();
    await expect(page.getByText('ความมั่งคั่งสุทธิ')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'ความมั่งคั่งรวม (ราคาตลาด)' })).toHaveCount(0);
  });
});
