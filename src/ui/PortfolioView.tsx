import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { thaiDayLabel } from '../app/dates';
import { newId } from '../app/ids';
import { buildPortfolio, type AssetRowView } from '../app/portfolio';
import { buildTradeRecord, emptyTradeForm, type TradeField, type TradeForm, type TradeFormError } from '../app/tradeForm';
import { emptyInvestments, type AssetKind, type InvestmentData, type TradeKind, type TradeRecord } from '../domain/invest/types';
import { formatUnits, parsePriceMicro } from '../domain/invest/units';
import { isSupportedEntryDate } from '../domain/ledger/limits';
import { formatMicro } from '../domain/money/micro';
import { formatBaht, satang } from '../domain/money/satang';
import { StorageError, nextCreatedAt } from '../storage/repository';
import { friendlyError } from '../app/errorText';
import { useRepository } from './RepositoryContext';

interface Props {
  today: string;
  /** แจ้งเมื่อสร้างสินทรัพย์ (เพิ่มบัญชีลงทุนในสมุด) ให้แอปโหลดสมุดใหม่ */
  onLedgerChanged: () => void;
}

const KIND_LABEL: Record<TradeKind, string> = { buy: 'ซื้อ', sell: 'ขาย', dividend: 'ปันผลเป็นเงินสด', reinvest: 'ปันผลลงทุนต่อ' };
const ASSET_KIND_LABEL: Record<AssetKind, string> = { fund: 'กองทุน', stock: 'หุ้น', other: 'อื่นๆ' };
const baht = (n: number): string => formatBaht(satang(n));
const signed = (n: number): string => (n > 0 ? `+${baht(n)}` : baht(n));

type Panel = { type: 'trade'; assetId: string } | { type: 'price'; assetId: string } | null;

function FieldInput(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  errors: TradeFormError[];
  field?: TradeField;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  const { id, label, value, onChange, errors, field, placeholder, hint, type } = props;
  const error = field ? errors.find((e) => e.field === field) : undefined;
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type ?? 'text'}
        inputMode={type === 'date' ? undefined : 'decimal'}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
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

