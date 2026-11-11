import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { thaiDayLabel } from '../app/dates';
import { daysBetween } from '../domain/bills/calendar';
import { newId } from '../app/ids';
import { buildPortfolio, type AssetRowView } from '../app/portfolio';
import { tradeNeedsWallet } from '../domain/invest/ledgerLink';
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
  /** กระเป๋าเงินสดบาทที่เลือกจ่าย/รับเงินได้ */
  wallets: readonly { id: string; name: string }[];
  /** แจ้งเมื่อสร้างสินทรัพย์ (เพิ่มบัญชีลงทุนในสมุด) ให้แอปโหลดสมุดใหม่ */
  onLedgerChanged: () => void;
}

const KIND_LABEL: Record<TradeKind, string> = { buy: 'ซื้อ', sell: 'ขาย', dividend: 'ปันผลเป็นเงินสด', reinvest: 'ปันผลลงทุนต่อ' };
const ASSET_KIND_LABEL: Record<AssetKind, string> = { fund: 'กองทุน', stock: 'หุ้น', other: 'อื่นๆ' };
const baht = (n: number): string => formatBaht(satang(n));
const signed = (n: number): string => (n > 0 ? `+${baht(n)}` : baht(n));

const TRADE_FIELD_ID: Record<TradeField, string> = {
  assetId: 'pf-kind',
  kind: 'pf-kind',
  date: 'pf-date',
  units: 'pf-units',
  price: 'pf-price',
  amount: 'pf-amount',
  fee: 'pf-fee',
  withholding: 'pf-wht',
  memo: 'pf-memo',
};

/** ค่าที่ยังไม่มีข้อมูล: แสดง "—" ให้ตา และบอกโปรแกรมอ่านหน้าจอเป็นข้อความ */
function Dash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">ยังไม่มีข้อมูล</span>
    </>
  );
}

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

