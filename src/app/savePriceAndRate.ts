import type { AssetPrice, FxRateRecord } from '../domain/invest/types';
import type { LedgerRepository } from '../storage/ledgerRepository';

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
