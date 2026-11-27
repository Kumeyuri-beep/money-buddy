import { useEffect, useRef, useState } from 'react';
import { thaiIsoDate } from '../app/dates';
import { readBackupFile, type BackupFileRead } from '../app/importFile';
import type { VerifyReport } from '../app/importVerify';
import { checkInvestImport } from '../app/investImport';
import { importAndVerify, RESET_CANCELLED_MESSAGE, verifyOnline } from '../app/migrate';
import { InvestmentImportError, type ImportOptions } from '../storage/ledgerRepository';
import { isEmptyInvestments } from '../domain/invest/types';
import { StorageError } from '../storage/repository';
import { BalanceTable } from './ImportReportTable';
import { useCategoryGuard } from './ReplaceCategoriesDialog';
import { useRepository } from './RepositoryContext';

type ReadyFile = Extract<BackupFileRead, { ok: true }>;

type Step =
  | { name: 'pick' }
  | { name: 'reading' }
  | { name: 'review'; read: BackupFileRead }
  | { name: 'importing'; verifying?: boolean }
  | { name: 'result'; report: VerifyReport; counts: { accounts: number; entries: number; bills: number } }
  /** retry = สมุดบัญชีเข้าแล้ว ลองเฉพาะขั้นข้อมูลลงทุนได้ (ไฟล์อยู่ในหน่วยความจำเท่านั้น) · stopped = ข้อมูลออนไลน์ไม่ตรงกับไฟล์ ห้ามลองต่อ */
  | { name: 'error'; message: string; retry?: ReadyFile; verifyOnly?: boolean; stopped?: boolean };