/** หน้า "พอร์ตการลงทุน": สินทรัพย์ รายการซื้อขายปันผล (ผูกสมุดบัญชีคู่ P4) ราคาที่กรอกเอง */
export function PortfolioView({ today, wallets, onLedgerChanged }: Props) {
  const repo = useRepository();
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [assetName, setAssetName] = useState('');
  const [assetKind, setAssetKind] = useState<AssetKind>('fund');
  const [tradeForm, setTradeForm] = useState<TradeForm>(emptyTradeForm('', 'buy', today));
  const [walletId, setWalletId] = useState('');
  const [walletError, setWalletError] = useState('');
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletError, setNewWalletError] = useState('');
  const [tradeErrors, setTradeErrors] = useState<TradeFormError[]>([]);
  const [priceForm, setPriceForm] = useState({ date: today, price: '' });
  const [priceError, setPriceError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [assetError, setAssetError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);

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

  // เปิดฟอร์ม: ย้ายโฟกัสและเลื่อนมาที่หัวข้อฟอร์ม · ปิดฟอร์ม: คืนโฟกัสให้ปุ่มที่เปิด
  useEffect(() => {
    if (panel) {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView?.({ block: 'nearest' });
    } else if (openerRef.current) {
      openerRef.current.focus();
      openerRef.current = null;
    }
  }, [panel]);

  // ข้อความผลลัพธ์อยู่บนสุดของหน้า: เลื่อนให้เห็นเมื่อมีข้อความใหม่
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [message]);

  // ปุ่มลบสองขั้น: หมดอายุเองใน 5 วินาที (กันกดค้างแล้วกลับมาลบทันที)
  useEffect(() => {
    if (confirmDelete === '') return;
    const timer = window.setTimeout(() => setConfirmDelete(''), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

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
      setAssetError('กรอกชื่อกองทุน/หุ้น');
      document.getElementById('pf-asset-name')?.focus();
      return;
    }
    setAssetError('');
    const ok = await act(async () => {
      await repo.addAsset({ id: newId('asset'), name, kind: assetKind });
      onLedgerChanged();
    }, `เพิ่ม "${name}" แล้ว`);
    if (ok) setAssetName('');
  };

  const openTrade = (assetId: string, kind: TradeKind = 'buy', opener?: HTMLElement) => {
    openerRef.current = opener ?? null;
    setTradeForm(emptyTradeForm(assetId, kind, today));
    setTradeErrors([]);
    setWalletError('');
    // ไม่เลือกกระเป๋าให้เองเมื่อมีหลายใบ (เรื่องเงิน: ให้ผู้ใช้เลือกเอง) · มีใบเดียวเลือกให้
    setWalletId((cur) => (wallets.some((w) => w.id === cur) ? cur : wallets.length === 1 ? wallets[0]!.id : ''));
    setPanel({ type: 'trade', assetId });
    setMessage(null);
  };
  const setTrade = (patch: Partial<TradeForm>) => setTradeForm((f) => ({ ...f, ...patch }));

  const submitTrade = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildTradeRecord(tradeForm, newId('trade'), nextCreatedAt(), today);
    if (!built.ok) {
      setTradeErrors(built.errors);
      const first = built.errors[0]?.field;
      if (first) document.getElementById(TRADE_FIELD_ID[first])?.focus();
      return;
    }
    setTradeErrors([]);
    const needWallet = tradeNeedsWallet(built.trade.kind);
    if (needWallet && !wallets.some((w) => w.id === walletId)) {
      setWalletError(wallets.length === 0 ? 'ยังไม่มีกระเป๋าเงินสด สร้างกระเป๋าก่อนจึงจะบันทึกได้' : 'เลือกกระเป๋าเงินที่ใช้จ่ายหรือรับเงิน');
      document.getElementById(wallets.length === 0 ? 'pf-newwallet' : 'pf-wallet')?.focus();
      return;
    }
    setWalletError('');
    const ok = await act(async () => {
      await repo.recordTrade({ trade: built.trade, walletId: needWallet ? walletId : undefined });
      onLedgerChanged();
    }, built.trade.kind === 'reinvest' ? 'บันทึกปันผลลงทุนต่อแล้ว (ไม่มีเงินสดเข้า-ออก)' : `บันทึก${KIND_LABEL[built.trade.kind]}แล้ว ปรับยอดกระเป๋า "${wallets.find((w) => w.id === walletId)?.name ?? ''}" ให้แล้ว`);
    if (ok) setPanel(null);
  };

  const createWallet = async () => {
    const name = newWalletName.trim();
    if (name === '') {
      setNewWalletError('กรอกชื่อกระเป๋า เช่น "เงินสด" หรือ "บัญชีธนาคาร"');
      document.getElementById('pf-newwallet')?.focus();
      return;
    }
    setNewWalletError('');
    const id = newId('wallet');
    const ok = await act(async () => {
      await repo.addWallet({ id, name });
      onLedgerChanged();
    }, `สร้างกระเป๋า "${name}" แล้ว และเลือกให้เรียบร้อย`);
    if (ok) {
      setNewWalletName('');
      setWalletId(id);
      setWalletError('');
      // กล่องสร้างกระเป๋าหายไปแล้ว: ย้ายโฟกัสไปช่องเลือกกระเป๋า ไม่ให้โฟกัสหลุดไปที่ตัวหน้า
      window.requestAnimationFrame(() => document.getElementById('pf-wallet')?.focus());
    }
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
      document.getElementById(priceForm.date > today || !isSupportedEntryDate(priceForm.date) ? 'pf-pdate' : 'pf-pprice')?.focus();
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
      setMessage({ text: 'กดปุ่มเดิมอีกครั้งภายใน 5 วินาทีเพื่อยืนยันลบ', kind: 'ok' });
      return;
    }
    setConfirmDelete('');
    await act(async () => {
      await repo.deleteTrade(t.id);
      onLedgerChanged();
    }, t.entryId !== undefined ? 'ลบรายการแล้ว และคืนยอดกระเป๋าเงินในสมุดบัญชีให้แล้ว' : 'ลบรายการแล้ว');
  };

  const t = portfolio.totals;
  const hasAssets = portfolio.rows.length > 0;
  const tradePanelAsset = panel?.type === 'trade' ? portfolio.rows.find((r) => r.asset.id === panel.assetId)?.asset : undefined;
  const pricePanelAsset = panel?.type === 'price' ? portfolio.rows.find((r) => r.asset.id === panel.assetId)?.asset : undefined;
  const k = tradeForm.kind;
  const pricedCount = portfolio.rows.filter((r) => r.market !== null).length;
  const noValue = pricedCount === 0 && t.unpriced > 0;
  const partial = pricedCount > 0 && t.unpriced > 0;
  const closeOnEscape = (e: KeyboardEvent) => {
    // Esc ที่ปิดรายการตัวเลือก (select) ไม่ควรปิดทั้งฟอร์มจนข้อมูลที่กรอกหาย
    if (e.key === 'Escape' && !e.defaultPrevented && (e.target as HTMLElement).tagName !== 'SELECT') setPanel(null);
  };

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">พอร์ตการลงทุน</h2>
        <p className="muted">กองทุนและหุ้นของคุณ ต้นทุนเฉลี่ย และมูลค่าตามราคาที่คุณกรอกเอง</p>
      </div>

      <div className="notice" role="note">
        <p>ซื้อ ขาย และปันผลจะเพิ่มหรือลดเงินในกระเป๋าที่คุณเลือกให้เอง กำไร ขาดทุน และปันผลดูที่หน้านี้ ไม่รวมกับรายรับรายจ่ายประจำวัน</p>
        <p>รายการเก่าที่บันทึกก่อนหน้านี้ไม่ได้ปรับยอดกระเป๋าย้อนหลัง</p>
        <p>ราคาเป็นตัวเลขที่คุณกรอกเอง ไม่ใช่ราคาตลาดสด</p>
      </div>

      <div ref={messageRef}>
        <div role="status" aria-live="polite">
          {message?.kind === 'ok' && <p className="muted">{message.text}</p>}
        </div>
        <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>
      </div>

      {data === null && loadError === '' && (
        <p className="muted" role="status">
          กำลังโหลดพอร์ต…
        </p>
      )}
      {loadError !== '' && (
        <div role="alert">
          <p className="form-error">โหลดข้อมูลพอร์ตไม่สำเร็จ: {loadError}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void load()}>
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {data !== null && loadError === '' && (
      <section className="glass-lite card" aria-labelledby="pf-sum-title">
        <h2 id="pf-sum-title">สรุปพอร์ต</h2>
        {!hasAssets ? (
          <p className="muted">ยังไม่มีสินทรัพย์ เริ่มจากกรอกชื่อกองทุนหรือหุ้นในช่อง "เพิ่มกองทุน/หุ้น" ด้านล่าง</p>
        ) : (
          <dl className="avg-result">
            <div>
              <dt>ต้นทุนรวม (ที่ยังถืออยู่)</dt>
              <dd className="num">{baht(t.cost)}</dd>
            </div>
            <div>
              <dt>มูลค่าตามราคาที่กรอก{partial && ' (เฉพาะที่มีราคา)'}</dt>
              <dd className="num">{noValue ? <Dash /> : baht(t.value)}</dd>
            </div>
            <div>
              <dt>กำไร/ขาดทุนที่ยังไม่ขาย{partial && ' (เฉพาะที่มีราคา)'}</dt>
              <dd className="num">{noValue ? <Dash /> : signed(t.unrealized)}</dd>
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
            มี {t.unpriced} รายการที่ยังไม่ได้กรอกราคา มูลค่าและกำไรรวมเฉพาะรายการที่มีราคา
          </p>
        )}
        <p className="muted small">กำไร/ขาดทุนจากต้นทุน ไม่ใช่ผลตอบแทนต่อปี</p>
        <p className="muted small">ต้นทุนเฉลี่ย = ราคาเฉลี่ยที่คุณจ่ายต่อหน่วย รวมค่าธรรมเนียมซื้อ อาจต่างจากแอปโบรกเกอร์เล็กน้อยจากการปัดเศษ</p>
      </section>
      )}

      <section className="solid card" aria-labelledby="pf-add-title">
        <h2 id="pf-add-title">เพิ่มกองทุน/หุ้น</h2>
        <form onSubmit={addAsset} className="settings-form">
          <div className="field-row">
            <div className="field">
              <label htmlFor="pf-asset-name">ชื่อ</label>
              <input
                id="pf-asset-name"
                type="text"
                autoComplete="off"
                maxLength={200}
                value={assetName}
                aria-invalid={assetError ? true : undefined}
                aria-describedby={assetError ? 'pf-asset-name-err' : undefined}
                onChange={(e) => setAssetName(e.target.value)}
              />
              {assetError && (
                <p id="pf-asset-name-err" className="avg-err">
                  {assetError}
                </p>
              )}
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
          <h2 id="pf-trade-title" ref={headingRef} tabIndex={-1}>
            บันทึกรายการ: {tradePanelAsset.name}
          </h2>
          <form onSubmit={submitTrade} onKeyDown={closeOnEscape} className="settings-form" noValidate>
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
                {k === 'reinvest' && <p className="muted small">ปันผลที่ได้เป็นหน่วยเพิ่ม ไม่ได้รับเป็นเงิน</p>}
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
            {tradeNeedsWallet(k) && wallets.length === 0 && (
              <div className="field notice" role="group" aria-labelledby="pf-nowallet-title">
                <p id="pf-nowallet-title">
                  <strong>ยังไม่มีกระเป๋าเงินสด</strong> ต้องมีกระเป๋าก่อนบันทึก เพราะเงินจากการซื้อ ขาย หรือปันผลจะหักหรือเข้ากระเป๋านี้
                </p>
                <label htmlFor="pf-newwallet">ชื่อกระเป๋าใหม่</label>
                <input
                  id="pf-newwallet"
                  type="text"
                  autoComplete="off"
                  maxLength={100}
                  value={newWalletName}
                  placeholder="เช่น เงินสด หรือ บัญชีธนาคาร"
                  aria-invalid={newWalletError !== '' || walletError !== '' ? true : undefined}
                  aria-describedby={[newWalletError !== '' ? 'pf-newwallet-err' : '', walletError !== '' ? 'pf-newwallet-werr' : ''].filter(Boolean).join(' ') || undefined}
                  onChange={(e) => {
                    setNewWalletName(e.target.value);
                    setNewWalletError('');
                    setWalletError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void createWallet();
                    }
                  }}
                />
                {newWalletError !== '' && (
                  <p id="pf-newwallet-err" className="avg-err" role="alert">
                    {newWalletError}
                  </p>
                )}
                {walletError !== '' && (
                  <p id="pf-newwallet-werr" className="avg-err" role="alert">
                    {walletError}
                  </p>
                )}
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void createWallet()}>
                  สร้างกระเป๋า
                </button>
              </div>
            )}
            {tradeNeedsWallet(k) && wallets.length > 0 && (
              <div className="field">
                <label htmlFor="pf-wallet">{k === 'buy' ? 'จ่ายจากกระเป๋า' : 'รับเงินเข้ากระเป๋า'}</label>
                <select
                  id="pf-wallet"
                  value={walletId}
                  aria-invalid={walletError !== '' ? true : undefined}
                  aria-describedby={walletError !== '' ? 'pf-wallet-err' : undefined}
                  onChange={(e) => {
                    setWalletId(e.target.value);
                    setWalletError('');
                  }}
                >
                  <option value="">เลือกกระเป๋า</option>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                {walletError !== '' && (
                  <p id="pf-wallet-err" className="avg-err">
                    {walletError}
                  </p>
                )}
              </div>
            )}
            <div className="field">
              <label htmlFor="pf-memo">หมายเหตุ (ไม่บังคับ)</label>
              <input
                id="pf-memo"
                type="text"
                autoComplete="off"
                maxLength={2000}
                value={tradeForm.memo}
                aria-invalid={tradeErrors.some((x) => x.field === 'memo') ? true : undefined}
                aria-describedby={tradeErrors.some((x) => x.field === 'memo') ? 'pf-memo-err' : undefined}
                onChange={(e) => setTrade({ memo: e.target.value })}
              />
              {tradeErrors.find((x) => x.field === 'memo') && (
                <p id="pf-memo-err" className="avg-err">
                  {tradeErrors.find((x) => x.field === 'memo')?.message}
                </p>
              )}
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
          <h2 id="pf-price-title" ref={headingRef} tabIndex={-1}>
            กรอกราคาล่าสุด: {pricePanelAsset.name}
          </h2>
          <form onSubmit={submitPrice} onKeyDown={closeOnEscape} className="settings-form" noValidate>
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
                today={today}
                trades={(data?.trades ?? []).filter((x) => x.assetId === row.asset.id)}
                confirmDelete={confirmDelete}
                busy={busy}
                onTrade={(el) => openTrade(row.asset.id, 'buy', el)}
                onPrice={(el) => {
                  openerRef.current = el;
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
  today: string;
  trades: TradeRecord[];
  confirmDelete: string;
  busy: boolean;
  onTrade: (opener: HTMLElement) => void;
  onPrice: (opener: HTMLElement) => void;
  onDelete: (t: TradeRecord) => void;
}) {
  const { row, today, trades, confirmDelete, busy } = props;
  const sorted = [...trades].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
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
            ถือ <span className="num">{formatUnits(row.position.units)}</span> หน่วย · ต้นทุน <span className="num">{baht(row.position.cost)}</span>
            {row.avgCostMicro !== null && ` (เฉลี่ย ${formatMicro(row.avgCostMicro)} บาท/หน่วย)`}
            <br />
            {row.latestPrice ? (
              <>
                ราคา {formatMicro(row.latestPrice.priceMicro)} บาท ณ {thaiDayLabel(row.latestPrice.date)}
                {row.priceStale && <strong className="stale"> · ราคาเก่า {daysBetween(row.latestPrice.date, today)} วัน อัปเดตราคาก่อนดูมูลค่า</strong>}
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
                  <button
                    type="button"
                    className={confirmDelete === tr.id ? 'btn btn-ghost btn-small confirm-delete' : 'btn btn-ghost btn-small'}
                    disabled={busy}
                    onClick={() => props.onDelete(tr)}
                    aria-label={`${confirmDelete === tr.id ? 'ยืนยันลบ' : 'ลบ'}รายการ ${KIND_LABEL[tr.kind]} วันที่ ${tr.date}`}
                  >
                    {confirmDelete === tr.id ? 'ยืนยันลบ' : 'ลบ'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
      <div className="bill-figures">
        <button type="button" className="btn btn-primary btn-small" onClick={(e) => props.onTrade(e.currentTarget)}>
          บันทึกรายการ
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={(e) => props.onPrice(e.currentTarget)}>
          กรอกราคา
        </button>
      </div>
    </li>
  );
}
