import { expect, type Page } from '@playwright/test';

/** เมนูหลักของโหมด /invest (แถบบน) */
export const investNav = (page: Page) => page.getByRole('navigation', { name: 'Portfolio sections' });

/**
 * ไปหน้าย่อยของโหมด /invest ผ่านเมนูเลื่อนลง (กดปุ่มกลุ่ม แล้วกดรายการ · ใช้ได้ทั้งเมาส์บนคอมและการแตะบนมือถือ)
 * ชื่อลิงก์ของหน้าที่ยังไม่ทำมีคำว่า "Soon" ต่อท้าย จึงจับด้วยคำขึ้นต้น
 */
export async function goInvest(page: Page, group: 'Analytics' | 'Portfolio' | 'Tools', item: string): Promise<void> {
  const nav = investNav(page);
  const trigger = nav.getByRole('button', { name: group });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await nav.getByRole('link', { name: new RegExp(`^${item}( Soon)?$`) }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}
