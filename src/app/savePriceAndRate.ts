import type { AssetPrice, FxRateRecord } from '../domain/invest/types';
import { AccountChangedError, type LedgerRepository } from '../storage/ledgerRepository';

/**
 * บันทึกราคาแล้วจึงบันทึกอัตราแลกเปลี่ยน (สองคำสั่ง ไม่อะตอมมิก)
 * ราคาเข้าแล้วแต่อัตราล้ม = คืน rateError ให้หน้าจอบอกตามจริง · ล้มโดยยังไม่มีอะไรเข้า = โยนตามปกติ
 */
export async function savePriceAndRate(
  repo: Pick<LedgerRepository, 'savePrice' | 'saveFxRate'>,
  input: { price?: AssetPrice; rate?: FxRateRecord },
): Promise<{ rateError?: unknown }> {
  if (input.price) await repo.savePrice(input.price);
  if (!input.rate) return {};
  try {
    await repo.saveFxRate(input.rate);
  } catch (rateError) {
    if (!input.price) throw rateError;
    return { rateError };
  }
  return {};
}

/** ข้อความ (โหมด /invest อังกฤษ) เมื่อราคาเข้าแล้วแต่อัตราไม่เข้า · reason = ข้อความอังกฤษของความผิดพลาด */
export function rateNotSavedText(error: unknown, reason: string): string {
  if (error instanceof AccountChangedError) {
    return 'The price was saved, but the exchange rate was not, because the signed-in account has changed. Reload the page and check which account you are signed in to.';
  }
  const next = /try again/i.test(reason) ? '' : ' Press Save to try again.';
  return `Price saved, but the exchange rate was not saved: ${reason} Your entries are still here.${next}`;
}
