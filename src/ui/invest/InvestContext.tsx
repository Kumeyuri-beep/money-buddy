import { createContext, useContext } from 'react';
import type { InvestmentData } from '../../domain/invest/types';
import type { Account, Entry } from '../../domain/ledger/types';

/** สกุลที่แสดงในโหมดพอร์ต (สลับด้วยปุ่ม ฿/USD ที่หัวโหมด) · แท็บที่แสดงตัวเลขเงินอ่านค่านี้เพื่อเลือกสกุลที่โชว์ (ตัวเลขทั้งหมดมาจากฟังก์ชันใน src/domain) */
export type InvestCurrency = 'THB' | 'USD';

/** ชื่อ/คำอธิบาย/สกุลเริ่มต้นของพอร์ต (เก็บใน settings · ไม่ใช่ข้อมูลเงิน) */
export interface PortfolioSettings {
  name: string;
  note: string;
  currency: InvestCurrency;
}

export const DEFAULT_PORTFOLIO_NAME = 'Main portfolio';

export interface InvestContextValue {
  portfolio?: PortfolioSettings;
  today: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** กระเป๋าเงินสดบาทที่เลือกจ่าย/รับเงินได้ */
  wallets: readonly { id: string; name: string }[];
  /** ข้อมูลลงทุนทั้งหมดของผู้ใช้ (null = ยังโหลดไม่เสร็จ) · โหลดครั้งเดียวที่หัวโหมด ใช้ร่วมกันทุกแท็บ */
  data: InvestmentData | null;
  loadError: string;
  /** โหลดข้อมูลลงทุนใหม่ (หลังบันทึก/แก้รายการ) */
  reload: () => Promise<void>;
  /** แจ้งแอปให้โหลดสมุดบัญชีใหม่ (หลังรายการลงทุนเปลี่ยนยอดในสมุด) */
  onLedgerChanged: () => void;
  /** ไปหน้าแผนเกษียณ (ถ้าแอปส่งมา) */
  onOpenRetirement?: () => void;
  currency: InvestCurrency;
  setCurrency: (c: InvestCurrency) => void;
}

export const InvestContext = createContext<InvestContextValue | null>(null);

export function useInvest(): InvestContextValue {
  const v = useContext(InvestContext);
  if (!v) throw new Error('useInvest ต้องอยู่ใต้ InvestMode');
  return v;
}
