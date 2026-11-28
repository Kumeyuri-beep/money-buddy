import { useEffect, useRef, useState } from 'react';
import { thaiIsoDate } from '../app/dates';
import { writeMigrationFlag } from '../app/dataSource';
import { importAndVerify, readLocalForMigration, RESET_CANCELLED_MESSAGE, VerifyAfterImportError, verifyOnline, type LocalRead } from '../app/migrate';
import type { VerifyReport } from '../app/importVerify';
import type { ImportOptions, LedgerRepository } from '../storage/ledgerRepository';
import { StorageError } from '../storage/repository';
import { useAccount } from './AuthContext';
import { downloadLocalData } from './backup';
import { BalanceTable } from './ImportReportTable';
import { useCategoryGuard } from './ReplaceCategoriesDialog';
import { localLedgerRepository } from './RepositoryContext';

interface Props {
  userId: string;
  online: LedgerRepository;
  /** migrate = เพิ่งเริ่มย้าย · verify = นำเข้าไปแล้วแต่ยังไม่ได้ยืนยันว่ายอดตรง */
  mode: 'migrate' | 'verify';
  /** เจ้าของกดยืนยันแล้ว (ธงถูกตั้งเป็น confirmed) */
  onDone: () => void;
}

type Step =
  | { name: 'backup' }
  | { name: 'reading' }
  | { name: 'review'; read: LocalRead }
  | { name: 'importing' }
  | { name: 'result'; report: VerifyReport; counts: { accounts: number; entries: number; bills: number } | null }
  | { name: 'error'; message: string };

