import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { buildRetirementInput, emptyRetirementForm, RETIREMENT_DISCLAIMER, RETIREMENT_LIMITATIONS, RETIREMENT_ON_TRACK_NOTE, RETIREMENT_REAL_RETURN_WARNING, RETIREMENT_ROUNDING_NOTE, type RetirementForm, type RetirementFormError, type RetirementFormField, type RetirementFormResult } from '../app/retirementForm';
import { friendlyError } from '../app/errorText';
import { initialRetirementSelection, retirementAssetOptions, summarizeRetirementPortfolio, RETIREMENT_STALE_PRICE_DAYS, type RetirementPortfolioSummary } from '../app/retirementPortfolio';
import type { DcaPlan } from '../domain/invest/dcaPlan';
import { MAX_RETIREMENT_ASSETS } from '../domain/invest/retirementSelection';
import type { InvestmentData } from '../domain/invest/types';
import { formatBaht, satang } from '../domain/money/satang';
import { dcaVersusSaving, progressBarPercent, progressBps } from '../domain/retirement/progress';
import { useRepository } from './RepositoryContext';
import { formatHundredBaht, formatHundredBahtNonZero } from '../domain/retirement/display';

const baht = (n: number): string => formatBaht(satang(n));
/** bps → ข้อความ % ด้วยจำนวนเต็ม (355 → "3.55%") */
const bpsText = (bps: number): string => {
  const whole = (bps - (bps % 100)) / 100;
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0')}%`;
};

interface FieldProps {
  id: string;
  field: RetirementFormField;
  label: string;
  hint?: string;
  placeholder?: string;
  unit?: string;
  value: string;
  errors: RetirementFormError[];
  disabled?: boolean;
  onChange: (v: string) => void;
}

function Field({ id, field, label, hint, placeholder, unit, value, errors, disabled, onChange }: FieldProps) {
  const error = errors.find((e) => e.field === field);
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {unit ? ` (${unit})` : ''}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="muted small">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="avg-err">
          {error.message}
        </p>
      )}
    </div>
  );
}

const FIELD_ID: Record<RetirementFormField, string> = {
  currentAge: 'rt-age',
  retireAge: 'rt-retire',
  lifeExpectancy: 'rt-life',
  monthlyExpense: 'rt-expense',
  inflation: 'rt-infl',
  returnBefore: 'rt-rb',
  returnAfter: 'rt-ra',
  currentSavings: 'rt-savings',
};

/**
 * เครื่องคิดเลขเป้าเกษียณ (เฟส 1) · ตัวเลขเป็น "ประมาณการ" ไม่ใช่ยอดในสมุดบัญชี ไม่บันทึกอะไร ไม่แตะฐานข้อมูล
 * คำนวณด้วย domain/retirement เท่านั้น (ห้ามมีสูตรเงินในคอมโพเนนต์)
 */