const friendly = (e: unknown): string => (e instanceof StorageError ? e.message : 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');

const RETRY_CANCEL_NOTE = 'สมุดบัญชีนำเข้าแล้วและจะไม่ถูกแตะ กดยกเลิก จะยังไม่ทำอะไรต่อ';
const LEDGER_SAVED = 'สมุดบัญชีนำเข้าแล้ว';

/** ไฟล์ไม่มีข้อมูลลงทุน = ขั้นที่ค้างมีแค่การลบหมวดเดิม ข้อความต้องไม่พูดเรื่องนำเข้าข้อมูลลงทุน */
const onlyDeletes = (read: ReadyFile): boolean => isEmptyInvestments(read.data.investments);

/**
 * นำเข้าจากไฟล์สำรองที่ผู้ใช้เลือกเอง (backlog หลัง M2) · ใช้เมื่อสมุดออนไลน์ยังว่างเท่านั้น (ฐานข้อมูลปฏิเสธถ้ามีข้อมูลอยู่แล้ว ไม่ทับ)
 * ลำดับ: เลือกไฟล์ -> ตรวจ (ปฏิเสธทั้งไฟล์ถ้าผิดข้อใดข้อหนึ่ง) -> นำเข้า (ธุรกรรมเดียว) -> อ่านกลับมาเทียบยอด -> ผู้ใช้ติ๊กยืนยัน
 * ไฟล์ที่เลือกไม่ถูกแก้หรือลบ · ที่ล้างได้มีเฉพาะข้อมูลออนไลน์ที่เพิ่งนำเข้า (ต้องใส่รหัสผ่านผ่านฐานข้อมูล)
 */
export function ImportBackupPanel({ onDone }: { onDone: () => void }) {
  const repo = useRepository();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const [ack, setAck] = useState(false);
  const [wipeNote, setWipeNote] = useState('');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // stopped: ยังเป็นขั้น error เดิมแต่ปุ่มลองใหม่ถูกถอด ต้องย้ายโฟกัสด้วย
  const stopped = step.name === 'error' && step.stopped === true;
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step.name, stopped]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setStep({ name: 'reading' });
    try {
      setStep({ name: 'review', read: await readBackupFile(file, thaiIsoDate()) });
    } catch {
      setStep({ name: 'review', read: { ok: false, fileName: file.name.slice(0, 60), problems: ['อ่านไฟล์ไม่ได้ ลองเลือกไฟล์อื่นหรือเลือกไฟล์เดิมอีกครั้ง'] } });
    }
  };

  const { guard, checking, dialog } = useCategoryGuard(repo, (e) =>
    // นับหมวดไม่ได้ระหว่างลองใหม่: ปุ่มลองใหม่ต้องไม่หาย
    setStep((prev) =>
      prev.name === 'error' && prev.retry
        ? { ...prev, message: `${LEDGER_SAVED} · ตรวจหมวดเดิมไม่ได้ จึงยังไม่ได้ทำอะไร (${friendly(e)})` }
        : { name: 'error', message: friendly(e) },
    ),
  );
  const [rechecking, setRechecking] = useState(false);
  const retryBusy = useRef(false);
  // เปลี่ยนทุกครั้งที่ลองใหม่: ข้อความเตือนเดิมถูกสร้างใหม่ โปรแกรมอ่านจอจึงอ่านซ้ำ
  const [attempt, setAttempt] = useState(0);

  const showResult = (report: VerifyReport, counts: { accounts: number; entries: number; bills: number }) => {
    setAck(false);
    setWipeNote('');
    setStep({ name: 'result', report, counts });
  };

  /** ข้อมูลลงทุนเข้าครบแล้ว: ตรวจยอดสมุดบัญชี (รอบที่ล้มยังไม่ได้ตรวจ) · อ่านไม่ได้ = กดลองใหม่ได้ */
  const verifyRetried = async (read: ReadyFile) => {
    setStep({ name: 'importing', verifying: true });
    setProgress(null);
    try {
      const { accounts, entries, bills } = read.data;
      showResult(await verifyOnline(read.data, repo), { accounts: accounts.length, entries: entries.length, bills: bills.length });
    } catch (e) {
      const done = onlyDeletes(read) ? 'ลบหมวดเดิมแล้ว' : 'ข้อมูลลงทุนเข้าแล้ว';
      setStep({ name: 'error', message: `${LEDGER_SAVED} · ${done} แต่ตรวจยอดไม่ได้ (${friendly(e)})`, retry: read, verifyOnly: true });
    }
  };

  const stop = () =>
    setStep({ name: 'error', message: `${LEDGER_SAVED} แต่ข้อมูลลงทุนออนไลน์ไม่ตรงกับไฟล์ ระบบจึงหยุด ไม่ได้ลบหรือทับอะไร เก็บไฟล์สำรองไว้และแจ้งผู้ดูแลระบบ`, stopped: true });

  const runRetry = async (read: ReadyFile, options?: ImportOptions) => {
    setStep({ name: 'importing' });
    setProgress(null);
    try {
      await repo.retryImportInvestments(read.data.investments, options);
    } catch (e) {
      // รอบก่อนอาจเพิ่งบันทึกเสร็จ (ฐานข้อมูลจึงปฏิเสธรอบนี้) ตรวจสถานะอีกครั้งก่อนบอกว่าไม่สำเร็จ
      try {
        const state = await checkInvestImport(read.data.investments, repo);
        if (state === 'different') stop();
        else if (state === 'not_imported') setStep({ name: 'error', message: friendly(e), retry: read });
        else await verifyRetried(read);
      } catch {
        setStep({ name: 'error', message: `${LEDGER_SAVED} · ยืนยันผลของการลองครั้งนี้ไม่ได้ (การเชื่อมต่อมีปัญหา)`, retry: read });
      }
      return;
    }
    await verifyRetried(read);
  };

  // อ่านสถานะออนไลน์ก่อนทุกครั้ง (รอบก่อนอาจบันทึกสำเร็จแต่คำตอบหาย)
  const retry = async (read: ReadyFile) => {
    if (retryBusy.current || checking) return;
    retryBusy.current = true;
    setRechecking(true);
    setAttempt((n) => n + 1);
    try {
      const state = await checkInvestImport(read.data.investments, repo);
      if (state === 'match') await verifyRetried(read);
      else if (state === 'different') stop();
      else await guard(read.data.investments?.categories?.length ?? 0, (options) => void runRetry(read, options), { cancelNote: RETRY_CANCEL_NOTE, deleteOnly: onlyDeletes(read) });
    } catch (e) {
      setStep((prev) => ({
        name: 'error',
        message: `${LEDGER_SAVED} · อ่านข้อมูลออนไลน์ไม่ได้ จึงยังไม่ได้ทำอะไร (${friendly(e)})`,
        retry: read,
        verifyOnly: prev.name === 'error' && prev.verifyOnly,
      }));
    } finally {
      retryBusy.current = false;
      setRechecking(false);
    }
  };

  const doImport = async (read: ReadyFile, options?: ImportOptions) => {
    setStep({ name: 'importing' });
    setProgress(null);
    try {
      const result = await importAndVerify(read.data, repo, (done, total) => setProgress([done, total]), options);
      showResult(result.report, result.counts);
    } catch (e) {
      setStep({ name: 'error', message: friendly(e), retry: e instanceof InvestmentImportError ? read : undefined });
    }
  };

  // ด่านเดียวคือหน้าต่างถามรหัสผ่านของฐานข้อมูล · ยกเลิก/รหัสผิด = อยู่หน้าเดิม ไม่ล้างอะไร
  const wipe = async () => {
    setWipeNote('');
    try {
      await repo.resetAll();
      setStep({ name: 'pick' });
    } catch (e) {
      const message = friendly(e);
      setWipeNote(message === RESET_CANCELLED_MESSAGE ? 'ยกเลิกแล้ว ไม่ได้ล้างอะไร' : message);
    }
  };

  if (!open) {
    return (
      <section className="solid card setup" aria-labelledby="import-open-title">
        <h2 id="import-open-title">มีไฟล์สำรองอยู่แล้ว?</h2>
        <p className="muted">นำเข้าสมุดบัญชีจากไฟล์สำรอง (.json) ที่คุณเคยดาวน์โหลดไว้จากแอปนี้ แทนการตั้งต้นใหม่</p>
        <div className="actions">
          <button className="btn btn-ghost" type="button" onClick={() => setOpen(true)}>
            นำเข้าจากไฟล์สำรอง
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="solid card setup" aria-labelledby="import-title">
      <h2 id="import-title" ref={headingRef} tabIndex={-1}>
        นำเข้าจากไฟล์สำรอง
      </h2>

      {step.name === 'pick' && (
        <div className="migrate-body">
          <p>เลือกไฟล์สำรอง (.json) แอปจะตรวจทั้งไฟล์ก่อน ถ้าพบข้อมูลผิดแม้แต่รายการเดียวจะไม่นำเข้าอะไรเลย ไฟล์ของคุณไม่ถูกแก้หรือลบ</p>
          <div className="field">
            <label htmlFor="import-file">ไฟล์สำรอง</label>
            <input
              id="import-file"
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                void choose(file);
                e.target.value = ''; // เลือกไฟล์เดิมซ้ำได้
              }}
            />
          </div>
          <div className="actions">
            <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {(step.name === 'reading' || step.name === 'importing') && (
        <>
        <p role="status" className="muted">
          {step.name === 'importing'
            ? `${step.verifying ? 'กำลังตรวจยอด' : 'กำลังนำเข้าและตรวจยอด'}... อย่าปิดหน้านี้`
            : 'กำลังอ่านและตรวจไฟล์...'}
        </p>
        {step.name === 'importing' && progress && (
          <p className="muted">
            <progress value={progress[0]} max={progress[1]} aria-label="ความคืบหน้าการนำเข้า" /> นำเข้าแล้ว {progress[0].toLocaleString('th-TH')} จาก {progress[1].toLocaleString('th-TH')} รายการ
          </p>
        )}
        </>
      )}

      {step.name === 'review' && !step.read.ok && (
        <div className="migrate-body">
          <p role="alert" className="form-error">
            นำเข้าไม่ได้ เพราะไฟล์ "{step.read.fileName}" มีข้อมูลที่ไม่ถูกต้อง ยังไม่มีอะไรถูกนำเข้า
          </p>
          <ul className="migrate-list">
            {step.read.problems.slice(0, 20).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <div className="actions">
            <button className="btn btn-primary" type="button" onClick={() => setStep({ name: 'pick' })}>
              เลือกไฟล์อื่น
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => { setStep({ name: 'pick' }); setOpen(false); }}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {step.name === 'review' && step.read.ok && (
        <ReviewBody
          read={step.read}
          onImport={() => {
            const read = step.read as Extract<BackupFileRead, { ok: true }>;
            void guard(read.data.investments?.categories?.length ?? 0, (options) => void doImport(read, options));
          }}
          checking={checking}
          onBack={() => {
            if (!checking) setStep({ name: 'pick' });
          }}
        />
      )}
      {dialog}

      {step.name === 'result' && (
        <div className="migrate-body">
          <p>
            นำเข้าแล้ว: {step.counts.accounts} บัญชี · {step.counts.entries} รายการ · {step.counts.bills} บิล
          </p>
          <BalanceTable report={step.report} sourceLabel="ในไฟล์" />
          {step.report.ok ? (
            <>
              <p className="auth-ok">✓ ตรงกันทุกอย่าง: จำนวนบัญชี รายการ บิล ยอดต่อบัญชี เนื้อหารายการ และค่าตั้งค่า</p>
              <label className="migrate-check">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>ฉันตรวจยอดแล้ว ตรงกับที่ฉันเคยเห็น</span>
              </label>
              {!ack && (
                <p id="import-confirm-reason" className="muted">
                  ติ๊กช่อง "ฉันตรวจยอดแล้ว" ก่อน จึงจะกดเริ่มใช้งานได้
                </p>
              )}
              <div className="actions">
                <button className="btn btn-primary" type="button" disabled={!ack} onClick={onDone} aria-describedby={ack ? undefined : 'import-confirm-reason'}>
                  เริ่มใช้งาน
                </button>
              </div>
            </>
          ) : (
            <>
              <p role="alert" className="form-error">
                ⚠ ยอดไม่ตรงกัน จึงยังไม่ให้ใช้งานต่อ ถ่ายภาพหน้าจอนี้และเก็บไฟล์สำรองไว้
              </p>
              <ul className="migrate-list">
                {step.report.problems.slice(0, 20).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              <p id="import-wipe-warn" className="slip-warn">
                ปุ่มด้านล่างจะล้างข้อมูลออนไลน์ของบัญชีนี้ <strong>ทั้งหมด</strong> ตอนนี้มี {step.report.counts.accounts[1]} บัญชี · {step.report.counts.entries[1]} รายการ · {step.report.counts.bills[1]} บิล (ตัวเลขนี้นับตอนตรวจยอด ถ้าคุณเพิ่มรายการจากหน้าต่างอื่นระหว่างนี้ จะถูกล้างไปด้วย)
              </p>
              <div className="actions">
                <button className="btn btn-danger" type="button" onClick={() => void wipe()} aria-describedby="import-wipe-warn">
                  ล้างข้อมูลออนไลน์เพื่อนำเข้าใหม่
                </button>
              </div>
              <div role={wipeNote ? 'alert' : 'status'} className="auth-error">
                {wipeNote}
              </div>
            </>
          )}
        </div>
      )}

      {step.name === 'error' && (
        <div className="migrate-body">
          <p key={attempt} role="alert" className="form-error">
            ⚠ {step.message}
          </p>
          {step.retry ? (
            <>
              <p className="muted">
                {step.verifyOnly
                  ? 'ปุ่มด้านล่างอ่านข้อมูลออนไลน์มาตรวจยอด ไม่นำเข้าซ้ำ'
                  : `ปุ่มลองใหม่จะตรวจก่อนว่า${onlyDeletes(step.retry) ? 'ลบหมวดเดิมแล้วหรือยัง' : 'ข้อมูลลงทุนเข้าหรือยัง'} ไม่นำเข้าสมุดบัญชีซ้ำ`}{' '}
                ไฟล์สำรองของคุณไม่ถูกแตะต้อง
              </p>
              <p id="import-retry-warn" className="slip-warn">ปิดหรือโหลดหน้าใหม่แล้ว ปุ่มลองใหม่จะหาย</p>
            </>
          ) : step.stopped ? (
            <p className="muted">ไฟล์สำรองของคุณไม่ถูกแตะต้อง</p>
          ) : (
            <p className="muted">ถ้าบัญชีนี้มีข้อมูลอยู่แล้ว แอปจะไม่นำเข้าทับ โหลดหน้าใหม่เพื่อตรวจสถานะ ไฟล์สำรองของคุณไม่ถูกแตะต้อง</p>
          )}
          <div className="actions">
            {step.retry && (
              <button className="btn btn-primary" type="button" aria-disabled={rechecking || checking || undefined} onClick={() => void retry(step.retry as ReadyFile)}>
                {step.verifyOnly ? 'ตรวจยอดอีกครั้ง' : onlyDeletes(step.retry) ? 'ลองลบหมวดเดิมอีกครั้ง' : 'ลองนำเข้าข้อมูลลงทุนอีกครั้ง'}
              </button>
            )}
            <button className={step.retry ? 'btn btn-ghost' : 'btn btn-primary'} type="button" onClick={() => window.location.reload()} aria-describedby={step.retry ? 'import-retry-warn' : undefined}>
              โหลดหน้าใหม่
            </button>
          </div>
          {step.retry && (
            <p role="status" className="muted">
              {rechecking ? 'กำลังตรวจข้อมูลลงทุนออนไลน์...' : ''}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewBody({ read, checking, onImport, onBack }: { read: Extract<BackupFileRead, { ok: true }>; checking: boolean; onImport: () => void; onBack: () => void }) {
  return (
    <div className="migrate-body">
      <p>
        ไฟล์ "{read.fileName}" พบ {read.summary.accounts} บัญชี · {read.summary.entries} รายการ · {read.summary.bills} บิล{read.summary.assets !== undefined ? ` · ${read.summary.assets} สินทรัพย์ลงทุน · ${read.summary.trades ?? 0} รายการลงทุน` : ''} ตรวจแล้ว: ตัวเลขเงินถูกต้อง และทุกรายการบวกลบลงตัว ขั้นถัดไปจะแสดงยอดแต่ละบัญชีให้เทียบกับไฟล์
      </p>
      {read.warnings.length > 0 && (
        <div className="slip-warn" role="note">
          <strong>ข้อควรทราบ</strong>
          <ul className="migrate-list">
            {read.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={onImport} aria-disabled={checking || undefined}>
          นำเข้า
        </button>
        <button className="btn btn-ghost" type="button" onClick={onBack} aria-disabled={checking || undefined}>
          เลือกไฟล์อื่น
        </button>
      </div>
      <p role="status" className="muted">{checking ? 'กำลังตรวจหมวดเดิม...' : ''}</p>
    </div>
  );
}
