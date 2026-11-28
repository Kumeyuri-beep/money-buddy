import { describe, expect, it } from 'vitest';
import { rateNotSavedText } from '../../src/app/savePriceAndRate';
import { AccountChangedError } from '../../src/storage/ledgerRepository';
import { StorageError } from '../../src/storage/repository';

describe('rateNotSavedText: ราคาเข้าแล้ว อัตราไม่เข้า', () => {
  it('บัญชีเปลี่ยน: ประโยคเดียวไม่ขัดกันเอง บอกให้โหลดใหม่และตรวจบัญชี ไม่ชวนกดบันทึกซ้ำ', () => {
    const text = rateNotSavedText(new AccountChangedError('x'), 'The signed-in account has changed. This action was not completed.');
    expect(text).toBe('The price was saved, but the exchange rate was not, because the signed-in account has changed. Reload the page and check which account you are signed in to.');
  });

  it('สาเหตุอื่น: บอกสาเหตุและขั้นต่อไป', () => {
    expect(rateNotSavedText(new StorageError('x'), 'Could not save.')).toBe('Price saved, but the exchange rate was not saved: Could not save. Your entries are still here. Press Save to try again.');
  });

  it('สาเหตุที่บอกให้ลองใหม่อยู่แล้ว ไม่พูดซ้ำ', () => {
    expect(rateNotSavedText(new Error('x'), 'Cannot connect. Check your internet connection and try again.')).toBe(
      'Price saved, but the exchange rate was not saved: Cannot connect. Check your internet connection and try again. Your entries are still here.',
    );
  });
});
