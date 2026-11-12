/**
 * config ภาษีเงินได้บุคคลธรรมดา รายปีภาษี (กฎ R13, R19) ที่เดียวที่เก็บตัวเลขกฎหมาย ห้าม hard-code ที่อื่น
 * เงินเป็นสตางค์ (จำนวนเต็ม) อัตราเป็น bps (1 bps = 0.01%) ไม่มีทศนิยมลอยตัว
 *
 * ระดับความมั่นใจ (รายละเอียดและลิงก์เต็มอยู่ `docs/plans/2026-11-12-tax-2569-sources.md`):
 *   verified   = อ่านจากเอกสารกรมสรรพากรที่ระบุปีภาษีนี้โดยตรง
 *   partial    = เอกสารทางการระบุตัวเลข แต่ไม่ได้ระบุปีภาษีนี้ และไม่พบกฎหมายที่แก้
 *   unverified = ยังไม่ยืนยันจากต้นฉบับ (ห้ามใช้ในสูตรจนกว่าเจ้าของอนุมัติ หรือต้องมีป้ายเตือนบนจอ)
 */
export type Confidence = 'verified' | 'partial' | 'unverified';

export interface Sourced {
  readonly confidence: Confidence;
  /** ลิงก์/ชื่อเอกสารต้นทาง */
  readonly source: string;
  /** หมายเหตุสั้นๆ ที่แสดงบนจอได้ (ไทย) */
  readonly note?: string;
}

export interface Bracket extends Sourced {
  /** ขอบบนของขั้น (สตางค์ นับเป็นเงินได้สุทธิสะสม) `null` = ไม่มีขอบบน */
  readonly upToSatang: number | null;
  readonly rateBps: number;
}

export interface PercentCap extends Sourced {
  /** ร้อยละของเงินได้พึงประเมินรวม (bps) */
  readonly rateBps: number;
  /** เพดานเป็นสตางค์ (ถ้ามี) */
  readonly capSatang: number | null;
}

export interface TaxYearConfig {
  readonly year: number;
  readonly brackets: readonly Bracket[];
  readonly employmentExpense: PercentCap;
  readonly personalAllowance: Sourced & { readonly satang: number };
  readonly socialSecurity: Sourced & { readonly capSatang: number };
  readonly rmf: PercentCap;
  readonly pensionInsurance: PercentCap;
  readonly thaiEsg: PercentCap;
  /** เพดานรวมกลุ่มเกษียณ (RMF + ประกันชีวิตแบบบำนาญ ในเฟสแรก) */
  readonly retirementGroup: Sourced & { readonly capSatang: number };
  /** เฟส 2 (เอกสารกรมสรรพากร ม.ค. 2568 ฉบับที่อ่านต้นฉบับได้) */
  readonly spouse: Sourced & { readonly satang: number };
  readonly child: Sourced & { readonly baseSatang: number; readonly extraSatang: number; readonly maxCount: number };
  readonly parent: Sourced & { readonly perSatang: number; readonly maxCount: number };
  readonly lifeInsurance: Sourced & { readonly capSatang: number };
  readonly healthInsurance: Sourced & { readonly capSatang: number };
  /** เพดานรวมประกันชีวิต + ประกันสุขภาพของผู้มีเงินได้ */
  readonly lifeHealthGroup: Sourced & { readonly capSatang: number };
  readonly parentsHealth: Sourced & { readonly capSatang: number };
  readonly mortgageInterest: Sourced & { readonly capSatang: number };
  /** บริจาคทั่วไป: ร้อยละของเงินได้หลังหักค่าใช้จ่ายและค่าลดหย่อนอื่น (ไม่รวม e-Donation 2 เท่า ซึ่งยังไม่ยืนยัน) */
  readonly donation: Sourced & { readonly rateBps: number };
  /** ข้อความเตือนประจำปีภาษีนี้ แสดงคู่ผลลัพธ์ */
  readonly basisNotice: string;
}

const baht = (n: number): number => n * 100;

