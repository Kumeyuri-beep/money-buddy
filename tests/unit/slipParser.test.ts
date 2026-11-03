import { describe, expect, it } from 'vitest';
import { buildEntry } from '../../src/app/entryForm';
import { learnFromHistory } from '../../src/app/quickText';
import { parseSlipText, slipToDraft } from '../../src/app/slipParser';
import { buildInitialLedger } from '../../src/app/setup';
import { createEntry } from '../../src/domain/ledger/entry';

// ข้อความทั้งหมดในไฟล์นี้เป็นข้อความสมมติ ห้ามนำข้อความจากสลิปจริงมาใส่

const SLIP = [
  'โอนเงินสำเร็จ',
  '12 พ.ย. 69 14:35 น.',
  'จาก นาย ทดสอบ ตัวอย่าง',
  'xxx-x-x1234-x',
  'ไปยัง ร้านกาแฟตัวอย่าง',
  'xxx-x-x5678-x',
  'จำนวน: 65.00 บาท',
  'ค่าธรรมเนียม: 0.00 บาท',
  'เลขที่รายการ: 000000000000',
].join('\n');

describe('parseSlipText: สลิป K PLUS แบบปกติ', () => {
  it('ดึงยอด วันที่ (พ.ศ. -> ค.ศ.) เวลา และผู้รับ', () => {
    expect(parseSlipText(SLIP)).toEqual({
      amount: '65.00',
      date: '2026-11-12',
      time: '14:35',
      recipient: 'ร้านกาแฟตัวอย่าง',
    });
  });

  it('ผู้รับอยู่บรรทัดถัดจากคำว่า "ไปยัง"', () => {
    const text = 'ไปยัง\nร้านข้าวตัวอย่าง\nจำนวน: 50.00 บาท\n3 ต.ค. 69 08:05 น.';
    expect(parseSlipText(text).recipient).toBe('ร้านข้าวตัวอย่าง');
  });

  it('ไม่หยิบชื่อผู้โอน (จาก) มาเป็นผู้รับ', () => {
    const text = 'จาก นาย ทดสอบ ตัวอย่าง\nจำนวน: 10.00 บาท';
    expect(parseSlipText(text).recipient).toBeUndefined();
  });
});

