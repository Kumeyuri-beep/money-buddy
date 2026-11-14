import type { Page } from '@playwright/test';

/**
 * เปิดหน้าบนคอม (≥1024px) ผ่าน dock แนวตั้ง · "โปรไฟล์" ไม่ได้อยู่ในรายการเมนูแล้ว แต่อยู่ในเมนูบัญชีท้าย dock ("โปรไฟล์และตั้งค่า")
 */
export async function openDesktopView(page: Page, name: string): Promise<void> {
  if (name === 'โปรไฟล์') {
    await page.getByRole('button', { name: 'บัญชีของฉัน', exact: true }).click();
    await page.getByRole('menuitem', { name: 'โปรไฟล์และตั้งค่า' }).click();
    return;
  }
  await page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name, exact: true }).click();
}
