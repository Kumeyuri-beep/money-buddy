import { createContext, useContext, type ReactNode } from 'react';
import { db } from '../storage/instance';
import { createDexieRepository, type LedgerRepository } from '../storage/ledgerRepository';

/** ข้อมูลที่เก็บในเบราว์เซอร์นี้ (Dexie) · ไม่เคยถูกลบโดยโค้ดย้ายข้อมูล */
const localRepository = createDexieRepository(db);
const RepositoryContext = createContext<LedgerRepository>(localRepository);

/** หน้าจอรับ repository ผ่านที่นี่ ไม่ import db ตรง (M2-C: สลับเป็น Supabase ได้ที่เดียว) */
export function RepositoryProvider({ repository, children }: { repository: LedgerRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): LedgerRepository {
  return useContext(RepositoryContext);
}

/** ข้อมูลในเบราว์เซอร์นี้ (ใช้ดาวน์โหลดสำรองจากหน้าล็อกอิน และเป็นต้นทางของการย้ายข้อมูล) */
export function localLedgerRepository(): LedgerRepository {
  return localRepository;
}

let activeRepository: LedgerRepository | null = null;

/** ตั้ง/ล้าง repository ที่แอปใช้อยู่จริง (ตอนใช้บัญชีออนไลน์) ให้โค้ดนอก React อย่าง ErrorBoundary สำรองข้อมูลจากแหล่งเดียวกับที่ผู้ใช้เห็น */
export function setActiveLedgerRepository(repository: LedgerRepository | null): void {
  activeRepository = repository;
}

/** repository ออนไลน์ที่แอปใช้อยู่ตอนนี้ (null = ยังไม่ได้เปิดใช้บัญชีออนไลน์ หรือออกจากระบบแล้ว) */
export function activeLedgerRepository(): LedgerRepository | null {
  return activeRepository;
}