const SRC_RATES = 'https://www.rd.go.th/5938.html';
const SRC_RATES_EXEMPT = 'https://www.rd.go.th/fileadmin/user_upload/SMEs/infographic/Pit_63_7.pdf';
const SRC_DEDUCTIONS = 'https://www.rd.go.th/fileadmin/download/tax_deductions_update280168.pdf';
const SRC_PIT94_2569 = 'https://www.rd.go.th/fileadmin/tax_pdf/pit/2569/Ins94_160669.pdf';
const SRC_EXPENSE = 'https://www.rd.go.th/556.html';
const SRC_NEWS_SSO_2569 = 'https://www.thairath.co.th/money/personal_finance/finance_banking/2899617';
const SRC_SEC_THAI_ESG = 'https://sec.or.th/TH/Template3/Articles/2567/171267-02.pdf';

export const TAX_CONFIG_2569: TaxYearConfig = {
  year: 2569,
  brackets: [
    { upToSatang: baht(150_000), rateBps: 0, confidence: 'partial', source: SRC_RATES_EXEMPT, note: 'ยกเว้น 150,000 บาทแรก (หน้า 5938 ตัวอ่านหน้าเว็บทำแถวนี้หาย ควรตรวจหน้าจริง)' },
    { upToSatang: baht(300_000), rateBps: 500, confidence: 'verified', source: SRC_RATES },
    { upToSatang: baht(500_000), rateBps: 1000, confidence: 'verified', source: SRC_RATES },
    { upToSatang: baht(750_000), rateBps: 1500, confidence: 'verified', source: SRC_RATES },
    { upToSatang: baht(1_000_000), rateBps: 2000, confidence: 'verified', source: SRC_RATES },
    { upToSatang: baht(2_000_000), rateBps: 2500, confidence: 'verified', source: SRC_RATES },
    { upToSatang: baht(5_000_000), rateBps: 3000, confidence: 'verified', source: SRC_RATES },
    { upToSatang: null, rateBps: 3500, confidence: 'verified', source: SRC_RATES },
  ],
  employmentExpense: { rateBps: 5000, capSatang: baht(100_000), confidence: 'partial', source: SRC_EXPENSE, note: 'ร้อยละ 50 ไม่เกิน 100,000 บาท (เงินได้ประเภท 1 และ 2 รวมกัน)' },
  personalAllowance: { satang: baht(60_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'จากเอกสารกรมสรรพากร ม.ค. 2568 ไม่ระบุปีภาษี' },
  socialSecurity: {
    capSatang: baht(10_500),
    confidence: 'unverified',
    source: SRC_NEWS_SSO_2569,
    note: 'เพดานค่าจ้างประกันสังคมปี 2569 = 17,500 บาท เงินสมทบ 5% สูงสุด 875 บาท/เดือน = 10,500 บาท/ปี (เจ้าของอนุมัติให้ใช้ 12 พ.ย. 2569 ตามข่าว ไม่ใช่แหล่งทางการ) ยังไม่มีต้นฉบับกฎหมายที่อ่านได้ และไม่ทราบว่ากรมสรรพากรเปลี่ยนเพดานลดหย่อนเดิม 9,000 บาท (เอกสาร ม.ค. 2568) ตามหรือไม่ · กรอกยอดที่จ่ายจริงตามสลิปเงินเดือน',
  },
  rmf: { rateBps: 3000, capSatang: null, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'ร้อยละ 30 ของเงินได้ ต้องถือครองตามเงื่อนไข (แอปตรวจไม่ได้)' },
  pensionInsurance: { rateBps: 1500, capSatang: baht(200_000), confidence: 'partial', source: SRC_PIT94_2569, note: 'ร้อยละ 15 ของเงินได้ ไม่เกิน 200,000 บาท (ภ.ง.ด.94 ปี 2569 เป็นแบบของเงินได้ 40(5)-(8) ไม่ใช่เงินเดือน · ประกาศอธิบดีฯ ฉบับ 462 เรื่องยกเว้นเบี้ยประกันบำนาญ ยังไม่ได้อ่านต้นฉบับ)' },
  thaiEsg: {
    rateBps: 3000,
    capSatang: baht(300_000),
    confidence: 'partial',
    source: SRC_SEC_THAI_ESG,
    note: 'ร้อยละ 30 ไม่เกิน 300,000 บาท แยกเพดานจากกลุ่มเกษียณ 500,000 (ไม่รวมในกลุ่ม) · รวม Thai ESGX (เจ้าของยืนยันตาม ก.ล.ต. 12 พ.ย. 2569 ต้นฉบับอ่านจากเครื่องผู้ช่วยไม่ได้) ต้องถือครองตามเงื่อนไข',
  },
  retirementGroup: { capSatang: baht(500_000), confidence: 'partial', source: SRC_PIT94_2569, note: 'เพดานรวม RMF/กองทุนสำรองเลี้ยงชีพ/กบข./ครูเอกชน/ประกันบำนาญ (จาก ภ.ง.ด.94 ปี 2569 ยังไม่ได้ตรวจกับแบบของเงินเดือน) · Thai ESG อยู่นอกกลุ่มนี้ ห้ามรวมในเพดานนี้' },
  spouse: { satang: baht(60_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'คู่สมรสไม่มีเงินได้' },
  child: { baseSatang: baht(30_000), extraSatang: baht(30_000), maxCount: 20, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'บุตรชอบด้วยกฎหมายคนละ 30,000 · คนที่ 2 เป็นต้นไปที่เกิดตั้งแต่ปี 2561 คนละ 60,000 (ไม่รองรับบุตรบุญธรรม ซึ่งมีเงื่อนไขจำกัด 3 คน) · ขีดสูงสุด 20 คนเป็นขีดกันข้อมูลผิดของแอป ไม่ใช่เพดานตามกฎหมาย' },
  parent: { perSatang: baht(30_000), maxCount: 4, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'อายุ 60 ปีขึ้นไป รายได้ไม่เกิน 30,000 บาท/ปี อยู่ในความอุปการะ (รวมบิดามารดาคู่สมรส) แอปตรวจเงื่อนไขไม่ได้ · ขีด 4 คน = ฝ่ายละ 2 คน (ผู้มีเงินได้และคู่สมรส)' },
  lifeInsurance: { capSatang: baht(100_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'กรมธรรม์อายุ 10 ปีขึ้นไป' },
  healthInsurance: { capSatang: baht(25_000), confidence: 'partial', source: SRC_DEDUCTIONS },
  lifeHealthGroup: { capSatang: baht(100_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'ประกันชีวิตรวมประกันสุขภาพ (ของตนเอง) ไม่เกิน 100,000' },
  parentsHealth: { capSatang: baht(15_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'เบี้ยประกันสุขภาพบิดามารดา' },
  mortgageInterest: { capSatang: baht(100_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'ดอกเบี้ยเงินกู้ซื้อ/สร้างที่อยู่อาศัยที่จำนองเป็นประกัน' },
  donation: { rateBps: 1000, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'บริจาคทั่วไปไม่เกินร้อยละ 10 ของเงินได้หลังหักค่าใช้จ่ายและค่าลดหย่อน · ไม่รองรับ e-Donation 2 เท่า (ยังไม่ยืนยัน)' },
  basisNotice: 'ตัวเลขกฎหมายอ้างอิงเอกสารกรมสรรพากร (ฉบับ ม.ค. 2568 และเอกสารปีภาษี 2569) ยังไม่พบประกาศแก้ไขสำหรับปี 2569 แต่ไม่ได้ตรวจครบทุกฉบับ',
};

/** ค่าสูงสุดของข้อมูลเข้า (สตางค์) กันตัวเลขเพี้ยนเงียบๆ: 100 ล้านบาท */
export const MAX_TAX_INPUT_SATANG = 10_000_000_000;
