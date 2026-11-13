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

/** 'continuing' = เกณฑ์ที่ใช้ต่อเนื่อง: ตัวเลขมาจากหน้า/เอกสารกรมสรรพากรของปีภาษีก่อนหน้า (ระบุปีไว้ใน note) และยังไม่พบประกาศเปลี่ยนแปลงสำหรับปี 2569 (ไม่ได้ตรวจครบทุกฉบับ) */
export type Basis = 'continuing';

export interface Sourced {
  readonly confidence: Confidence;
  /** ลิงก์/ชื่อเอกสารต้นทางหลัก */
  readonly source: string;
  /** ลิงก์เอกสารอื่นที่ยืนยันตัวเลขเดียวกัน */
  readonly moreSources?: readonly string[];
  readonly basis?: Basis;
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
  /** เพดานรวมกลุ่มเกษียณ (กองทุนสำรองเลี้ยงชีพ + RMF + ประกันชีวิตแบบบำนาญ) · Thai ESG อยู่นอกกลุ่ม */
  readonly retirementGroup: Sourced & { readonly capSatang: number };
  /** กองทุนสำรองเลี้ยงชีพ (PVD): หักลดหย่อนไม่เกิน deductionSatang ส่วนที่เกินได้รับยกเว้นไม่เกิน exemptCapSatang และไม่เกิน wageRateBps ของค่าจ้าง · นับในเพดานกลุ่มเกษียณ */
  readonly providentFund: Sourced & { readonly deductionSatang: number; readonly exemptCapSatang: number; readonly wageRateBps: number };
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
  /** ค่าฝากครรภ์และคลอดบุตร: จ่ายจริงไม่เกินเพดานต่อครรภ์ (แต่ละคราว) */
  readonly prenatal: Sourced & { readonly capPerPregnancySatang: number; readonly maxPregnancies: number };
  /** อุปการะคนพิการ/ทุพพลภาพ: คนละ perSatang · ญาติตามรายการ (บิดามารดา คู่สมรส บุตร ฯลฯ) ไม่จำกัดคนในแอป ขีด maxRelatives กันข้อมูลผิด · บุคคลอื่นไม่เกิน maxOthers */
  readonly disability: Sourced & { readonly perSatang: number; readonly maxRelatives: number; readonly maxOthers: number };
  /** บุตรบุญธรรม: คนละ perSatang · รวมกับบุตรชอบด้วยกฎหมายไม่เกิน maxTotalChildren คน (บุตรชอบด้วยกฎหมายตั้งแต่ครบจำนวนนี้ หักบุตรบุญธรรมไม่ได้) */
  readonly adoptedChild: Sourced & { readonly perSatang: number; readonly maxTotalChildren: number };
  /** เบี้ยประกันชีวิตของคู่สมรสที่ไม่มีเงินได้ (แยกจากกลุ่มประกันชีวิต+สุขภาพของผู้มีเงินได้) */
  readonly spouseLifeInsurance: Sourced & { readonly capSatang: number };
  /** ข้อความเตือนประจำปีภาษีนี้ แสดงคู่ผลลัพธ์ */
  readonly basisNotice: string;
}

const baht = (n: number): number => n * 100;