/** หน้า "พอร์ตการลงทุน" (P3): สินทรัพย์ รายการซื้อขายปันผล ราคาที่กรอกเอง · ยังไม่ผูกสมุดบัญชีคู่ (P4) */
export function PortfolioView({ today, onLedgerChanged }: Props) {
  const repo = useRepository();
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [assetName, setAssetName] = useState('');
  const [assetKind, setAssetKind] = useState<AssetKind>('fund');
  const [tradeForm, setTradeForm] = useState<TradeForm>(emptyTradeForm('', 'buy', today));
  const [tradeErrors, setTradeErrors] = useState<TradeFormError[]>([]);
  const [priceForm, setPriceForm] = useState({ date: today, price: '' });
  const [priceError, setPriceError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await repo.loadInvestments());
      setLoadError('');
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  const portfolio = useMemo(() => buildPortfolio(data ?? emptyInvestments(), today), [data, today]);

  const act = async (work: () => Promise<void>, okText: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      await load();
      setMessage({ text: okText, kind: 'ok' });
      return true;
    } catch (e) {
      setMessage({ text: e instanceof StorageError ? e.message : friendlyError(e), kind: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addAsset = async (e: FormEvent) => {
    e.preventDefault();
    const name = assetName.trim();
    if (name === '') {
      setMessage({ text: 'กรอกชื่อกองทุน/หุ้น', kind: 'error' });
      return;
    }
    const ok = await act(async () => {
      await repo.addAsset({ id: newId('asset'), name, kind: assetKind });
      onLedgerChanged();
    }, `เพิ่ม "${name}" แล้ว`);
    if (ok) setAssetName('');
  };

  const openTrade = (assetId: string, kind: TradeKind = 'buy') => {
    setTradeForm(emptyTradeForm(assetId, kind, today));
    setTradeErrors([]);
    setPanel({ type: 'trade', assetId });
    setMessage(null);
  };
  const setTrade = (patch: Partial<TradeForm>) => setTradeForm((f) => ({ ...f, ...patch }));

  const submitTrade = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildTradeRecord(tradeForm, newId('trade'), nextCreatedAt(), today);
    if (!built.ok) {
      setTradeErrors(built.errors);
      return;
    }
    setTradeErrors([]);
    const ok = await act(async () => {
      await repo.addTrade(built.trade);
    }, `บันทึก${KIND_LABEL[built.trade.kind]}แล้ว (ยังไม่หักจากกระเป๋าเงิน)`);
    if (ok) setPanel(null);
  };

  const submitPrice = async (e: FormEvent) => {
    e.preventDefault();
    if (panel?.type !== 'price') return;
    let priceMicro: number;
    try {
      if (!isSupportedEntryDate(priceForm.date)) throw new Error('วันที่ไม่ถูกต้อง');
      if (priceForm.date > today) throw new Error('บันทึกราคาของวันในอนาคตไม่ได้');
      priceMicro = parsePriceMicro(priceForm.price);
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : 'ข้อมูลไม่ถูกต้อง');
      return;
    }
    setPriceError('');
    const assetId = panel.assetId;
    const ok = await act(async () => {
      await repo.savePrice({ assetId, date: priceForm.date, priceMicro });
    }, 'บันทึกราคาแล้ว');
    if (ok) setPanel(null);
  };

  const removeTrade = async (t: TradeRecord) => {
    if (confirmDelete !== t.id) {
      setConfirmDelete(t.id);
      return;
    }
    setConfirmDelete('');
    await act(() => repo.deleteTrade(t.id), 'ลบรายการแล้ว');
  };

  const t = portfolio.totals;
  const hasAssets = portfolio.rows.length > 0;
  const tradePanelAsset = panel?.type === 'trade' ? portfolio.rows.find((r) => r.asset.id === panel.assetId)?.asset : undefined;
  const pricePanelAsset = panel?.type === 'price' ? portfolio.rows.find((r) => r.asset.id === panel.assetId)?.asset : undefined;
  const k = tradeForm.kind;

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">พอร์ตการลงทุน</h2>
        <p className="muted">กองทุนและหุ้นของคุณ ต้นทุนเฉลี่ย และมูลค่าตามราคาที่คุณกรอกเอง</p>
      </div>

      <p className="notice" role="note">
        รุ่นนี้ยังไม่หักเงินจากกระเป๋า: การบันทึกซื้อ/ขายที่นี่ไม่เปลี่ยนยอดกระเป๋าเงินและรายรับรายจ่าย (จะผูกกับสมุดบัญชีในรุ่นถัดไป) ราคาเป็นตัวเลขที่คุณกรอกเอง ไม่ใช่ราคาตลาดสด
      </p>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'form-error' : 'muted'}>
          {message.text}
        </p>
      )}
      {loadError && (
        <p role="alert" className="form-error">
          โหลดข้อมูลพอร์ตไม่สำเร็จ: {loadError}
        </p>
      )}

      <section className="glass-lite card" aria-labelledby="pf-sum-title">
        <h2 id="pf-sum-title">สรุปพอร์ต</h2>
        {!hasAssets ? (
          <p className="muted">ยังไม่มีสินทรัพย์ เพิ่มกองทุนหรือหุ้นด้านล่างเพื่อเริ่มบันทึก</p>
        ) : (
          <dl className="avg-result">
            <div>
              <dt>ต้นทุนรวม (ที่ยังถืออยู่)</dt>
              <dd className="num">{baht(t.cost)}</dd>
            </div>
            <div>
              <dt>มูลค่าตามราคาที่กรอก</dt>
              <dd className="num">{t.value > 0 || t.unpriced === 0 ? baht(t.value) : '—'}</dd>
            </div>
            <div>
              <dt>กำไร/ขาดทุนที่ยังไม่ขาย</dt>
              <dd className="num">{t.value > 0 || t.unpriced === 0 ? signed(t.unrealized) : '—'}</dd>
            </div>
            <div>
              <dt>กำไร/ขาดทุนที่ขายแล้ว</dt>
              <dd className="num">{signed(t.realized)}</dd>
            </div>
            <div>
              <dt>ปันผลรวม (หลังหักภาษี)</dt>
              <dd className="num">{baht(t.dividends)}</dd>
            </div>
          </dl>
        )}
        {t.unpriced > 0 && (
          <p className="muted small" role="status">
            มี {t.unpriced} รายการที่ยังไม่ได้กรอกราคา มูลค่ารวมจึงยังไม่ครบ (ไม่ใช้ต้นทุนแทน)
          </p>
        )}
        <p className="muted small">กำไร/ขาดทุนจากต้นทุน ไม่ใช่ผลตอบแทนต่อปี · ต้นทุนเฉลี่ยรวมค่าธรรมเนียมซื้อ อาจต่างจากแอปโบรกเกอร์เล็กน้อยจากการปัดเศษ</p>
      </section>

      <section className="solid card" aria-labelledby="pf-add-title">
        <h2 id="pf-add-title">เพิ่มกองทุน/หุ้น</h2>
        <form onSubmit={addAsset} className="settings-form">
          <div className="field-row">
            <div className="field">
              <label htmlFor="pf-asset-name">ชื่อ</label>
              <input id="pf-asset-name" type="text" autoComplete="off" maxLength={200} value={assetName} onChange={(e) => setAssetName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pf-asset-kind">ชนิด</label>
              <select id="pf-asset-kind" value={assetKind} onChange={(e) => setAssetKind(e.target.value as AssetKind)}>
                {(Object.keys(ASSET_KIND_LABEL) as AssetKind[]).map((v) => (
                  <option key={v} value={v}>
                    {ASSET_KIND_LABEL[v]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
              เพิ่ม
            </button>
          </div>
        </form>
      </section>

      {tradePanelAsset && (
        <section className="solid card" aria-labelledby="pf-trade-title">
          <h2 id="pf-trade-title">บันทึกรายการ: {tradePanelAsset.name}</h2>
          <form onSubmit={submitTrade} className="settings-form" noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor="pf-kind">ชนิดรายการ</label>
                <select id="pf-kind" value={k} onChange={(e) => setTrade({ kind: e.target.value as TradeKind })}>
                  {(Object.keys(KIND_LABEL) as TradeKind[]).map((v) => (
                    <option key={v} value={v}>
                      {KIND_LABEL[v]}
                    </option>
                  ))}
                </select>
              </div>
              <FieldInput id="pf-date" label="วันที่" type="date" value={tradeForm.date} onChange={(v) => setTrade({ date: v })} errors={tradeErrors} field="date" />
            </div>
            <div className="field-row">
              {k === 'buy' && (
                <>
                  <FieldInput id="pf-amount" label="เงินที่ซื้อ (บาท)" value={tradeForm.amount} onChange={(v) => setTrade({ amount: v })} errors={tradeErrors} field="amount" placeholder="1,000.00" />
                  <FieldInput id="pf-price" label="ราคาต่อหน่วย (บาท)" value={tradeForm.price} onChange={(v) => setTrade({ price: v })} errors={tradeErrors} field="price" placeholder="12.3456" hint="กรอกราคา แล้วระบบคำนวณหน่วยให้ หรือกรอกหน่วยเองจากโบรกเกอร์" />
                  <FieldInput id="pf-units" label="จำนวนหน่วย (ถ้ามีจากโบรกเกอร์)" value={tradeForm.units} onChange={(v) => setTrade({ units: v })} errors={tradeErrors} field="units" placeholder="0" />
                  <FieldInput id="pf-fee" label="ค่าธรรมเนียม (บาท)" value={tradeForm.fee} onChange={(v) => setTrade({ fee: v })} errors={tradeErrors} field="fee" placeholder="0.00" hint="นับรวมในต้นทุน" />
                </>
              )}
              {k === 'sell' && (
                <>
                  <FieldInput id="pf-units" label="จำนวนหน่วยที่ขาย" value={tradeForm.units} onChange={(v) => setTrade({ units: v })} errors={tradeErrors} field="units" placeholder="0" />
                  <FieldInput id="pf-price" label="ราคาต่อหน่วย (บาท)" value={tradeForm.price} onChange={(v) => setTrade({ price: v })} errors={tradeErrors} field="price" placeholder="12.3456" />
                  <FieldInput id="pf-fee" label="ค่าธรรมเนียม (บาท)" value={tradeForm.fee} onChange={(v) => setTrade({ fee: v })} errors={tradeErrors} field="fee" placeholder="0.00" hint="หักจากเงินที่ได้" />
                </>
              )}
              {k === 'dividend' && (
                <>
                  <FieldInput id="pf-amount" label="ยอดปันผล (บาท)" value={tradeForm.amount} onChange={(v) => setTrade({ amount: v })} errors={tradeErrors} field="amount" placeholder="0.00" hint="ยอดก่อนหักภาษี" />
                  <FieldInput id="pf-wht" label="ภาษีหัก ณ ที่จ่าย (บาท)" value={tradeForm.withholding} onChange={(v) => setTrade({ withholding: v })} errors={tradeErrors} field="withholding" placeholder="0.00" />
                </>
              )}
              {k === 'reinvest' && (
                <>
                  <FieldInput id="pf-units" label="หน่วยที่ได้เพิ่ม" value={tradeForm.units} onChange={(v) => setTrade({ units: v })} errors={tradeErrors} field="units" placeholder="0" />
                  <FieldInput id="pf-amount" label="ต้นทุนที่เพิ่ม (บาท)" value={tradeForm.amount} onChange={(v) => setTrade({ amount: v })} errors={tradeErrors} field="amount" placeholder="0.00" hint="ยอดปันผลหลังหักภาษี" />
                </>
              )}
            </div>
            <div className="field">
              <label htmlFor="pf-memo">หมายเหตุ (ไม่บังคับ)</label>
              <input id="pf-memo" type="text" autoComplete="off" maxLength={2000} value={tradeForm.memo} onChange={(e) => setTrade({ memo: e.target.value })} />
              {tradeErrors.find((x) => x.field === 'memo') && <p className="avg-err">{tradeErrors.find((x) => x.field === 'memo')?.message}</p>}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPanel(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                บันทึก
              </button>
            </div>
          </form>
        </section>
      )}

      {pricePanelAsset && (
        <section className="solid card" aria-labelledby="pf-price-title">
          <h2 id="pf-price-title">กรอกราคาล่าสุด: {pricePanelAsset.name}</h2>
          <form onSubmit={submitPrice} className="settings-form" noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor="pf-pdate">วันที่ของราคา</label>
                <input id="pf-pdate" type="date" value={priceForm.date} onChange={(e) => setPriceForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="pf-pprice">ราคาต่อหน่วย (บาท)</label>
                <input
                  id="pf-pprice"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="12.3456"
                  value={priceForm.price}
                  aria-invalid={priceError ? true : undefined}
                  aria-describedby={priceError ? 'pf-pprice-err' : undefined}
                  onChange={(e) => setPriceForm((f) => ({ ...f, price: e.target.value }))}
                />
                {priceError && (
                  <p id="pf-pprice-err" className="avg-err">
                    {priceError}
                  </p>
                )}
              </div>
            </div>
            <p className="muted small">กรอกซ้ำวันเดิมจะแก้ราคาของวันนั้น</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPanel(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                บันทึกราคา
              </button>
            </div>
          </form>
        </section>
      )}

      {hasAssets && (
        <section className="solid card" aria-labelledby="pf-list-title">
          <h2 id="pf-list-title">สินทรัพย์</h2>
          <ul className="bill-list">
            {portfolio.rows.map((row) => (
              <AssetRow
                key={row.asset.id}
                row={row}
                trades={(data?.trades ?? []).filter((x) => x.assetId === row.asset.id)}
                confirmDelete={confirmDelete}
                busy={busy}
                onTrade={() => openTrade(row.asset.id)}
                onPrice={() => {
                  setPriceForm({ date: today, price: '' });
                  setPriceError('');
                  setPanel({ type: 'price', assetId: row.asset.id });
                  setMessage(null);
                }}
                onDelete={(tr) => void removeTrade(tr)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function AssetRow(props: {
  row: AssetRowView;
  trades: TradeRecord[];
  confirmDelete: string;
  busy: boolean;
  onTrade: () => void;
  onPrice: () => void;
  onDelete: (t: TradeRecord) => void;
}) {
  const { row, trades, confirmDelete, busy } = props;
  const sorted = [...trades].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  return (
    <li className="tx bill-row">
      <div className="tx-main">
        <div className="tx-title">
          {row.asset.name} <span className="muted small">{ASSET_KIND_LABEL[row.asset.kind]}</span>
        </div>
        {row.error ? (
          <p role="alert" className="form-error">
            ข้อมูลรายการของสินทรัพย์นี้ไม่สอดคล้อง: {row.error}
          </p>
        ) : (
          <div className="muted small">
            ถือ {formatUnits(row.position.units)} หน่วย · ต้นทุน {baht(row.position.cost)}
            {row.avgCostMicro !== null && ` (เฉลี่ย ${formatMicro(row.avgCostMicro)} บาท/หน่วย)`}
            <br />
            {row.latestPrice ? (
              <>
                ราคา {formatMicro(row.latestPrice.priceMicro)} บาท ณ {thaiDayLabel(row.latestPrice.date)}
                {row.priceStale && <strong className="stale"> · ราคาเก่า อัปเดตราคาก่อนดูมูลค่า</strong>}
                {row.market && (
                  <>
                    {' '}
                    · มูลค่า {baht(row.market.value)} · กำไร/ขาดทุน {signed(row.market.unrealized)}
                  </>
                )}
              </>
            ) : row.position.units > 0n ? (
              'ยังไม่ได้กรอกราคา (ไม่แสดงมูลค่า)'
            ) : (
              'ไม่มีหน่วยที่ถืออยู่'
            )}
            {row.realizedGain !== 0 && ` · ขายแล้ว ${signed(row.realizedGain)}`}
            {row.dividendsNet > 0 && ` · ปันผล ${baht(row.dividendsNet)}`}
          </div>
        )}
        <details className="archived-details">
          <summary>ประวัติรายการ ({trades.length})</summary>
          {sorted.length === 0 ? (
            <p className="muted small">ยังไม่มีรายการ</p>
          ) : (
            <ul className="bill-list">
              {sorted.map((tr) => (
                <li className="tx" key={tr.id}>
                  <div className="tx-main muted small">
                    {thaiDayLabel(tr.date)} · {KIND_LABEL[tr.kind]}
                    {tr.units !== undefined && ` · ${formatUnits(BigInt(tr.units))} หน่วย`}
                    {tr.priceMicro !== undefined && ` @ ${formatMicro(tr.priceMicro)}`}
                    {tr.amount !== undefined && ` · ${baht(tr.amount)}`}
                    {tr.fee > 0 && ` · ค่าธรรมเนียม ${baht(tr.fee)}`}
                    {tr.withholding > 0 && ` · ภาษีหัก ${baht(tr.withholding)}`}
                    {tr.memo !== '' && ` · ${tr.memo}`}
                  </div>
                  <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => props.onDelete(tr)} aria-label={`ลบรายการ ${KIND_LABEL[tr.kind]} วันที่ ${tr.date}`}>
                    {confirmDelete === tr.id ? 'ยืนยันลบ' : 'ลบ'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
      <div className="bill-figures">
        <button type="button" className="btn btn-primary btn-small" onClick={props.onTrade}>
          บันทึกรายการ
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={props.onPrice}>
          กรอกราคา
        </button>
      </div>
    </li>
  );
}
