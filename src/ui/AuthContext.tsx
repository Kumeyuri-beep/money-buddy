import { createContext, useContext } from 'react';

export interface AccountContextValue {
  /** ชื่อผู้ใช้ที่ล็อกอินอยู่ (ไม่ใช่อีเมลภายใน) */
  username: string;
  signOut: () => Promise<void>;
  /** อ่านสถานะบัญชีใหม่ (เช่น หลังเปลี่ยนรหัสผ่าน) */
  refresh: () => Promise<void>;
}

export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount ต้องอยู่ภายใต้ AuthGate');
  return value;
}