const SRC_RATES = 'https://www.rd.go.th/5938.html';
const SRC_RATES_EXEMPT = 'https://www.rd.go.th/fileadmin/user_upload/SMEs/infographic/Pit_63_7.pdf';
const SRC_DEDUCTIONS = 'https://www.rd.go.th/fileadmin/download/tax_deductions_update280168.pdf';
const SRC_PIT94_2569 = 'https://www.rd.go.th/fileadmin/tax_pdf/pit/2569/Ins94_160669.pdf';
const SRC_EXPENSE = 'https://www.rd.go.th/556.html';
const SRC_PVD = 'https://rd.go.th/59674.html';
const SRC_PENSION_EXAMPLE = 'https://www.rd.go.th/43975.html';
const SRC_SME_INFO = 'https://www.rd.go.th/fileadmin/user_upload/SMEs/infographic/SME_Infolv1_2.pdf';
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
  rmf: { rateBps: 3000, capSatang: null, confidence: 'partial', basis: 'continuing', source: SRC_SME_INFO, moreSources: [SRC_DEDUCTIONS], note: 'ร้อยละ 30 ของเงินได้ รวมกลุ่มเกษียณไม่เกิน 500,000 (อินโฟกราฟิกกรมสรรพากรปีภาษี 2565) ต้องถือครองตามเงื่อนไข (แอปตรวจไม่ได้)' },
  pensionInsurance: {
    rateBps: 1500,
    capSatang: baht(200_000),
    confidence: 'partial',
    basis: 'continuing',
    source: SRC_PENSION_EXAMPLE,
    moreSources: [SRC_SME_INFO, SRC_PIT94_2569],
    note: 'ร้อยละ 15 ของเงินได้ ไม่เกิน 200,000 บาท รวมกลุ่มเกษียณไม่เกิน 500,000 · ถ้าเบี้ยประกันชีวิตปกติ (รวมประกันสุขภาพ) ยังไม่เต็ม 100,000 ให้เติมเบี้ยบำนาญเข้าช่องประกันชีวิตก่อน แล้วส่วนที่เหลือจึงนับเข้ากลุ่มเกษียณ (ตัวอย่างหน้า 43975 ของกรมสรรพากร ซึ่งเป็นถาม-ตอบปี 2553 · เจ้าของเลือกแบบที่ผู้เสียภาษีได้สิทธิสูงสุด 13 พ.ย. 2569) · ประกาศอธิบดีฯ ฉบับ 462 ยังไม่ได้อ่านต้นฉบับ · ภ.ง.ด.94 ปี 2569 เป็นแบบของเงินได้ 40(5)-(8) ไม่ใช่เงินเดือน',
  },
  thaiEsg: {
    rateBps: 3000,
    capSatang: baht(300_000),
    confidence: 'partial',
    source: SRC_SEC_THAI_ESG,
    note: 'ร้อยละ 30 ไม่เกิน 300,000 บาท แยกเพดานจากกลุ่มเกษียณ 500,000 (ไม่รวมในกลุ่ม) · รวม Thai ESGX (เจ้าของยืนยันตาม ก.ล.ต. 12 พ.ย. 2569 ต้นฉบับอ่านจากเครื่องผู้ช่วยไม่ได้) ต้องถือครองตามเงื่อนไข',
  },
  retirementGroup: {
    capSatang: baht(500_000),
    confidence: 'partial',
    basis: 'continuing',
    source: SRC_SME_INFO,
    moreSources: [SRC_PVD, SRC_PENSION_EXAMPLE, SRC_PIT94_2569],
    note: 'เพดานรวมกองทุนสำรองเลี้ยงชีพ/กบข./กอช./RMF/ประกันบำนาญ ไม่เกิน 500,000 · ตัดตามลำดับคงที่: กองทุนสำรองเลี้ยงชีพ → RMF → ประกันบำนาญ · Thai ESG อยู่นอกกลุ่มนี้ ห้ามรวมในเพดานนี้ · แอปยังไม่รองรับ SSF/กบข./กอช. ซึ่งอยู่ในกลุ่มนี้ตามกฎหมาย',
  },
  providentFund: {
    deductionSatang: baht(10_000),
    exemptCapSatang: baht(490_000),
    wageRateBps: 1500,
    confidence: 'partial',
    basis: 'continuing',
    source: SRC_PVD,
    moreSources: [SRC_SME_INFO],
    note: 'หักลดหย่อนไม่เกิน 10,000 บาท ส่วนที่เกิน 10,000 ได้รับยกเว้นไม่เกิน 490,000 บาท และไม่เกินร้อยละ 15 ของค่าจ้าง รวมกลุ่มเกษียณไม่เกิน 500,000 (หน้า 59674 ระบุปีภาษี 2560) · ค่าจ้างในแอปใช้เงินได้จากเงินเดือนทั้งปี · เงื่อนไขของกองทุน (เช่น ระยะเวลาเป็นสมาชิก) แอปตรวจไม่ได้',
  },
  spouse: { satang: baht(60_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'คู่สมรสไม่มีเงินได้' },
  child: { baseSatang: baht(30_000), extraSatang: baht(30_000), maxCount: 20, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'บุตรชอบด้วยกฎหมายคนละ 30,000 · คนที่ 2 เป็นต้นไปที่เกิดตั้งแต่ปี 2561 คนละ 60,000 (ไม่รองรับบุตรบุญธรรม ซึ่งมีเงื่อนไขจำกัด 3 คน) · ขีดสูงสุด 20 คนเป็นขีดกันข้อมูลผิดของแอป ไม่ใช่เพดานตามกฎหมาย' },
  parent: { perSatang: baht(30_000), maxCount: 4, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'อายุ 60 ปีขึ้นไป รายได้ไม่เกิน 30,000 บาท/ปี อยู่ในความอุปการะ (รวมบิดามารดาคู่สมรส) แอปตรวจเงื่อนไขไม่ได้ · ขีด 4 คน = ฝ่ายละ 2 คน (ผู้มีเงินได้และคู่สมรส)' },
  lifeInsurance: { capSatang: baht(100_000), confidence: 'partial', basis: 'continuing', source: SRC_SME_INFO, moreSources: [SRC_DEDUCTIONS], note: 'กรมธรรม์อายุ 10 ปีขึ้นไป' },
  healthInsurance: { capSatang: baht(25_000), confidence: 'partial', basis: 'continuing', source: SRC_SME_INFO, moreSources: [SRC_DEDUCTIONS] },
  lifeHealthGroup: { capSatang: baht(100_000), confidence: 'partial', basis: 'continuing', source: SRC_SME_INFO, moreSources: [SRC_DEDUCTIONS], note: 'ประกันชีวิตรวมประกันสุขภาพ (ของตนเอง) ไม่เกิน 100,000' },
  parentsHealth: { capSatang: baht(15_000), confidence: 'partial', basis: 'continuing', source: SRC_SME_INFO, moreSources: [SRC_DEDUCTIONS], note: 'เบี้ยประกันสุขภาพบิดามารดา' },
  mortgageInterest: { capSatang: baht(100_000), confidence: 'partial', basis: 'continuing', source: SRC_SME_INFO, moreSources: [SRC_DEDUCTIONS], note: 'ดอกเบี้ยเงินกู้ซื้อ/สร้างที่อยู่อาศัยที่จำนองเป็นประกัน' },
  donation: { rateBps: 1000, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'บริจาคทั่วไปไม่เกินร้อยละ 10 ของเงินได้หลังหักค่าใช้จ่ายและค่าลดหย่อน · ไม่รองรับ e-Donation 2 เท่า (ยังไม่ยืนยัน)' },
  prenatal: { capPerPregnancySatang: baht(60_000), maxPregnancies: 2, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'ค่าฝากครรภ์และคลอดบุตรจ่ายจริงไม่เกิน 60,000 บาทต่อครรภ์ (แต่ละคราว) · รองรับสูงสุด 2 ครรภ์ต่อปี (ขีดของแอป)' },
  disability: { perSatang: baht(60_000), maxRelatives: 20, maxOthers: 1, confidence: 'partial', source: SRC_DEDUCTIONS, note: 'คนพิการที่มีบัตรประจำตัวคนพิการหรือทุพพลภาพ รายได้ไม่เกิน 30,000 บาท/ปี และต้องมีเอกสารตามเงื่อนไข (แอปตรวจไม่ได้) · ญาติตามรายการ (บิดามารดา คู่สมรส บุตร บิดามารดาคู่สมรส) ได้ทุกคน บุคคลอื่นได้ไม่เกิน 1 คน (ที่มา: ภ.ง.ด.94 ปี 2569 หัวข้อ 5) · คนเดียวกันที่ได้ลดหย่อนปกติ (คู่สมรส บิดามารดา บุตร) ใช้ลดหย่อนคนพิการได้ด้วย เพราะเป็นคนละรายการ' },
  adoptedChild: { perSatang: baht(30_000), maxTotalChildren: 3, confidence: 'partial', source: SRC_PIT94_2569, note: 'บุตรบุญธรรมคนละ 30,000 รวมกับบุตรชอบด้วยกฎหมายต้องไม่เกิน 3 คน และถ้าบุตรชอบด้วยกฎหมายมี 3 คนขึ้นไป หักบุตรบุญธรรมไม่ได้ · นับจำนวนบุตรชอบด้วยกฎหมายที่ยังมีชีวิตทั้งหมดรวมคนที่ไม่เข้าเกณฑ์ลดหย่อน · บุตรบุญธรรมไม่ได้ลดหย่อนเพิ่มสำหรับคนที่ 2 เป็นต้นไป (ที่มา: ภ.ง.ด.94 ปี 2569 หัวข้อ 3 ซึ่งเป็นแบบครึ่งปี ตัวเลขรายปีตามเอกสาร ม.ค. 2568)' },
  spouseLifeInsurance: { capSatang: baht(10_000), confidence: 'partial', source: SRC_DEDUCTIONS, note: 'เบี้ยประกันชีวิตของคู่สมรสที่ไม่มีเงินได้ (ต้องเป็นสามีภริยากันตลอดปีภาษี)' },
  basisNotice: 'ตัวเลขกฎหมายอ้างอิงเอกสารกรมสรรพากร (ฉบับ ม.ค. 2568 และเอกสารปีภาษี 2569) ยังไม่พบประกาศแก้ไขสำหรับปี 2569 แต่ไม่ได้ตรวจครบทุกฉบับ',
};

/** ค่าสูงสุดของข้อมูลเข้า (สตางค์) กันตัวเลขเพี้ยนเงียบๆ: 100 ล้านบาท */
export const MAX_TAX_INPUT_SATANG = 10_000_000_000;
