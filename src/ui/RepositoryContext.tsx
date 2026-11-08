import { createContext, useContext, type ReactNode } from 'react';
import { db } from '../storage/instance';
import { createDexieRepository, type LedgerRepository } from '../storage/ledgerRepository';

const defaultRepository = createDexieRepository(db);
const RepositoryContext = createContext<LedgerRepository>(defaultRepository);

/** หน้าจอรับ repository ผ่านที่นี่ ไม่ import db ตรง (M2-C: สลับเป็น Supabase ได้ที่เดียว) */
export function RepositoryProvider({ repository, children }: { repository: LedgerRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): LedgerRepository {
  return useContext(RepositoryContext);
}

/** สำหรับโค้ดนอก React (เช่น backup.ts) */
export function defaultLedgerRepository(): LedgerRepository {
  return defaultRepository;
}