describe('parseSlipText: ยอดเงิน', () => {
  it.each([
    ['จำนวน: 1,234.50 บาท', '1,234.50'],
    ['จำนวน 0.01 บาท', '0.01'],
    ['จำนวนเงิน: 100.00 บาท', '100.00'],
    ['จำนวน: 999,999.99 บาท', '999,999.99'],
  ])('"%s" -> %s', (line, expected) => {
    expect(parseSlipText(line).amount).toBe(expected);
  });

  // สลิปแสดงทศนิยม 2 หลักเสมอ ตัวเลขที่รูปแบบเพี้ยนต้องเว้นว่าง ห้ามอ่านเป็นยอดอื่นเงียบๆ
  it.each([
    'จำนวน: 6500 บาท', // จุดทศนิยมหาย (คลาดเคลื่อน 100 เท่า)
    'จำนวน: 100 บาท',
    'จำนวน: 1 234.50 บาท', // ช่องว่างแทนจุลภาค
    'จำนวน: 65,50 บาท', // จุลภาคแทนจุดทศนิยม
    'จำนวน: 1,234,50 บาท',
    'จำนวน: 12,34.50 บาท',
    'จำนวน: 1.005 บาท', // ทศนิยมเกิน 2 หลัก
    'จำนวน: -65.00 บาท', // ไม่มียอดติดลบในสลิป
    'จำนวน: 65.00 บาท บาท 5',
  ])('"%s" -> ว่าง', (line) => {
    expect(parseSlipText(line).amount).toBeUndefined();
  });

  it('ป้าย "จำนวน" ไม่มีตัวเลข: ไม่หยิบค่าธรรมเนียมหรือเลขที่รายการบรรทัดถัดไปมาเป็นยอด', () => {
    expect(parseSlipText('จำนวน:\nค่าธรรมเนียม: 5.00 บาท').amount).toBeUndefined();
    expect(parseSlipText('จำนวน:\nเลขที่รายการ: 015123456789').amount).toBeUndefined();
  });

  it('ไม่มีป้าย: ไม่นับยอดคงเหลือ หรือยอดที่ตามหลังป้ายค่าธรรมเนียมคนละบรรทัด', () => {
    expect(parseSlipText('ยอดคงเหลือ 12,345.00 บาท').amount).toBeUndefined();
    expect(parseSlipText('ค่าธรรมเนียม:\n5.00 บาท').amount).toBeUndefined();
  });

  it('ยอด 0 ไม่ถือว่าอ่านได้ (ปล่อยว่างให้ผู้ใช้กรอก)', () => {
    expect(parseSlipText('จำนวน: 0.00 บาท').amount).toBeUndefined();
  });

  it('ไม่นำค่าธรรมเนียมมาเป็นยอด', () => {
    expect(parseSlipText('ค่าธรรมเนียม: 5.00 บาท').amount).toBeUndefined();
    expect(parseSlipText('ค่าธรรมเนียม: 5.00 บาท\nจำนวน: 80.00 บาท').amount).toBe('80.00');
  });

  it('ตัวเลขอยู่บรรทัดถัดจากป้าย "จำนวน"', () => {
    expect(parseSlipText('จำนวน\n250.00 บาท').amount).toBe('250.00');
  });

  it('ไม่มีป้าย: ใช้ยอดเดียวที่มีหน่วย "บาท" ถ้ามีตัวเดียวพอดี', () => {
    expect(parseSlipText('ร้านตัวอย่าง\n45.00 บาท').amount).toBe('45.00');
    expect(parseSlipText('45.00 บาท\n90.00 บาท').amount).toBeUndefined();
  });

  it('ทนช่องว่างเกินรอบจุดทศนิยมและสระ ำ ที่ OCR อ่านเพี้ยน', () => {
    expect(parseSlipText('จํานวน: 1,234 .50 บาท').amount).toBe('1,234.50');
  });

  it('ไม่มีตัวเลขเลย -> ว่าง', () => {
    expect(parseSlipText('โอนเงินสำเร็จ').amount).toBeUndefined();
    expect(parseSlipText('').amount).toBeUndefined();
  });
});

describe('parseSlipText: วันที่และเวลา', () => {
  it.each([
    ['1 ม.ค. 70 00:00 น.', '2027-01-01'],
    ['31 ธ.ค. 69 23:59 น.', '2026-12-31'],
    ['28 ก.พ. 69 10:00 น.', '2026-02-28'],
    ['29 ก.พ. 67 10:00 น.', '2024-02-29'], // ปีอธิกสุรทิน (2567)
    ['12 พ.ย. 2569 14:35 น.', '2026-11-12'],
    ['12 พฤศจิกายน 2569', '2026-11-12'],
    ['12 พย 69 14:35', '2026-11-12'], // OCR ทำจุดหาย
    ['12/11/2569', '2026-11-12'],
    ['12 Nov 2026', '2026-11-12'],
  ])('"%s" -> %s', (line, expected) => {
    expect(parseSlipText(line).date).toBe(expected);
  });

  it('วันที่ไม่มีจริง (29 ก.พ. ปีไม่อธิกสุรทิน, 31 เม.ย.) -> ว่าง ไม่เดา', () => {
    expect(parseSlipText('29 ก.พ. 69 10:00 น.').date).toBeUndefined();
    expect(parseSlipText('31 เม.ย. 69 10:00 น.').date).toBeUndefined();
  });

  it('ยอดอยู่ก่อนวันที่ (คนละบรรทัด) ต้องยังอ่านวันที่ได้', () => {
    expect(parseSlipText('65.00 บาท\n12 พ.ย. 69 14:35 น.').date).toBe('2026-11-12');
  });

  it('เดือนที่ไม่รู้จัก -> ว่าง', () => {
    expect(parseSlipText('12 xx. 69').date).toBeUndefined();
  });

  it('เวลาที่เป็นไปไม่ได้ (25:61) -> ว่าง', () => {
    expect(parseSlipText('12 พ.ย. 69 25:61 น.').time).toBeUndefined();
  });

  it('เวลาแบบ 9:05 เติมศูนย์นำหน้า', () => {
    expect(parseSlipText('12 พ.ย. 69 9:05 น.').time).toBe('09:05');
  });
});