export function RetirementView({ today }: { today: string }) {
  const repo = useRepository();
  const [form, setForm] = useState<RetirementForm>(emptyRetirementForm());
  const [submitted, setSubmitted] = useState<RetirementFormResult | null>(null);
  // ผูกพอร์ต (เฟส 2): ข้อมูลอ่านอย่างเดียว · ผู้ใช้เลือกเองว่านับสินทรัพย์ไหน (ค่าเริ่มต้นไม่เลือก ไม่บันทึกที่ไหน)
  const [invest, setInvest] = useState<InvestmentData | null>(null);
  const [dcaPlans, setDcaPlans] = useState<DcaPlan[]>([]);
  const [investError, setInvestError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set<string>());
  const [linked, setLinked] = useState<RetirementPortfolioSummary | null>(null);
  const [portfolioBlock, setPortfolioBlock] = useState('');
  const [saveError, setSaveError] = useState('');
  const [restoredCount, setRestoredCount] = useState(0);
  // บันทึกการเลือกทีละคิว (กดติ๊กรัวๆ แล้วค่าสุดท้ายต้องเป็นค่าที่เขียนทีหลังสุด)
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const resultRef = useRef<HTMLHeadingElement>(null);
  const set = (patch: Partial<RetirementForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    let cancelled = false;
    Promise.all([repo.loadInvestments(), repo.loadSettings()])
      .then(([d, settings]) => {
        if (cancelled) return;
        setInvest(d);
        setDcaPlans(settings.dcaPlans ?? []);
        // การเลือกที่เคยบันทึกไว้ (เฟส 2b): รหัสของสินทรัพย์ที่ถูกลบไปแล้วถูกข้ามเงียบๆ
        try {
          const restored = initialRetirementSelection(settings.retirementAssetIds, retirementAssetOptions(d, today));
          setSelected(restored);
          setRestoredCount(restored.size);
        } catch {
          setSelected(new Set<string>());
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setInvestError(friendlyError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo, today]);

  const options = useMemo(() => {
    if (invest === null) return [];
    try {
      return retirementAssetOptions(invest, today);
    } catch {
      return [];
    }
  }, [invest, today]);
  // สรุปตามที่เลือก (ใน try/catch: ข้อมูลพอร์ตพังไม่ทำให้เครื่องคิดเลขล้ม)
  const summary = useMemo((): { value: RetirementPortfolioSummary | null; failure: string } => {
    if (invest === null || selected.size === 0) return { value: null, failure: '' };
    try {
      return { value: summarizeRetirementPortfolio(invest, today, selected, dcaPlans), failure: '' };
    } catch (e) {
      return { value: null, failure: friendlyError(e) };
    }
  }, [invest, today, selected, dcaPlans]);

  // จำเฉพาะรายชื่อที่เลือก (ข้อมูลเข้า ไม่ใช่ยอด) ใน settings · อ่านค่าตั้งค่าล่าสุดก่อนเขียนเพื่อไม่ทับค่าอื่น
  const persistSelection = (change: (current: string[]) => string[]) => {
    saveChain.current = saveChain.current.then(async () => {
      try {
        // เปลี่ยนจากรายชื่อล่าสุดเสมอ (เติม/เอาออกทีละรหัส) แล้วเขียนแบบ compare-and-set: แท็บอื่นเลือกสินทรัพย์อื่นพร้อมกันก็ไม่ทับกัน
        // เปลี่ยนเฉพาะรายชื่อสินทรัพย์เกษียณ (ค่าตั้งค่าอื่นไม่ถูกแตะ) · รายชื่อว่าง = ลบคีย์
        await repo.updateSettings(['retirementAssetIds'], (current) => {
          const list = change(current.retirementAssetIds ?? []);
          return { retirementAssetIds: list.length > 0 ? list : null };
        });
        setSaveError('');
      } catch (e) {
        setSaveError(friendlyError(e));
      }
    });
  };

  const toggleAsset = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setPortfolioBlock('');
    persistSelection((current) => (next.has(id) ? (current.includes(id) ? current : current.concat(id)) : current.filter((x) => x !== id)));
  };

  const errors = useMemo(() => (submitted && !submitted.ok ? submitted.errors : []), [submitted]);
  const result = submitted && submitted.ok ? submitted : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // เลือกพอร์ตแล้วแต่คำนวณมูลค่าไม่ได้ หรือที่เลือกไม่มีราคาเลย = ไม่คำนวณ (กันเงินออมกลายเป็น 0 หรือตกไปใช้ช่องกรอกเองโดยผู้ใช้ไม่รู้)
    const block = selected.size > 0 && summary.failure !== '' ? 'คำนวณมูลค่าพอร์ตที่เลือกไม่สำเร็จ ลองยกเลิกการเลือกหรือใช้ช่องกรอกเอง' : summary.value !== null && summary.value.unpricedCount === summary.value.selectedCount ? 'สินทรัพย์ที่เลือกยังไม่มีราคาเลย กรอกราคาที่หน้าพอร์ตก่อน หรือยกเลิกการเลือกแล้วกรอกเงินที่เก็บไว้เอง' : '';
    setPortfolioBlock(block);
    if (block !== '') {
      setSubmitted(null);
      setLinked(null);
      return;
    }
    const useLinked = summary.value !== null && selected.size > 0;
    const r = buildRetirementInput(form, useLinked ? summary.value!.valueSatang : undefined);
    setSubmitted(
      r.ok || !useLinked ? r : { ok: false, errors: r.errors.map((x) => (x.field === 'currentSavings' ? { ...x, message: 'มูลค่าพอร์ตที่เลือกเกินเพดาน 1,000 ล้านบาท ลดจำนวนสินทรัพย์ที่เลือก' } : x)) },
    );
    setLinked(useLinked && r.ok ? summary.value : null);
    if (r.ok) {
      window.requestAnimationFrame(() => resultRef.current?.focus());
    } else {
      const first = r.errors.find((x) => x.field !== 'general')?.field as RetirementFormField | undefined;
      if (first) document.getElementById(FIELD_ID[first])?.focus();
      else document.getElementById('rt-general-err')?.focus();
    }
  };

  const reset = () => {
    setForm(emptyRetirementForm());
    setSubmitted(null);
    setLinked(null);
    setPortfolioBlock('');
    setSelected(new Set<string>());
    setRestoredCount(0);
    persistSelection(() => []);
  };

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">วางแผนเกษียณ</h2>
        <p className="muted">ประมาณว่าต้องมีเงินเท่าไรตอนเกษียณ และต้องเก็บเดือนละเท่าไร</p>
      </div>

      <div className="notice" role="note">
        <p>
          <strong>เครื่องมือนี้ให้ตัวเลขประมาณการ</strong> {RETIREMENT_DISCLAIMER}
        </p>
        <p>ตัวเลขที่นี่ไม่ถูกบันทึกลงสมุดบัญชี และไม่เกี่ยวกับยอดเงินในกระเป๋าของคุณ</p>
      </div>

      <section className="solid card" aria-labelledby="rt-form-title">
        <h2 id="rt-form-title">สมมติฐานของคุณ</h2>
        <form onSubmit={onSubmit} noValidate className="settings-form">
          <div className="field-row field-row-compact">
            <Field id="rt-age" field="currentAge" label="อายุตอนนี้" unit="ปี" placeholder="เช่น 35" value={form.currentAge} errors={errors} onChange={(v) => set({ currentAge: v })} />
            <Field id="rt-retire" field="retireAge" label="อายุที่จะเกษียณ" unit="ปี" placeholder="เช่น 60" value={form.retireAge} errors={errors} onChange={(v) => set({ retireAge: v })} />
            <Field id="rt-life" field="lifeExpectancy" label="อายุที่คาดว่าจะอยู่ถึง" unit="ปี" placeholder="เช่น 85" hint="ตั้งไว้สูงหน่อยเพื่อความปลอดภัย ยิ่งอยู่นานยิ่งต้องมีเงินมาก" value={form.lifeExpectancy} errors={errors} onChange={(v) => set({ lifeExpectancy: v })} />
          </div>
          <div className="field-row">
            <Field id="rt-expense" field="monthlyExpense" label="ค่าใช้จ่ายต่อเดือนตอนเกษียณ" unit="บาท" placeholder="เช่น 30,000" hint="คิดเป็นราคาวันนี้ ระบบปรับตามเงินเฟ้อให้เอง" value={form.monthlyExpense} errors={errors} onChange={(v) => set({ monthlyExpense: v })} />
            <Field id="rt-infl" field="inflation" label="เงินเฟ้อ" unit="% ต่อปี" placeholder="เช่น 3" hint="ของแพงขึ้นปีละกี่ % ที่ผ่านมาราว 2-3 ใส่ได้ 0-10" value={form.inflation} errors={errors} onChange={(v) => set({ inflation: v })} />
          </div>
          <div className="field-row">
            <Field id="rt-rb" field="returnBefore" label="ผลตอบแทนที่คาดก่อนเกษียณ" unit="% ต่อปี" placeholder="เช่น 5" hint="กำไรจากเงินที่เก็บ/ลงทุนต่อปี (-5 ถึง 15) ใส่ค่าติดลบได้ ไม่แน่ใจให้ตั้งต่ำไว้ก่อน" value={form.returnBefore} errors={errors} onChange={(v) => set({ returnBefore: v })} />
            <Field id="rt-ra" field="returnAfter" label="ผลตอบแทนที่คาดหลังเกษียณ" unit="% ต่อปี" placeholder="เช่น 3" hint="กำไรจากเงินก้อนที่เหลือตอนใช้เงิน (-5 ถึง 15) มักตั้งต่ำกว่าช่วงเก็บ" value={form.returnAfter} errors={errors} onChange={(v) => set({ returnAfter: v })} />
          </div>
          {options.length > 0 && (
            <fieldset className="pf-fieldset">
              <legend>นับพอร์ตลงทุนเป็นเงินเกษียณ (ไม่บังคับ)</legend>
              <p className="muted small">
                เลือกเองว่าสินทรัพย์ไหนนับเป็นเงินเกษียณ ใช้มูลค่าตามราคาที่คุณกรอกไว้ ไม่ใช่ราคาทุน ระบบจะจำรายชื่อที่เลือกไว้ให้ในบัญชีนี้ (ไม่เก็บยอดเงินหรือผลคำนวณ) เลือกได้ไม่เกิน {MAX_RETIREMENT_ASSETS} รายการ
              </p>
              <ul className="plain-list">
                {options.map((o) => (
                  <li key={o.assetId}>
                    <label>
                      <input type="checkbox" checked={selected.has(o.assetId)} disabled={!selected.has(o.assetId) && selected.size >= MAX_RETIREMENT_ASSETS} onChange={() => toggleAsset(o.assetId)} />
                      <span>
                        {o.name}
                        {o.archived ? ' (เก็บถาวร)' : ''}
                        <span className="muted small">
                          {' '}
                          {o.error !== undefined ? '· ข้อมูลรายการนี้ผิดปกติ จึงไม่นับ' : o.valueSatang === null ? '· ยังไม่มีราคา' : `· ${baht(o.valueSatang)} (ราคาวันที่ ${o.priceDate ?? ''})`}
                          {o.priceStale ? ` · ราคาเก่ากว่า ${RETIREMENT_STALE_PRICE_DAYS} วัน ควรอัปเดตที่หน้าพอร์ต` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {restoredCount > 0 && (
                <p className="muted small">เลือกไว้จากครั้งก่อน {restoredCount} รายการ ติ๊กออกได้</p>
              )}
              {saveError !== '' && (
                <p className="muted small" role="status">
                  จำการเลือกไม่สำเร็จ ครั้งหน้าอาจต้องเลือกใหม่ ใช้งานต่อได้ตามปกติ ({saveError})
                </p>
              )}
              {portfolioBlock !== '' && (
                <p className="avg-err" role="alert">
                  {portfolioBlock}
                </p>
              )}
              {summary.failure !== '' && (
                <p className="avg-err" role="alert">
                  คำนวณมูลค่าพอร์ตไม่สำเร็จ: {summary.failure}
                </p>
              )}
              {summary.value && (
                <>
                  <p className="small">
                    เงินที่เก็บไว้แล้ว: <strong className="num">{baht(summary.value.valueSatang)}</strong> (จากพอร์ต ณ วันที่ราคาเก่าสุด {summary.value.oldestPriceDate ?? '-'})
                  </p>
                  {summary.value.unpricedCount > 0 && (
                    <p className="notice" role="status">
                      <strong>ข้อควรระวัง:</strong> มูลค่ารวมไม่ครบ มี {summary.value.unpricedCount} รายการที่ยังไม่มีราคา จึงยังไม่ถูกรวม ผลอาจต่ำกว่าจริง กรอกราคาที่หน้าพอร์ตก่อน
                    </p>
                  )}
                  {summary.value.staleCount > 0 && (
                    <p className="notice" role="status">
                      <strong>ข้อควรระวัง:</strong> {summary.value.staleCount} รายการที่เลือกมีราคาเก่ากว่า {RETIREMENT_STALE_PRICE_DAYS} วัน
                    </p>
                  )}
                </>
              )}
            </fieldset>
          )}
          {investError !== '' && <p className="muted small">โหลดข้อมูลพอร์ตไม่สำเร็จ ใช้ช่องกรอกเองได้ตามปกติ</p>}
          <Field
            id="rt-savings"
            field="currentSavings"
            label="เงินที่เก็บไว้สำหรับเกษียณแล้ว (ถ้ามี)"
            unit="บาท"
            placeholder="ไม่บังคับ"
            hint={summary.value ? 'ใช้มูลค่าจากพอร์ตที่เลือกแทนช่องนี้ (ไม่บวกซ้ำ) · ยกเลิกการเลือกพอร์ตถ้าจะกรอกเอง' : 'ใส่เพื่อดูว่าที่เก็บไว้พอแค่ไหน ปล่อยว่าง = เริ่มจาก 0'}
            value={form.currentSavings}
            errors={errors}
            disabled={summary.value !== null}
            onChange={(v) => set({ currentSavings: v })}
          />
          {errors.some((x) => x.field === 'general') && (
            <p id="rt-general-err" className="avg-err" role="alert" tabIndex={-1}>
              {errors.find((x) => x.field === 'general')?.message} ลองลดค่าใช้จ่าย ผลตอบแทน หรือเงินที่เก็บไว้แล้ว
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-small btn-grow">
              คำนวณ
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={reset}>
              ล้างค่า
            </button>
          </div>
          <p className="muted small">ล้างค่าจะล้างรายชื่อสินทรัพย์ที่จำไว้ด้วย</p>
        </form>
      </section>

      {result && (
        <section className="glass-lite card" aria-labelledby="rt-result-title">
          <h2 id="rt-result-title" ref={resultRef} tabIndex={-1}>
            ผลประมาณการ
          </h2>
          <div className="notice" role="note">
            <p>
              <strong>ตัวเลขประมาณการ ไม่ใช่ยอดจริง</strong>
            </p>
            <p>{RETIREMENT_DISCLAIMER}</p>
            <p>{RETIREMENT_ROUNDING_NOTE}</p>
          </div>
          {result.result.realReturnNegativeAfter && (
            <div className="notice" role="note">
              <p>
                <strong>ข้อควรระวัง:</strong> {RETIREMENT_REAL_RETURN_WARNING}
              </p>
            </div>
          )}
          <p className="muted small">
            สมมติฐานที่ใช้: อายุตอนนี้ {result.input.currentAge} ปี · เกษียณที่ {result.input.retireAge} ปี · อยู่ถึง {result.input.lifeExpectancy} ปี · ค่าใช้จ่าย {baht(result.input.monthlyExpense)} ต่อเดือน (ราคาวันนี้) ·
            เงินเฟ้อ {bpsText(result.input.inflationBps)} · ผลตอบแทนก่อนเกษียณ {bpsText(result.input.returnBeforeBps)} · หลังเกษียณ {bpsText(result.input.returnAfterBps)} ต่อปี
            {result.input.currentSavings !== undefined && result.input.currentSavings > 0 ? ` · เงินที่เก็บไว้แล้ว ${baht(result.input.currentSavings)} (${linked ? `จากพอร์ต ณ วันที่ราคาเก่าสุด ${linked.oldestPriceDate ?? '-'}` : 'กรอกเอง'})` : ''}
          </p>
          <dl className="avg-result">
            <div>
              <dt>ต้องเก็บเดือนละ (ประมาณการ)</dt>
              <dd className={result.result.monthlySaving === 0 ? 'avg-new small' : 'avg-new num'}>{result.result.monthlySaving === 0 ? RETIREMENT_ON_TRACK_NOTE : formatHundredBaht(result.result.monthlySaving, 'up')}</dd>
            </div>
            <div>
              <dt>เงินที่ควรมี ณ วันเกษียณ (ประมาณการ)</dt>
              <dd className="num">{formatHundredBaht(result.result.requiredAtRetirement, 'nearest')}</dd>
            </div>
            <div>
              <dt>เทียบเป็นเงินวันนี้ ถ้าของไม่แพงขึ้น (ประมาณการ)</dt>
              <dd className="num">{formatHundredBaht(result.result.requiredInTodayMoney, 'nearest')}</dd>
            </div>
            <div>
              <dt>ค่าใช้จ่ายต่อเดือน ณ วันเกษียณ (ประมาณการ)</dt>
              <dd className="num">{formatHundredBaht(result.result.monthlyExpenseAtRetirement, 'nearest')}</dd>
            </div>
            {result.input.currentSavings !== undefined && result.input.currentSavings > 0 && (
              <>
                <div>
                  <dt>เงินที่เก็บไว้แล้วจะโตเป็น (ประมาณการ)</dt>
                  <dd className="num">{formatHundredBaht(result.result.currentSavingsAtRetirement, 'nearest')}</dd>
                </div>
                <div>
                  <dt>ส่วนที่ยังขาด (ประมาณการ)</dt>
                  <dd className="num">{formatHundredBahtNonZero(result.result.shortfall)}</dd>
                </div>
              </>
            )}
          </dl>
          {linked && <PortfolioProgress linked={linked} required={result.result.requiredAtRetirement} saving={result.result.monthlySaving} />}
          <p className="muted small">
            อีก {result.result.yearsToRetire} ปีถึงเกษียณ แล้วใช้เงินต่ออีก {result.result.retirementYears} ปี
          </p>
          <p className="muted small">{RETIREMENT_LIMITATIONS}</p>
          <details>
            <summary>วิธีคิดแบบสั้น</summary>
            <ol className="muted small">
              <li>ค่าใช้จ่ายวันนี้ x (1 + เงินเฟ้อ) ยกกำลังจำนวนปีถึงเกษียณ = ค่าใช้จ่ายต่อเดือนตอนเกษียณ</li>
              <li>เงินที่ควรมี = เงินที่จะใช้ทุกเดือนรวมกันจนถึงอายุที่คาดว่าจะอยู่ (ปรับตามเงินเฟ้อปีละครั้ง) โดยนับว่าเงินก้อนที่เหลือยังงอกเงยตามผลตอบแทนหลังเกษียณ</li>
              <li>ต้องเก็บต่อเดือน = ส่วนที่ยังขาด (หลังหักเงินที่เก็บไว้แล้ว ซึ่งงอกเงยตามผลตอบแทนก่อนเกษียณ) แบ่งเก็บเท่าๆ กันทุกเดือน ดอกเบี้ยคิดต่อเนื่องรายเดือน (อัตราต่อปี หาร 12)</li>
            </ol>
          </details>
        </section>
      )}
    </>
  );
}

/** ความคืบหน้าและเทียบแผน DCA (เฟส 2): แสดงผลอย่างเดียว ไม่ป้อนกลับสูตร ไม่บันทึก */
function PortfolioProgress({ linked, required, saving }: { linked: RetirementPortfolioSummary; required: number; saving: number }) {
  const bps = progressBps(linked.valueSatang, required);
  const dca = linked.dcaPlanCount > 0 ? dcaVersusSaving(linked.dcaMonthly, saving) : null;
  const barPercent = bps === null ? 0 : progressBarPercent(bps);
  return (
    <div className="progress-box" role="note">
      {bps !== null && (
        <>
          <p>
            <strong>ความคืบหน้า (ประมาณการ):</strong> {bpsText(bps)} ของเงินที่ควรมี{bps >= 10_000 ? ' · ถึงเป้าแล้วตามสมมติฐาน' : ''}
          </p>
          <div role="progressbar" aria-label="ความคืบหน้าสู่เป้า (ประมาณการ)" aria-valuemin={0} aria-valuemax={100} aria-valuenow={barPercent} aria-valuetext={`${bpsText(bps)} ของเงินที่ควรมี`} className="meter">
            <div className="meter-fill" style={{ width: `${barPercent}%` }} />
          </div>
          <p className="muted small">คิดจากมูลค่าพอร์ตที่เลือกตามราคาที่คุณกรอก เทียบกับเงินที่ควรมี ณ วันเกษียณ (ยังไม่รวมการเติบโตระหว่างทาง) แสดงผลอย่างเดียว ไม่ได้นำไปคำนวณเงินที่ต้องเก็บ</p>
        </>
      )}
      {dca && (
        <>
          <p>
            <strong>แผนลงทุนสม่ำเสมอ (DCA) ต่อเดือนของสินทรัพย์ที่เลือก (ประมาณการ):</strong> <span className="num">{formatHundredBaht(dca.dcaMonthly, 'nearest')}</span> จาก {linked.dcaPlanCount} แผน เทียบกับที่ต้องเก็บ{' '}
            <span className="num">{formatHundredBaht(dca.savingNeeded, 'up')}</span>
            {dca.covered ? ' · แผนที่ตั้งไว้ถึงยอดนี้' : ` · ยังขาดอีกราว ${formatHundredBaht(dca.shortBy, 'up')} ต่อเดือน`}
          </p>
          <p className="muted small">แผนที่ตั้งไว้ ไม่ใช่เงินที่ผูกพันว่าจะทำตามจริง · ไม่นับเป็นเงินออม จนกว่าคุณจะซื้อจริงที่หน้าพอร์ต</p>
        </>
      )}
    </div>
  );
}
