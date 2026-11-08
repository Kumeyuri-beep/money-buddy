import { thaiIsoDate } from '../app/dates';
import { prepareLocalBackup } from '../app/localBackup';
import type { LedgerRepository } from '../storage/ledgerRepository';
import { db } from '../storage/instance';
import { getLocalOwner } from '../storage/localOwner';
import { supabase } from '../storage/supabase';
import { activeLedgerRepository, localLedgerRepository } from './RepositoryContext';

function saveJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * ดาวน์โหลดข้อมูลที่เก็บในเบราว์เซอร์นี้โดยไม่ต้องล็อกอิน (หน้าล็อกอินและขั้นแรกของการย้ายข้อมูล)
 * อ่านจากฐานข้อมูลในเครื่องเท่านั้น ไม่ผ่านเครือข่าย · คืน saved=false ถ้าไม่มีข้อมูลในเครื่องนี้
 */
export async function downloadLocalData(): Promise<{ saved: boolean; accounts: number; entries: number }> {
  const prepared = await prepareLocalBackup(localLedgerRepository());
  if (prepared.status === 'empty') return { saved: false, accounts: 0, entries: 0 };
  saveJson(prepared.json, prepared.filename);
  return { saved: true, accounts: prepared.accounts, entries: prepared.entries };
}

/**
 * เลือกแหล่งสำรองเมื่อไม่ได้ระบุ: บัญชีออนไลน์ที่ใช้อยู่ก่อนเสมอ · ไม่มี (เช่น แอปล้มก่อนเปิดบัญชีออนไลน์) จึงใช้ข้อมูลในเครื่อง
 * แต่เฉพาะเมื่อไม่มีใครล็อกอินอยู่ หรือข้อมูลในเครื่องเป็นของผู้ที่ล็อกอินอยู่ หรือยังไม่มีเจ้าของ · ข้อมูลของบัญชีอื่นห้ามดาวน์โหลดผ่านทางนี้
 */
async function defaultBackupSource(): Promise<LedgerRepository> {
  const active = activeLedgerRepository();
  if (active) return active;
  const owner = await getLocalOwner(db);
  if (owner === null) return localLedgerRepository();
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (session === null || session.user.id === owner) return localLedgerRepository();
  throw new Error('ข้อมูลที่เก็บในเครื่องนี้เป็นของบัญชีอื่น');
}

/**
 * ดาวน์โหลดไฟล์สำรองข้อมูล (JSON) จากแหล่งที่แอปใช้อยู่ตอนนี้ (ดู defaultBackupSource)
 * ไม่ผ่านสูตรเงิน จึงใช้ได้แม้หน้าจอล้ม (ErrorBoundary) · ส่ง repository มาเองได้
 */
export async function downloadBackup(repository?: LedgerRepository): Promise<void> {
  const snapshot = await (repository ?? (await defaultBackupSource())).exportSnapshot();
  saveJson(JSON.stringify(snapshot, null, 2), `money-buddy-backup-${thaiIsoDate()}.json`);
}
