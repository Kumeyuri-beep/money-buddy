import { describe, expect, it, vi } from 'vitest';
import { withCode } from '../../src/domain/errors/coded';

// จำลอง parseUnits ที่โยน error มีรหัส (งาน A กำลังเพิ่มรหัสใน units.ts) เพื่อตรวจว่าฟอร์มส่งต่อ code/params
vi.mock('../../src/domain/invest/units', async (orig) => {
  const real = await orig<typeof import('../../src/domain/invest/units')>();
  return {
    ...real,
    parseUnits: (text: string) => {
      if (text === 'boom') throw withCode(new SyntaxError('ข้อความไทยจากโดเมน'), 'units.test', { got: 'boom' });
      return real.parseUnits(text);
    },
  };
});

import { buildTradeRecord, emptyTradeForm } from '../../src/app/tradeForm';
import { buildUsTradeRecord, emptyUsTradeForm } from '../../src/app/usForms';

describe('ส่งต่อรหัสจาก error ต้นทาง', () => {
  it('tradeForm: units ที่ error มีรหัส → code/params ส่งต่อ และ message เดิม', () => {
    const r = buildTradeRecord({ ...emptyTradeForm('a', 'sell', '2026-11-03'), units: 'boom', price: '1' }, 'x', 'n', '2026-11-13');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([{ field: 'units', message: 'ข้อความไทยจากโดเมน', code: 'units.test', params: { got: 'boom' } }]);
  });
  it('usForms: ส่งต่อ code และเพิ่ม ccy=USD', () => {
    const r = buildUsTradeRecord({ ...emptyUsTradeForm('u', 'sell', '2026-11-03', '35'), units: 'boom', price: '1' }, 'x', 'n', '2026-11-13');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([{ field: 'units', message: 'ข้อความไทยจากโดเมน', code: 'units.test', params: { got: 'boom', ccy: 'USD' } }]);
  });
});
