import { describe, expect, it } from 'vitest';
import { buildEntry } from '../../src/app/entryForm';
import { learnFromHistory } from '../../src/app/quickText';
import {
  draftFromOcrText,
  draftFromOcrTexts,
  parseSlipText,
  parseSlipTexts,
  slipToDraft,
} from '../../src/app/slipParser';
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
  ])('"%s" -> ว่าง', (line) => {
    expect(parseSlipText(line).amount).toBeUndefined();
  });

  describe('ทนขยะจาก OCR ของสลิปจริง (ลายน้ำ/โลโก้ข้างขวาทำให้มีตัวอักษรมั่วต่อท้ายบรรทัด)', () => {
    // ข้อความสมมติที่จำลองรูปแบบที่เจอจริง ไม่ใช่ข้อความจากสลิปจริง
    const t = (...lines: string[]) => lines.join('\n');

    it('ยอดมีขยะต่อท้ายบรรทัด และป้ายก็มีขยะต่อท้าย', () => {
      const text = t('จํานวน        xq Rt Ob', '137.00 บาท        dpo', 'ค่าธรรมเนียม      [~ MPL ka', '0.00 บาท');
      expect(parseSlipText(text).amount).toBe('137.00');
    });

    it('ยอดอยู่ห่างจากป้ายหลายบรรทัด มีบรรทัดขยะคั่น', () => {
      const text = t('จํานวน       zun', 'Oka', 'lime Qa YY', '52.00 บาท       o Gpa', '[Lo B ag', 'ค่าธรรมเนียม     x', '0.00 บาท');
      expect(parseSlipText(text).amount).toBe('52.00');
    });

    it('มีตัวเลขทศนิยมที่เป็นขยะปนกับยอดที่มี "บาท" -> กำกวม ปล่อยว่าง ("บาท" ไม่ใช่หลักฐานพอให้เลือกเอง)', () => {
      expect(parseSlipText(t('จำนวน', '4.24 abc', '52.00 บาท', 'ค่าธรรมเนียม', '0.00 บาท')).amount).toBeUndefined();
    });

    // ผลตรวจ money-auditor 4 พ.ย. 2569: ข้อความสมมติที่ทำให้ได้ยอดผิดที่ดูสมเหตุสมผล
    it('"บาท" ของยอดจริงเพี้ยน แต่ค่าธรรมเนียมไม่ใช่ 0 และป้ายหาย -> ห้ามเลือกค่าธรรมเนียมเป็นยอด ปล่อยว่าง', () => {
      expect(parseSlipText(t('จำนวน', '3,900.00 บาห', 'คำธรรมเนียม', '5.00 บาท')).amount).toBeUndefined();
    });

    it('ยอดคงเหลือไม่ถูกนับเป็นยอด: ช่วงค้นหยุดที่บรรทัดยอดคงเหลือ/ยอดรวม', () => {
      expect(parseSlipText(t('จำนวน', '3,900.00 บาห', 'ยอดคงเหลือ 12,345.67 บาท')).amount).toBe('3,900.00');
      expect(parseSlipText(t('จำนวน', 'ขยะ', 'ยอดรวม 12,345.67 บาท')).amount).toBeUndefined();
      expect(parseSlipText(t('จำนวน', 'Balance 12,345.67 THB')).amount).toBeUndefined();
    });

    it('จุลภาคถูกอ่านเป็นช่องว่างสองช่อง/แท็บ ("4  800.00") ต้องไม่ได้ 800.00', () => {
      expect(parseSlipText('จำนวน: 4  800.00 บาท').amount).toBeUndefined();
      expect(parseSlipText('จำนวน: 4\t800.00 บาท').amount).toBeUndefined();
      expect(parseSlipText('จำนวน: 4   800.00 บาท').amount).toBeUndefined();
    });

    it('เลขไทย ๐-๙ ถูกแปลงเป็นเลขอารบิกก่อนอ่าน (ทั้งก้อนและแบบผสม)', () => {
      expect(parseSlipText('จำนวน: ๓,๙๐๐.๐๐ บาท').amount).toBe('3,900.00');
      expect(parseSlipText('จำนวน: ๓900.00 บาท').amount).toBe('3,900.00');
      expect(parseSlipText('๑๒ พ.ย. ๒๕๖๙').date).toBe('2026-11-12');
    });

    it('ศูนย์นำหน้า ("003,900.00") ไม่ถูกทิ้งเงียบเป็น 3,900.00 ปล่อยว่าง แต่ 0.50 ยังอ่านได้', () => {
      expect(parseSlipText('จำนวน: 003,900.00 บาท').amount).toBeUndefined();
      expect(parseSlipText('จำนวน: 0,800.00 บาท').amount).toBeUndefined();
      expect(parseSlipText('จำนวน: 0.50 บาท').amount).toBe('0.50');
    });

    it('เลขทศนิยมที่ตามด้วยจุด/จุลภาคและตัวเลขอีกกลุ่ม (วันที่แบบจุด เลขเวอร์ชัน) ไม่ใช่ยอด', () => {
      expect(parseSlipText('จำนวน: 5.11.69 บาท').amount).toBeUndefined();
      expect(parseSlipText('จำนวน: 1.25.3 บาท').amount).toBeUndefined();
    });

    it('ไม่มี "บาท" เลยแต่มีตัวเลขทศนิยมตัวเดียวในช่วงหลังป้าย -> ใช้ตัวนั้น', () => {
      expect(parseSlipText(t('จำนวน', '28.00   ฝ Zq', 'ค่าธรรมเนียม', '0.00')).amount).toBe('28.00');
    });

    it('มียอดต่างกันสองตัวที่มี "บาท" ในช่วงเดียวกัน -> กำกวม ปล่อยว่าง', () => {
      expect(parseSlipText(t('จำนวน', '52.00 บาท', '90.00 บาท', 'ค่าธรรมเนียม', '0.00 บาท')).amount).toBeUndefined();
    });

    it('ป้ายค่าธรรมเนียมเพี้ยนจนหาไม่เจอ แต่มีค่าธรรมเนียมไม่ใช่ 0 ต่อท้าย -> กำกวม ปล่อยว่าง', () => {
      expect(parseSlipText(t('จำนวน', '80.00 บาท', '5.00 บาท')).amount).toBeUndefined();
    });

    it('ค่าธรรมเนียม 0.00 ที่ตามหลังไม่รบกวนยอดจริง', () => {
      expect(parseSlipText(t('จำนวน', '137.00 บาท', '0.00 บาท')).amount).toBe('137.00');
    });

    it('ไม่หยิบตัวเลขที่อยู่หลังป้ายค่าธรรมเนียมมาเป็นยอด', () => {
      expect(parseSlipText(t('จำนวน: ***', 'ค่าธรรมเนียม', '5.00 บาท')).amount).toBeUndefined();
    });

    it('ไม่หยิบตัวเลขหลังป้ายเลขที่รายการหรือหมายเลขอ้างอิงมาเป็นยอด', () => {
      expect(parseSlipText(t('จำนวน', 'เลขที่รายการ: 12.34', '65.00 บาท')).amount).toBeUndefined();
    });

    it('ยอดที่ OCR อ่านติดกับตัวเลขถัดไป ("3,900.006hy") ไม่ยอมรับ (อาจเป็น 3,900.00 หรือ 3,900.006)', () => {
      expect(parseSlipText(t('จำนวน: ”  8 ke', '3,900.006hy om K :')).amount).toBeUndefined();
    });

    it('ช่วงค้นหาหลังป้าย 6 บรรทัด: บรรทัดที่ 6 ยังนับ บรรทัดที่ 7 ไม่นับ', () => {
      const noise = (n: number) => Array.from({ length: n }, (_, i) => `ขยะ${i}`);
      expect(parseSlipText(t('จำนวน', ...noise(5), '65.00 บาท')).amount).toBe('65.00');
      expect(parseSlipText(t('จำนวน', ...noise(6), '65.00 บาท')).amount).toBeUndefined();
    });

    it('เลขทศนิยมที่ติดอยู่หลังเครื่องหมายลบหรือติดกับเลขอื่นไม่ถูกอ่านเป็นยอด', () => {
      expect(parseSlipText(t('จำนวน', '-52.00 บาท')).amount).toBeUndefined();
      expect(parseSlipText(t('จำนวน', '1 234.50 บาท')).amount).toBeUndefined();
    });

    describe('ป้าย "จำนวน" และคำว่า "บาท" ถูก OCR อ่านเพี้ยนหรือหายไป (เจอจริงกับสลิปจริง)', () => {
      it('ไม่มีป้าย "จำนวน" และ "บาท" เพี้ยน: ใช้ตัวเลขทศนิยมที่ไม่ใช่ศูนย์ตัวเดียวก่อนป้ายค่าธรรมเนียม', () => {
        const text = t('XXX-X-XXXXXX0000-X', '', '137.00 uv', '', 'ค่าธรรมเนียม', '0.00 บาท');
        expect(parseSlipText(text).amount).toBe('137.00');
      });

      it('ทั้งป้ายจำนวนและป้ายค่าธรรมเนียมเพี้ยน: ยังได้ยอดจากตัวเลขที่ไม่ใช่ศูนย์ตัวเดียว', () => {
        const text = t('จํา(ตวน', '', '137.00 งาด', '', '7.=-', '0.00 บาท');
        expect(parseSlipText(text).amount).toBe('137.00');
      });

      it('ไม่มีป้ายและมีเลขทศนิยมที่ไม่ใช่ศูนย์สองค่าต่างกัน -> กำกวม ปล่อยว่าง', () => {
        expect(parseSlipText(t('4.24 abc', '137.00 uv')).amount).toBeUndefined();
      });

      it('ตัวเลขหลังป้ายค่าธรรมเนียมไม่ถูกนับ แม้ไม่มีป้ายจำนวน', () => {
        expect(parseSlipText(t('137.00 uv', 'ค่าธรรมเนียม', '5.00 uv')).amount).toBe('137.00');
      });

      // กฎสำรอง (ไม่เจอป้ายจำนวน) เป็นการเดาที่เสี่ยงที่สุด จึงเข้มงวด: ตัวเลขต้องอยู่ต้นบรรทัด และไม่ใช่บรรทัดวันที่/เวลา/ป้ายอ้างอิง
      it('กฎสำรอง: เลขเวอร์ชันแอปที่ติดตัวอักษร ("K PLUS v1.25") ไม่ใช่ยอด', () => {
        expect(parseSlipText(t('K PLUS v1.25', 'โอนเงินสำเร็จ')).amount).toBeUndefined();
      });

      it('กฎสำรอง: เวลาที่ OCR อ่านทวิภาคเป็นจุด ("14.23 น.") ไม่ใช่ยอด', () => {
        expect(parseSlipText(t('4 พ.ย. 69 14.23 น.', '14.23 น.')).amount).toBeUndefined();
      });

      it('กฎสำรอง: วันที่แบบจุด ("05.11.69") ไม่ใช่ยอด', () => {
        expect(parseSlipText(t('05.11.69', 'โอนเงินสำเร็จ')).amount).toBeUndefined();
      });

      it('กฎสำรอง: บรรทัดเลขที่รายการ/อ้างอิงที่มีจุดไม่ใช่ยอด แม้ป้ายค่าธรรมเนียมหาย', () => {
        expect(parseSlipText(t('เลขที่รายการ: 015.12', 'รหัสร้านค้า 7.50')).amount).toBeUndefined();
      });

      it('กฎสำรอง: ตัวเลขที่ไม่ได้อยู่ต้นบรรทัด ("รวม 137.00 uv") ไม่ถูกรับ', () => {
        expect(parseSlipText(t('รวม 137.00 uv', 'ค่าธรรมเนียม', '0.00 บาท')).amount).toBeUndefined();
      });

      it('กฎสำรอง: ตัวเลขต้นบรรทัดที่มีสัญลักษณ์นำหน้า ("| 137.00 uv") ยังรับ', () => {
        expect(parseSlipText(t('| 137.00 uv', 'ค่าธรรมเนียม', '0.00 บาท')).amount).toBe('137.00');
      });

      it('ป้ายจำนวนเจอแต่ไม่มีเลขในช่วงค้นหา: ไม่ย้อนไปใช้กฎสำรอง (ขอบเขตเดิมยังเข้มงวด)', () => {
        expect(parseSlipText(t('จำนวน', 'ขยะ', 'เลขที่รายการ: 1', '65.00 บาท')).amount).toBeUndefined();
      });
    });
  });

  it('ป้าย "จำนวน" ไม่มีตัวเลข: ไม่หยิบค่าธรรมเนียมหรือเลขที่รายการบรรทัดถัดไปมาเป็นยอด', () => {
    expect(parseSlipText('จำนวน:\nค่าธรรมเนียม: 5.00 บาท').amount).toBeUndefined();
    expect(parseSlipText('จำนวน:\nเลขที่รายการ: 015123456789').amount).toBeUndefined();
  });

  it('ไม่มีป้าย: ไม่นับยอดคงเหลือ หรือยอดที่ตามหลังป้ายค่าธรรมเนียมคนละบรรทัด', () => {
    expect(parseSlipText('ยอดคงเหลือ 12,352.00 บาท').amount).toBeUndefined();
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
    expect(parseSlipText('ร้านตัวอย่าง\n52.00 บาท').amount).toBe('52.00');
    expect(parseSlipText('52.00 บาท\n90.00 บาท').amount).toBeUndefined();
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
    // OCR แทรกสระ/วรรณยุกต์เกินมา (เจอจริงตอนทดสอบ: "พ.ย." -> "พ.ุย.") ต้องยังอ่านเดือนได้ถ้าไม่กำกวม
    ['3 พ.ุย. 69 14:35 wu.', '2026-11-03'],
    ['12 พ.้ย. 69', '2026-11-12'],
    ['5 ก.ุย. 69', '2026-09-05'],
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

  it('เดือนที่เพี้ยนจนกำกวม (ม.ค. กับ มี.ค. เหลือ "มค" เหมือนกันเมื่อตัดสระ) -> ว่าง ไม่เดา', () => {
    expect(parseSlipText('12 ม.ุค. 69').date).toBeUndefined();
  });

  it('เดือนที่พิมพ์ถูกต้องเป๊ะยังชนะเสมอ ("มี.ค." ไม่ถูกมองเป็น "ม.ค.")', () => {
    expect(parseSlipText('12 มี.ค. 69').date).toBe('2026-03-12');
    expect(parseSlipText('12 ม.ค. 69').date).toBe('2026-01-12');
  });

  it('วันที่ที่นำหน้าด้วยเลขอีกตัว ("125 พ.ย. 69") ไม่ถูกอ่านเป็นวันที่ 25', () => {
    expect(parseSlipText('125 พ.ย. 69').date).toBeUndefined();
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

  describe('สลิปที่อาจไม่ใช่รายจ่าย (กฎ R4: โอนเข้ากระเป๋าตัวเอง/จ่ายบัตรไม่ใช่รายจ่าย)', () => {
    const slipTo = (recipient: string) =>
      slipToDraft(parseSlipText(`12 พ.ย. 69 14:35 น.\nไปยัง ${recipient}\nจำนวน: 500.00 บาท`), ctx);

    it('ผู้รับตรงกับชื่อกระเป๋าอื่นของผู้ใช้ -> เตือน และบอกกระเป๋าปลายทางสำหรับปุ่มสลับเป็นโอน', () => {
      const d = slipTo('Mainframe');
      expect(d.warnings.map((w) => w.code)).toEqual(['maybe-transfer']);
      expect(d.warnings[0]?.transferToWalletId).toBe('wallet-2');
      expect(d.warnings[0]?.message).toContain('โอน');
    });

    it('เทียบชื่อกระเป๋าแบบไม่สนตัวพิมพ์เล็กใหญ่ และผู้รับมีคำอื่นต่อท้ายได้', () => {
      expect(slipTo('MAINFRAME ของฉัน').warnings.map((w) => w.code)).toEqual(['maybe-transfer']);
    });

    it('ผู้รับตรงกับกระเป๋าที่เป็นต้นทางเอง -> เตือน แต่ไม่เสนอปลายทาง (โอนเข้าตัวเองไม่ได้)', () => {
      const d = slipTo('CashFlow'); // กระเป๋าต้นทางเริ่มต้นคือ wallet-1 = CashFlow
      expect(d.warnings.map((w) => w.code)).toEqual(['maybe-transfer']);
      expect(d.warnings[0]?.transferToWalletId).toBeUndefined();
    });

    it('ผู้รับมีคำว่า "บัตรเครดิต" -> เตือน (ไม่เสนอปลายทาง)', () => {
      const d = slipTo('บัตรเครดิต กสิกรตัวอย่าง');
      expect(d.warnings.map((w) => w.code)).toEqual(['maybe-transfer']);
      expect(d.warnings[0]?.transferToWalletId).toBeUndefined();
    });

    it('ผู้รับทั่วไปไม่เตือน', () => {
      expect(slipTo('ร้านกาแฟตัวอย่าง').warnings).toEqual([]);
    });

    it('ไม่มีผู้รับในสลิป -> ไม่เตือน', () => {
      expect(slipToDraft(parseSlipText('จำนวน: 500.00 บาท'), ctx).warnings).toEqual([]);
    });

    it('ยังเป็นร่างรายจ่ายตามเดิม (ผู้ใช้เป็นคนกดสลับเอง ไม่สลับให้อัตโนมัติ)', () => {
      expect(slipTo('Mainframe').form.kind).toBe('expense');
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

describe('draftFromOcrText: สรุปผลจากข้อความ OCR ทั้งก้อน', () => {
  const { accounts } = buildInitialLedger([{ name: 'CashFlow', opening: '' }], '2026-11-01');
  const ctx = { accounts, today: '2026-11-20' };

  it('อ่านได้อย่างน้อยหนึ่งอย่าง -> ได้ร่าง', () => {
    expect(draftFromOcrText(SLIP, ctx)?.form.amount).toBe('65.00');
    expect(draftFromOcrText('ไปยัง ร้านตัวอย่าง', ctx)?.form.memo).toBe('ร้านตัวอย่าง');
  });

  it.each(['', '   \n  ', 'สวัสดี\nabc xyz', '|||\n~~'])('"%s" -> null (อ่านอะไรไม่ได้)', (text) => {
    expect(draftFromOcrText(text, ctx)).toBeNull();
  });

  it('ได้แค่เวลาอย่างเดียวไม่นับว่าอ่านสลิปได้', () => {
    expect(draftFromOcrText('เวลา 14:35', ctx)).toBeNull();
  });
});

describe('ผู้รับจากโครงสลิปจริง (ไม่มีป้าย "ไปยัง": ผู้รับคือบล็อกชื่อสุดท้ายก่อนป้ายจำนวน)', () => {
  // ข้อความสมมติที่จำลองโครงสลิป K PLUS ไม่ใช่ข้อความจากสลิปจริง
  const t = (...lines: string[]) => lines.join('\n');
  const recipient = (...lines: string[]) => parseSlipText(t(...lines)).recipient;

  it('สลิปโอนเงิน: ผู้โอนมาก่อน ผู้รับมาทีหลัง -> เลือกผู้รับ', () => {
    expect(
      recipient(
        'โอนเงินสำเร็จ        maKe',
        '03 พ.ย. 2569 12:34',
        'นายสมชาย ตัวอย่าง',
        'xxx-x-x1234-x',
        'น.ส.สมหญิง ตัวอย่างสอง',
        'xxx-x-x5678-x',
        'จำนวน        zun',
        '52.00 บาท',
        'ค่าธรรมเนียม',
        '0.00 บาท',
        'เลขที่รายการ: 000000000000',
      ),
    ).toBe('น.ส.สมหญิง ตัวอย่างสอง');
  });

  it('สลิปจ่ายร้านค้า: ชื่อร้านมาก่อนบรรทัดสาขา -> เลือกชื่อร้าน ไม่เอาสาขา', () => {
    expect(
      recipient(
        'ชำระเงินสำเร็จ',
        '03 พ.ย. 2569 18:31',
        'ผู้โอนสมมติ',
        'xxx-x-x1234-x',
        'THE EXAMPLE SHOP CO.,LTD.',
        'BRANCH 00004',
        'xxx-xxx-x9999',
        'จำนวน',
        '137.00 บาท',
      ),
    ).toBe('THE EXAMPLE SHOP CO.,LTD.');
  });

  it('บรรทัดธนาคารหลังชื่อผู้รับไม่ถูกเลือก', () => {
    expect(
      recipient('นายผู้โอน ตัวอย่าง', 'นายผู้รับ ตัวอย่าง', 'ธ.กสิกรไทย        | 4 @D', 'xxx-x-x5678-x', 'จำนวน', '52.00 บาท'),
    ).toBe('นายผู้รับ ตัวอย่าง');
  });

  it('ขยะท้ายบรรทัดที่คั่นด้วยช่องว่างกว้างถูกตัดทิ้ง', () => {
    expect(recipient('ร้านตัวอย่างสมมติ          ฝ Zq £5', 'จำนวน', '52.00 บาท')).toBe('ร้านตัวอย่างสมมติ');
  });

  it('ไม่นับบรรทัดขยะที่อยู่ระหว่างป้ายจำนวนกับยอด', () => {
    expect(recipient('น.ส.สมหญิง ตัวอย่างสอง', 'จำนวน    zun', 'lime Qa YY', '52.00 บาท')).toBe('น.ส.สมหญิง ตัวอย่างสอง');
  });

  it('ไม่นับบรรทัดที่อยู่หลังยอด (เช่น รหัสร้านค้า ชื่อรหัสธุรกรรม)', () => {
    expect(recipient('จำนวน', '52.00 บาท', 'ค่าธรรมเนียม', 'ร้านหลังยอดสมมติ')).toBeUndefined();
  });

  it('หาป้ายจำนวนไม่เจอ: ใช้ตำแหน่งยอดทศนิยมแรกเป็นขอบเขต', () => {
    expect(recipient('น.ส.สมหญิง ตัวอย่างสอง', '52.00 uv', 'ร้านหลังยอดสมมติ')).toBe('น.ส.สมหญิง ตัวอย่างสอง');
  });

  it('วันที่ เวลา สถานะ เลขบัญชี และเลขอ้างอิงไม่ถูกเลือกเป็นผู้รับ', () => {
    expect(
      recipient('โอนเงินสำเร็จ', '03 พ.ย. 2569', '03 พ.ย. 2569 12:34', 'xxx-x-x1234-x', 'เลขที่รายการ: ABCDEFGH', 'จำนวน', '52.00 บาท'),
    ).toBeUndefined();
  });

  it('บรรทัดสั้นเกินไป/ขยะ ("Ene", "of") ไม่ถูกเลือก', () => {
    expect(recipient('Oka', 'of', 'จำนวน', '52.00 บาท')).toBeUndefined();
  });

  it('ตัวเลข/เครื่องหมายขยะนำหน้าชื่อถูกตัดทิ้ง (เจอจริง: "69 นาย...")', () => {
    expect(recipient('69 นายผู้รับ ตัวอย่าง', 'จำนวน', '52.00 บาท')).toBe('นายผู้รับ ตัวอย่าง');
    expect(recipient('|@ ร้านตัวอย่างสมมติ', 'จำนวน', '52.00 บาท')).toBe('ร้านตัวอย่างสมมติ');
  });

  it('ชื่อที่ขึ้นต้นด้วยวงเล็บยังอยู่ครบ', () => {
    expect(recipient('(ร้านตัวอย่างสมมติ)', 'จำนวน', '52.00 บาท')).toBe('(ร้านตัวอย่างสมมติ)');
  });

  it('ป้าย "ไปยัง" ที่อ่านได้ยังมาก่อนการเดาจากโครงเสมอ', () => {
    expect(recipient('ผู้อื่นตัวอย่างหนึ่ง', 'ไปยัง ร้านที่ระบุชัดเจน', 'จำนวน', '52.00 บาท')).toBe('ร้านที่ระบุชัดเจน');
  });

  it('ไม่มีบรรทัดไหนดูเป็นชื่อเลย -> ว่าง', () => {
    expect(recipient('โอนเงินสำเร็จ', 'จำนวน', '52.00 บาท')).toBeUndefined();
  });
});

describe('รวมผลอ่านหลายรอบ (OCR หลายวิธี)', () => {
  const t0 = (...lines: string[]) => lines.join('\n');
  const { accounts } = buildInitialLedger([{ name: 'CashFlow', opening: '' }], '2026-11-01');
  const ctx = { accounts, today: '2026-11-20' };
  const text = (amount: string, date = '12 พ.ย. 69') => `${date} 14:35 น.\nจำนวน: ${amount} บาท`;

  it('รอบแรกไม่เจอยอด รอบสองเจอ -> ใช้ของรอบสอง', () => {
    const r = parseSlipTexts(['12 พ.ย. 69 14:35 น.', text('65.00')]);
    expect(r.fields.amount).toBe('65.00');
    expect(r.conflicts).toEqual([]);
  });

  it('สองรอบอ่านยอดได้ตรงกัน -> ใช้ยอดนั้น', () => {
    expect(parseSlipTexts([text('65.00'), text('65.00')]).fields.amount).toBe('65.00');
  });

  it('สองรอบอ่านยอดได้ไม่ตรงกัน -> ปล่อยว่างและบอกว่าขัดกัน (ไม่เลือกเอง)', () => {
    const r = parseSlipTexts([text('65.00'), text('85.00')]);
    expect(r.fields.amount).toBeUndefined();
    expect(r.conflicts).toEqual(['amount']);
  });

  it('สองรอบอ่านวันที่ได้ไม่ตรงกัน -> ปล่อยว่างและบอกว่าขัดกัน', () => {
    const r = parseSlipTexts([text('65.00', '12 พ.ย. 69'), text('65.00', '17 พ.ย. 69')]);
    expect(r.fields.date).toBeUndefined();
    expect(r.conflicts).toEqual(['date']);
  });

  it('เวลา: ใช้ค่าแรกที่อ่านได้ ผู้รับ: ใช้ชื่อที่ยาวกว่า (ไม่ใช่เงิน ไม่ต้องตัดสินว่าขัดกัน)', () => {
    const r = parseSlipTexts(['09:05 น.', 'ไปยัง ร้านตัวอย่าง\n14:35 น.']);
    expect(r.fields.time).toBe('09:05');
    expect(r.fields.recipient).toBe('ร้านตัวอย่าง');
  });

  it('ผู้รับ: รอบที่อ่านได้แค่เศษสั้นๆ แพ้รอบที่อ่านได้ชื่อเต็ม ไม่ว่ารอบไหนมาก่อน', () => {
    const full = 'ไปยัง ร้านตัวอย่างสมมติเต็มชื่อ';
    const part = 'ไปยัง ร้านตัวอย่าง';
    expect(parseSlipTexts([part, full]).fields.recipient).toBe('ร้านตัวอย่างสมมติเต็มชื่อ');
    expect(parseSlipTexts([full, part]).fields.recipient).toBe('ร้านตัวอย่างสมมติเต็มชื่อ');
  });

  describe('ยอดที่มาจากกฎสำรอง (ไม่เจอป้ายจำนวน) ต้องได้ตรงกันทั้งสองรอบ เพราะสองรอบมาจากรูปเดียวกัน ความผิดพลาดอาจซ้ำกัน', () => {
    const fallback = t0('| 137.00 uv', 'ค่าธรรมเนียม', '0.00 บาท');
    const labeled = t0('จำนวน', '137.00 บาท', 'ค่าธรรมเนียม', '0.00 บาท');

    it('รอบเดียวได้ยอดจากกฎสำรอง อีกรอบว่าง -> ปล่อยว่าง (ไม่มีหลักฐานอิสระ)', () => {
      expect(parseSlipTexts([fallback, 'ขยะ']).fields.amount).toBeUndefined();
      expect(parseSlipTexts(['ขยะ', fallback]).fields.amount).toBeUndefined();
      expect(parseSlipTexts([fallback]).fields.amount).toBeUndefined();
    });

    it('สองรอบได้ยอดเดียวกันจากกฎสำรอง -> ใช้ได้', () => {
      expect(parseSlipTexts([fallback, fallback]).fields.amount).toBe('137.00');
    });

    it('รอบเดียวได้ยอดจากป้ายจำนวนโดยตรง (ไม่ใช่การเดา) -> ใช้ได้ แม้อีกรอบว่าง', () => {
      expect(parseSlipTexts([labeled, 'ขยะ']).fields.amount).toBe('137.00');
      expect(parseSlipTexts(['ขยะ', labeled]).fields.amount).toBe('137.00');
    });

    it('ยอดจากป้ายกับยอดจากกฎสำรองขัดกัน -> ว่างและรายงานขัดกัน', () => {
      const other = t0('| 85.00 uv', 'ค่าธรรมเนียม', '0.00 บาท');
      const r = parseSlipTexts([labeled, other]);
      expect(r.fields.amount).toBeUndefined();
      expect(r.conflicts).toEqual(['amount']);
    });
  });

  it('ไม่มีข้อความเลย -> ไม่มีค่าและไม่มีข้อขัดแย้ง', () => {
    expect(parseSlipTexts([])).toEqual({ fields: {}, conflicts: [] });
  });

  it('draftFromOcrTexts: ขัดกัน -> ฟอร์มว่าง มี missing และคำเตือน ocr-disagree', () => {
    const d = draftFromOcrTexts([text('65.00'), text('85.00')], ctx);
    expect(d?.form.amount).toBe('');
    expect(d?.missing).toContain('amount');
    expect(d?.warnings.map((w) => w.code)).toContain('ocr-disagree');
    expect(d?.warnings.find((w) => w.code === 'ocr-disagree')?.message).toContain('ยอดเงิน');
  });

  it('draftFromOcrTexts: ตรงกัน -> เติมตามปกติ ไม่มีคำเตือนขัดกัน', () => {
    const d = draftFromOcrTexts([text('65.00'), text('65.00')], ctx);
    expect(d?.form.amount).toBe('65.00');
    expect(d?.warnings.map((w) => w.code)).not.toContain('ocr-disagree');
  });

  it('draftFromOcrTexts: ทุกรอบอ่านอะไรไม่ได้ -> null', () => {
    expect(draftFromOcrTexts(['', 'สวัสดี', '|||'], ctx)).toBeNull();
    expect(draftFromOcrTexts([], ctx)).toBeNull();
  });
});