const friendly = (e: unknown): string => (e instanceof StorageError ? e.message : 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');

function titleOf(step: Step): string {
  switch (step.name) {
    case 'backup':
      return 'ขั้นที่ 1: ดาวน์โหลดไฟล์สำรองก่อน';
    case 'reading':
      return 'ขั้นที่ 2: กำลังตรวจข้อมูลเดิม';
    case 'review':
      return step.read.ok ? 'ขั้นที่ 2: ตรวจแล้ว พร้อมนำเข้า' : 'ข้อมูลเดิมไม่ผ่านการตรวจ';
    case 'importing':
      return 'ขั้นที่ 3: กำลังนำเข้า';
    case 'result':
      return 'ขั้นที่ 4: ตรวจยอดหลังนำเข้า';
    case 'error':
      return 'เกิดข้อผิดพลาด';
  }
}

/**
 * ย้ายข้อมูลที่เก็บในเบราว์เซอร์ขึ้นบัญชีออนไลน์ (M2-D2) ทีละขั้น: สำรอง -> ตรวจ -> นำเข้า -> ตรวจยอด -> เจ้าของยืนยัน
 * ข้อมูลในเครื่องไม่ถูกแก้หรือลบตลอดทาง (อ่านอย่างเดียว) · ที่ล้างได้มีเฉพาะข้อมูลที่นำเข้าขึ้นออนไลน์ (ต้องใส่รหัสผ่าน)
 */
export function MigrationWizard({ userId, online, mode, onDone }: Props) {
  const { username, signOut } = useAccount();
  const [step, setStep] = useState<Step>(mode === 'verify' ? { name: 'reading' } : { name: 'backup' });
  const [backupNote, setBackupNote] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [wipeNote, setWipeNote] = useState('');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // เปลี่ยนขั้น = ย้ายโฟกัสมาที่หัวข้อของขั้นใหม่ (ปุ่มเดิมถูกถอดออกจากหน้า ผู้ใช้คีย์บอร์ดไม่ต้องกด Tab ตั้งแต่ต้น)
  useEffect(() => {
    headingRef.current?.focus();
  }, [step.name]);

  // โหมดตรวจซ้ำ: นำเข้าไปแล้ว อ่านต้นทางและออนไลน์มาเทียบอีกครั้งทันที
  useEffect(() => {
    if (mode !== 'verify') return;
    let cancelled = false;
    void (async () => {
      try {
        const read = await readLocalForMigration(localLedgerRepository(), thaiIsoDate());
        if (cancelled) return;
        if (!read.ok) {
          setStep({ name: 'error', message: 'ข้อมูลเดิมในเครื่องนี้ไม่ผ่านการตรวจ จึงเทียบยอดไม่ได้: ' + read.problems.slice(0, 5).join(' · ') });
          return;
        }
        const report = await verifyOnline(read.data, online);
        if (!cancelled) setStep({ name: 'result', report, counts: null });
      } catch (e) {
        if (!cancelled) setStep({ name: 'error', message: friendly(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, online]);

  const doBackup = async () => {
    if (busy) return;
    setBusy(true);
    setBackupNote('');
    try {
      const result = await downloadLocalData();
      if (result.saved) {
        setBackedUp(true);
        setBackupNote(`ดาวน์โหลดแล้ว (${result.accounts} บัญชี ${result.entries} รายการ) เก็บไฟล์นี้ไว้ในที่ปลอดภัย`);
      } else {
        setBackupNote('ไม่พบข้อมูลในเบราว์เซอร์นี้');
      }
    } catch {
      setBackupNote('ดาวน์โหลดไม่สำเร็จ ลองอีกครั้ง');
    }
    setBusy(false);
  };

  const doRead = async () => {
    setStep({ name: 'reading' });
    try {
      setStep({ name: 'review', read: await readLocalForMigration(localLedgerRepository(), thaiIsoDate()) });
    } catch (e) {
      setStep({ name: 'error', message: friendly(e) });
    }
  };

  const { guard, checking, dialog } = useCategoryGuard(online, (e) => setStep({ name: 'error', message: friendly(e) }));

  const doImport = async (read: Extract<LocalRead, { ok: true }>, options?: ImportOptions) => {
    setStep({ name: 'importing' });
    setProgress(null);
    // ตั้งธง "รอยืนยัน" ก่อนนำเข้า: ถ้าปิดแท็บกลางทางแล้วเปิดใหม่ จะเห็นหน้าตรวจยอดต่อ ไม่ข้ามเข้าแอปเงียบๆ
    writeMigrationFlag(window.localStorage, userId, 'pending');
    try {
      const result = await importAndVerify(read.data, online, (done, total) => setProgress([done, total]), options);
      setAck(false);
      setWipeNote('');
      setStep({ name: 'result', report: result.report, counts: result.counts });
    } catch (e) {
      // นำเข้าถูกปฏิเสธ/ล้มก่อนเขียน (ออนไลน์ยังว่าง) = ไม่มีอะไรรอยืนยัน เคลียร์ธง ไม่งั้นเปิดใหม่จะเข้าหน้าตรวจยอดและมีปุ่มล้างข้อมูลออนไลน์ที่ไม่ได้มาจากการนำเข้านี้
      try {
        if (await online.isEmpty()) {
          // ว่างของ "บัญชีที่ล็อกอินอยู่ตอนนี้": ถ้าสลับบัญชีไปแล้ว ห้ามล้างธงของบัญชีเดิม
          await online.confirmSameAccount();
          writeMigrationFlag(window.localStorage, userId, 'none');
        }
      } catch {
        /* ตรวจไม่ได้ ปล่อยธงไว้ ผู้ใช้จะเห็นหน้าตรวจยอดซึ่งแสดงจำนวนข้อมูลออนไลน์ก่อนอนุญาตให้ล้าง */
      }
      // ข้อความของตัวย้ายข้อมูลคงเดิม: แสดงสาเหตุของการอ่าน (โหลดใหม่แล้วเข้าหน้าตรวจยอดเอง)
      setStep({ name: 'error', message: friendly(e instanceof VerifyAfterImportError ? e.cause : e) });
    }
  };

  const confirm = () => {
    writeMigrationFlag(window.localStorage, userId, 'confirmed');
    onDone();
  };

  // ด่านเดียวคือหน้าต่างถามรหัสผ่าน (ข้อความเตือนอยู่ในนั้น) · ยกเลิก/รหัสผิด = อยู่หน้าเดิมพร้อมข้อความ ไม่ล้างอะไร
  const wipeOnline = async () => {
    setWipeNote('');
    try {
      await online.resetAll();
      writeMigrationFlag(window.localStorage, userId, 'none');
      setBackedUp(true); // เคยสำรองแล้ว
      setStep({ name: 'backup' });
    } catch (e) {
      const message = friendly(e);
      setWipeNote(message === RESET_CANCELLED_MESSAGE ? 'ยกเลิกแล้ว ไม่ได้ล้างอะไร' : message);
    }
  };

  return (
    <main className="auth-page">
      <section className="solid card auth-card migrate-card" aria-labelledby="migrate-title">
        <h1 id="migrate-title">ย้ายข้อมูลขึ้นบัญชีออนไลน์</h1>
        <p className="muted">
          บัญชี <strong>{username}</strong> · ข้อมูลเดิมในเบราว์เซอร์นี้จะถูกคัดลอกขึ้นบัญชีออนไลน์ <strong>ข้อมูลเดิมในเครื่องไม่ถูกลบหรือแก้ไข</strong>
        </p>
        <ol className="migrate-steps" aria-label="ขั้นตอน">
          <li aria-current={step.name === 'backup' ? 'step' : undefined}>สำรอง</li>
          <li aria-current={step.name === 'review' || step.name === 'reading' ? 'step' : undefined}>ตรวจ</li>
          <li aria-current={step.name === 'importing' ? 'step' : undefined}>นำเข้า</li>
          <li aria-current={step.name === 'result' ? 'step' : undefined}>ยืนยันยอด</li>
        </ol>

        <h2 ref={headingRef} tabIndex={-1} className="migrate-heading">
          {titleOf(step)}
        </h2>

        {step.name === 'backup' && (
          <div className="migrate-body">
            <p>เก็บไฟล์ไว้เป็นสำเนาของข้อมูลเดิม (ไม่ต้องเปิดอ่านก็ได้) ต้องดาวน์โหลดก่อนจึงไปต่อได้</p>
            <div className="actions">
              <button className="btn btn-primary" type="button" onClick={() => void doBackup()} disabled={busy}>
                {backedUp ? 'ดาวน์โหลดอีกครั้ง' : 'ดาวน์โหลดไฟล์สำรอง'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => void doRead()} disabled={!backedUp} aria-describedby={backedUp ? undefined : 'next-reason'}>
                ถัดไป: ตรวจข้อมูล
              </button>
            </div>
            {!backedUp && (
              <p id="next-reason" className="muted small">
                ดาวน์โหลดไฟล์สำรองก่อน ปุ่ม "ถัดไป" จึงจะกดได้
              </p>
            )}
            <div role="status" className="auth-ok">
              {backupNote}
            </div>
          </div>
        )}

        {(step.name === 'reading' || step.name === 'importing') && (
          <>
          <p role="status" className="muted">
            {step.name === 'importing'
              ? 'กำลังนำเข้าและตรวจยอด... อย่าปิดหน้านี้'
              : 'กำลังอ่านและตรวจข้อมูล...'}
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
              ยังย้ายข้อมูลไม่ได้ เพราะพบข้อมูลที่ไม่ถูกต้อง ข้อมูลเดิมไม่ถูกแตะต้อง เก็บไฟล์สำรองที่ดาวน์โหลดไว้และถ่ายภาพหน้าจอนี้ไว้
            </p>
            <ul className="migrate-list">
              {step.read.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {step.name === 'review' && step.read.ok && (
          <ReviewBody
            read={step.read}
            onImport={() => {
              const read = step.read as Extract<LocalRead, { ok: true }>;
              void guard(read.data.investments?.categories?.length ?? 0, (options) => void doImport(read, options));
            }}
            checking={checking}
            onBack={() => {
              if (!checking) setStep({ name: 'backup' });
            }}
          />
        )}
        {dialog}

        {step.name === 'result' && (
          <div className="migrate-body">
            {step.counts ? (
              <p>
                นำเข้าแล้ว: {step.counts.accounts} บัญชี · {step.counts.entries} รายการ · {step.counts.bills} บิล
              </p>
            ) : (
              <p>เทียบข้อมูลเดิมในเครื่องกับที่อยู่ออนไลน์อีกครั้ง</p>
            )}
            <BalanceTable report={step.report} />
            {step.report.ok ? (
              <>
                <p className="auth-ok">✓ ตรงกันทุกอย่าง: จำนวนบัญชี รายการ บิล ยอดต่อบัญชี เนื้อหารายการ และค่าตั้งค่า</p>
                <label className="migrate-check">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>ฉันตรวจยอดแล้ว ตรงกับที่ฉันเคยเห็น</span>
                </label>
                <div className="actions">
                  <button className="btn btn-primary" type="button" disabled={!ack} onClick={confirm} aria-describedby={ack ? undefined : 'confirm-reason'}>
                    ใช้งานบัญชีออนไลน์ต่อ
                  </button>
                </div>
                {!ack && (
                  <p id="confirm-reason" className="muted small">
                    ติ๊กช่อง "ฉันตรวจยอดแล้ว" ด้านบนก่อน ปุ่มนี้จึงจะกดได้
                  </p>
                )}
                <p className="muted small">ข้อมูลเดิมในเบราว์เซอร์นี้ยังอยู่ ไม่ถูกลบ</p>
              </>
            ) : (
              <>
                <p role="alert" className="form-error">
                  ⚠ ยอดไม่ตรงกัน จึงยังไม่ให้ใช้งานต่อ ข้อมูลเดิมในเครื่องไม่ถูกแตะต้อง ถ่ายภาพหน้าจอนี้และเก็บไฟล์สำรองไว้
                </p>
                <ul className="migrate-list">
                  {step.report.problems.slice(0, 20).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                <p className="slip-warn">
                  ปุ่มด้านล่างจะล้างข้อมูลออนไลน์ของบัญชีนี้ <strong>ทั้งหมด</strong> ตอนนี้มี {step.report.counts.accounts[1]} บัญชี · {step.report.counts.entries[1]} รายการ · {step.report.counts.bills[1]} บิล
                  {step.counts === null ? ' (พบจากการเปิดหน้านี้ใหม่ ตรวจให้แน่ใจว่าไม่ใช่ข้อมูลที่เพิ่งบันทึกจากเครื่องอื่นก่อนกดล้าง)' : ''}
                </p>
                <div className="actions">
                  <button className="btn btn-danger" type="button" onClick={() => void wipeOnline()}>
                    ล้างข้อมูลออนไลน์เพื่อนำเข้าใหม่
                  </button>
                </div>
                <p className="muted small">ปุ่มนี้ล้างเฉพาะข้อมูลที่นำเข้าขึ้นออนไลน์ (ต้องยืนยันด้วยรหัสผ่าน) ข้อมูลเดิมในเครื่องไม่ถูกลบ ถ้าเกิดซ้ำให้หยุดและเก็บภาพหน้าจอไว้</p>
                <div role="status" className="auth-error">
                  {wipeNote}
                </div>
              </>
            )}
          </div>
        )}

        {step.name === 'error' && (
          <div className="migrate-body">
            <p role="alert" className="form-error">
              ⚠ {step.message}
            </p>
            <p className="muted">ข้อมูลเดิมในเครื่องไม่ถูกแตะต้อง โหลดหน้าใหม่แล้วระบบจะตรวจสถานะและเทียบยอดต่อให้</p>
            <div className="actions">
              <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
                โหลดหน้าใหม่
              </button>
            </div>
          </div>
        )}

        <hr className="auth-sep" />
        <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>
          ออกจากระบบ
        </button>
      </section>
    </main>
  );
}

function ReviewBody({ read, checking, onImport, onBack }: { read: Extract<LocalRead, { ok: true }>; checking: boolean; onImport: () => void; onBack: () => void }) {
  return (
    <div className="migrate-body">
      <p>
        พบ {read.summary.accounts} บัญชี · {read.summary.entries} รายการ · {read.summary.bills} บิล{read.summary.assets !== undefined ? ` · ${read.summary.assets} สินทรัพย์ลงทุน · ${read.summary.trades ?? 0} รายการลงทุน` : ''} ผ่านการตรวจทุกข้อ (ยอดเป็นสตางค์จำนวนเต็ม ทุกรายการสมดุล) ยอดต่อบัญชีจะแสดงเทียบกับออนไลน์ในขั้นตรวจยอด
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
          นำเข้าขึ้นบัญชีออนไลน์
        </button>
        <button className="btn btn-ghost" type="button" onClick={onBack} aria-disabled={checking || undefined}>
          ย้อนกลับ
        </button>
      </div>
      <p role="status" className="muted">{checking ? 'กำลังตรวจหมวดเดิม...' : ''}</p>
    </div>
  );
}