describe('slipToDraft: เติมฟอร์มรายจ่ายให้ผู้ใช้ตรวจ', () => {
  const { accounts } = buildInitialLedger(
    [
      { name: 'CashFlow', opening: '' },
      { name: 'Mainframe', opening: '' },
    ],
    '2026-11-01',
  );
  const ctx = { accounts, today: '2026-11-20' };

  it('สลิปครบ: เป็นรายจ่าย ยอด/วันที่ตามสลิป เวลาอยู่ในบันทึกช่วยจำ', () => {
    const { form, missing } = slipToDraft(parseSlipText(SLIP), ctx);
    expect(form).toMatchObject({
      kind: 'expense',
      date: '2026-11-12',
      amount: '65.00',
      walletId: 'wallet-1',
      memo: 'ร้านกาแฟตัวอย่าง 14:35 น.',
    });
    // เดาหมวดจากคำว่า "กาแฟ" ไม่ได้เพราะขึ้นต้นด้วย "ร้าน" -> ต้องให้ผู้ใช้เลือก
    expect(missing).toEqual(['category']);
    expect(form.counterId).toBe('');
  });

  it('เดาหมวดจากรายการที่เคยบันทึกด้วยชื่อผู้รับเดิม', () => {
    const past = createEntry(
      accounts,
      buildEntry(
        accounts,
        { kind: 'expense', date: '2026-11-05', amount: '60', walletId: 'wallet-2', counterId: 'expense-fun', memo: 'ร้านกาแฟตัวอย่าง' },
        'e-past',
      ),
    );
    const learned = learnFromHistory(accounts, [past]);
    const { form, missing } = slipToDraft(parseSlipText(SLIP), { ...ctx, learned });
    expect(form.counterId).toBe('expense-fun');
    expect(form.walletId).toBe('wallet-2'); // กระเป๋าที่ใช้ล่าสุด
    expect(missing).toEqual([]);
  });

  it('สลิปปกติไม่มีคำเตือน', () => {
    expect(slipToDraft(parseSlipText(SLIP), ctx).warnings).toEqual([]);
  });

  describe('เพดานยอด 10,000,000 บาท', () => {
    const withAmount = (amount: string) => slipToDraft(parseSlipText(`จำนวน: ${amount} บาท`), ctx);

    it('เท่ากับเพดานพอดียังผ่าน', () => {
      const d = withAmount('10,000,000.00');
      expect(d.form.amount).toBe('10,000,000.00');
      expect(d.warnings).toEqual([]);
    });

    it('เกินเพดาน 1 สตางค์: ปล่อยว่าง ใส่ missing และมีคำเตือน', () => {
      const d = withAmount('10,000,000.01');
      expect(d.form.amount).toBe('');
      expect(d.missing).toContain('amount');
      expect(d.warnings.map((w) => w.code)).toEqual(['amount-too-large']);
      expect(d.warnings[0]?.message).toContain('10,000,000');
    });

    it('ยอดใหญ่มาก (หลักร้อยล้านล้าน) ก็ปล่อยว่าง', () => {
      expect(withAmount('999,999,999,999.99').form.amount).toBe('');
    });
  });

  describe('ช่วงวันที่ที่ยอมรับ (วันนี้ = 2026-11-20)', () => {
    const slipOn = (line: string) => slipToDraft(parseSlipText(`${line}\nจำนวน: 65.00 บาท`), ctx);

    it('วันนี้ผ่าน', () => {
      expect(slipOn('20 พ.ย. 69').form.date).toBe('2026-11-20');
      expect(slipOn('20 พ.ย. 69').warnings).toEqual([]);
    });

    it('พรุ่งนี้ (อนาคต 1 วัน): ใช้วันนี้แทน ใส่ missing และเตือน', () => {
      const d = slipOn('21 พ.ย. 69');
      expect(d.form.date).toBe('2026-11-20');
      expect(d.missing).toContain('date');
      expect(d.warnings.map((w) => w.code)).toEqual(['date-out-of-range']);
    });

    it('ปีที่ OCR อ่านเพี้ยน (2589 -> ค.ศ. 2046) ถูกปฏิเสธ', () => {
      const d = slipOn('12 พ.ย. 2589');
      expect(d.form.date).toBe('2026-11-20');
      expect(d.warnings.map((w) => w.code)).toEqual(['date-out-of-range']);
    });

    it('ย้อนหลังครบ 1 ปีพอดี (2025-11-20) ยังผ่าน', () => {
      expect(slipOn('20 พ.ย. 68').form.date).toBe('2025-11-20');
    });

    it('เก่ากว่า 1 ปี 1 วัน (2025-11-19) ถูกปฏิเสธ', () => {
      const d = slipOn('19 พ.ย. 68');
      expect(d.form.date).toBe('2026-11-20');
      expect(d.missing).toContain('date');
      expect(d.warnings.map((w) => w.code)).toEqual(['date-out-of-range']);
    });

    it('วันสิ้นเดือนข้ามปี: today = 2027-03-01 ย้อน 31 ธ.ค. 69 ผ่าน, 28 ก.พ. 68 ไม่ผ่าน', () => {
      const c = { accounts, today: '2027-03-01' };
      expect(slipToDraft(parseSlipText('31 ธ.ค. 69\nจำนวน: 1.00 บาท'), c).warnings).toEqual([]);
      expect(slipToDraft(parseSlipText('28 ก.พ. 68\nจำนวน: 1.00 บาท'), c).warnings).toHaveLength(1);
    });
  });

  it('อ่านยอดไม่ได้: เว้นว่างและบอกใน missing (ไม่เดา)', () => {
    const { form, missing } = slipToDraft(parseSlipText('ไปยัง ร้านข้าวตัวอย่าง\n12 พ.ย. 69 14:35 น.'), ctx);
    expect(form.amount).toBe('');
    expect(missing).toContain('amount');
  });

  it('อ่านวันที่ไม่ได้: ใช้วันนี้และบอกใน missing', () => {
    const { form, missing } = slipToDraft(parseSlipText('จำนวน: 65.00 บาท'), ctx);
    expect(form.date).toBe('2026-11-20');
    expect(missing).toContain('date');
  });

  it('ไม่มีผู้รับ: memo ว่าง (หรือมีแค่เวลา)', () => {
    expect(slipToDraft(parseSlipText('จำนวน: 65.00 บาท'), ctx).form.memo).toBe('');
    expect(slipToDraft(parseSlipText('จำนวน: 65.00 บาท\n09:05 น.'), ctx).form.memo).toBe('09:05 น.');
  });

  it('ร่างที่ได้ส่งต่อ buildEntry ได้เมื่อเลือกหมวดแล้ว (ยอดเป็นสตางค์จำนวนเต็ม)', () => {
    const { form } = slipToDraft(parseSlipText(SLIP), ctx);
    const entry = buildEntry(accounts, { ...form, counterId: 'expense-food' }, 'e-new');
    expect(entry.lines.map((l) => l.amount)).toEqual([6500, -6500]);
  });
});
