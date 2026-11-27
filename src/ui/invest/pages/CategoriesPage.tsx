import { useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../../../app/ids';
import { CATEGORY_PROBLEM_TEXT } from '../../../domain/invest/categories';
import { buildCategoriesCsv, buildCategoriesJson, categoriesCsvFilename, categoriesJsonFilename, IMPORT_PROBLEM_TEXT, parseCategoriesJson } from '../../../domain/invest/categoriesFile';
import { buildCategoryTable, fromSectors, stateFromData, stateToSave, type CategoryState } from '../../../domain/invest/categoriesView';
import { buildHoldingsView, totalsOf } from '../../../domain/invest/holdingsView';
import { useRepository } from '../../RepositoryContext';
import { CategoryEditor } from '../categories/CategoryEditor';
import { downloadText } from '../categories/downloadText';
import { downloadCsv } from '../downloadCsv';
import { CategorySummary } from '../categories/CategorySummary';
import '../categories/categories.css';
import { useInvest } from '../InvestContext';
import { investError } from '../investError';

/**
 * Portfolio → Categories (แบบร่าง 25 · R2): หมวดของผู้ใช้ + เป้า % ต่อหมวด · ตารางสรุปต่อหมวดจาก domain (buildCategoryTable)
 * บันทึกผ่าน repository.saveCategories (ธุรกรรมเดียว) · หน้าจอไม่มีสูตรเงิน · แสดงผลสกุลเดียวตามที่เลือก (ไม่บวกข้ามสกุล)
 */
export function CategoriesPage(_props: { onHome?: () => void }) {
  const { today, data, loadError, currency, reload } = useInvest();
  const repo = useRepository();
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<CategoryState>({ drafts: [], assign: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorWasOpen = useRef(false);

  const view = useMemo(() => (data ? buildHoldingsView(data, today, currency) : null), [data, today, currency]);
  const table = useMemo(() => (view && data ? buildCategoryTable(view.rows, data.assets, data.categories ?? [], currency) : []), [view, data, currency]);
  const total = useMemo(() => (view ? totalsOf(view.rows.filter((r) => !r.sold), currency).value : null), [view, currency]);
  const heldIds = useMemo(() => new Set((view?.rows ?? []).filter((r) => r.units > 0n).map((r) => r.assetId)), [view]);
  const assets = data?.assets ?? [];

  // เปิดตัวแก้แล้วย้ายโฟกัสไปที่ช่องแรก · ปิดแล้วกลับมาที่หัวข้อหน้า
  useEffect(() => {
    if (editing) {
      editorWasOpen.current = true;
      const h = document.getElementById('cg-edit-title');
      h?.focus({ preventScroll: true });
      h?.scrollIntoView({ block: 'nearest' });
    } else if (editorWasOpen.current) {
      editorWasOpen.current = false;
      titleRef.current?.focus();
    }
  }, [editing]);

  const startEdit = () => {
    if (!data) return;
    setState(stateFromData(data.assets, data.categories ?? []));
    setError('');
    setNotice('');
    setMessage(null);
    setEditing(true);
  };

  const createFromSectors = () => {
    if (!data) return;
    const base = editing ? state : stateFromData(data.assets, data.categories ?? []);
    const next = fromSectors(base, data.assets, heldIds, () => newId('cat'));
    if (next === base) {
      const text = 'No stock you hold has a sector yet. Add a sector when you add a stock.';
      if (editing) setNotice(text);
      else setMessage({ kind: 'ok', text });
      return;
    }
    const added = next.drafts.length - base.drafts.length;
    setState(next);
    setError('');
    setMessage(null);
    setNotice(`${added > 0 ? `Created ${added} ${added === 1 ? 'category' : 'categories'} from sectors.` : 'Sorted your stocks into existing categories by sector.'} Set a target for each category if you want one, then press Save.`);
    setEditing(true);
  };

  const save = async () => {
    if (!data || busy) return;
    const plan = stateToSave(state, data.assets);
    if (!plan.ok) {
      setError(CATEGORY_PROBLEM_TEXT[plan.problem].en);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await repo.saveCategories(plan.categories, plan.assignments);
    } catch (e) {
      setError(investError(e));
      setBusy(false);
      return;
    }
    try {
      await reload();
    } catch {
      // บันทึกสำเร็จแล้ว แต่โหลดใหม่ไม่ได้: ข้อความ error ของหน้าหลักจะแจ้ง
    }
    setBusy(false);
    setEditing(false);
    setNotice('');
    setMessage({ kind: 'ok', text: 'Categories saved.' });
  };

  // มีการแก้ค้างอยู่ไหม (เทียบกับที่บันทึกไว้) · ปิดด้วย Cancel/Esc ต้องถามยืนยันก่อนทิ้ง
  const dirty = useMemo(() => editing && data !== null && JSON.stringify(state) !== JSON.stringify(stateFromData(data.assets, data.categories ?? [])), [editing, data, state]);
  const requestCancel = () => {
    if (dirty) setConfirming(true);
    else cancel();
  };
  const cancel = () => {
    setConfirming(false);
    setEditing(false);
    setError('');
    setNotice('');
  };

  const hasCategories = (data?.categories?.length ?? 0) > 0;

  const exportFile = (kind: 'csv' | 'json') => {
    if (!data || !hasCategories) return;
    const cats = data.categories ?? [];
    if (kind === 'csv') downloadCsv(buildCategoriesCsv(cats, data.assets), categoriesCsvFilename(today));
    else downloadText(buildCategoriesJson(cats, data.assets), categoriesJsonFilename(today), 'application/json;charset=utf-8');
  };

  // นำเข้า JSON เป็นร่าง (ยังไม่บันทึก) ให้ผู้ใช้ตรวจ/แก้แล้วกด Save เอง · ตรวจรูปแบบและกฎหมวดก่อน (categoriesProblem ผ่าน draftsToCategories)
  const importFile = async (file: File | undefined) => {
    if (!data || !file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      setMessage({ kind: 'error', text: 'Could not read the file.' });
      return;
    }
    const r = parseCategoriesJson(text, data.assets, () => newId('cat'));
    if (!r.ok) {
      const msg = r.problem in IMPORT_PROBLEM_TEXT ? IMPORT_PROBLEM_TEXT[r.problem as keyof typeof IMPORT_PROBLEM_TEXT] : CATEGORY_PROBLEM_TEXT[r.problem as keyof typeof CATEGORY_PROBLEM_TEXT].en;
      setMessage({ kind: 'error', text: `Import failed: ${msg}` });
      return;
    }
    setState(r.state);
    setError('');
    setMessage(null);
    setNotice(`Imported ${r.state.drafts.length} ${r.state.drafts.length === 1 ? 'category' : 'categories'}${r.skippedTickers > 0 ? `; skipped ${r.skippedTickers} ${r.skippedTickers === 1 ? 'entry' : 'entries'} for stocks you do not have` : ''}. This replaces what is shown below until you press Save or Cancel.`);
    setEditing(true);
  };

  const noAssets = data !== null && data.assets.length === 0;
  // หมวดค้างได้แม้ยังไม่มีหุ้น (เช่น หลังนำเข้าไฟล์สำรอง) ต้องแก้และลบได้
  const nothingToManage = noAssets && !hasCategories && !editing;

  return (
    <div className="invest-tab hd-page cg-page">
      <div className="cg-head">
        <h2 id="cg-title" ref={titleRef} tabIndex={-1}>
          Categories
        </h2>
        <div className="cg-head-actions">
          <button type="button" className="iv-btn" onClick={createFromSectors} disabled={data === null || noAssets || busy}>
            Create categories from sectors
          </button>
          <button type="button" className="iv-btn" disabled={data === null || !hasCategories || busy} onClick={() => exportFile('csv')} title="Export categories and targets to a CSV file">
            Export CSV
          </button>
          <button type="button" className="iv-btn" disabled={data === null || !hasCategories || busy} onClick={() => exportFile('json')} title="Export categories, targets and stock assignments to a JSON file you can import later">
            Export JSON
          </button>
          <button type="button" className="iv-btn" disabled={data === null || noAssets || busy} onClick={() => fileRef.current?.click()} title="Import a categories JSON file (nothing is saved until you press Save)">
            Import
          </button>
          <input id="cg-import-file" ref={fileRef} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="iv-btn iv-btn-gold" onClick={startEdit} disabled={data === null || nothingToManage || editing || busy}>
            Change
          </button>
        </div>
      </div>
      <p className="muted cg-lead">Group your stocks into your own categories and set a target % for each. Targets are for comparing with your actual allocation.</p>
      <div role="status">{message?.kind === 'ok' && <p className="muted">{message.text}</p>}</div>
      <div role="alert">{message?.kind === 'error' && <p className="form-error">{message.text}</p>}</div>

      {loadError !== '' && data === null ? (
        <div role="alert">
          <p className="form-error">Could not load categories: {loadError}</p>
          <button type="button" className="iv-btn" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      ) : data === null ? (
        <p className="muted" role="status">
          Loading categories…
        </p>
      ) : nothingToManage ? (
        <section className="glass-lite card">
          <h3 className="hd-empty-title">No stocks yet</h3>
          <p className="muted">Add a stock in Portfolio → Holdings first. Then you can group it into a category.</p>
        </section>
      ) : (
        <>
          {noAssets && <p className="muted">Add a stock in Portfolio → Holdings to group it into these categories.</p>}
          {(data.categories?.length ?? 0) === 0 ? (
            editing ? null : (
            <section className="glass-lite card">
              <h3 className="hd-empty-title">No categories yet</h3>
              <p className="muted">Press "Create categories from sectors" to start from the sectors of the stocks you hold, or "Change" to add your own.</p>
            </section>
            )
          ) : (
            <CategorySummary rows={table} currency={currency} total={total} />
          )}
          {editing && <CategoryEditor state={state} onChange={setState} assets={assets} busy={busy} error={error} notice={notice} onSave={() => void save()} onCancel={requestCancel} confirming={confirming} onKeep={() => setConfirming(false)} onDiscard={cancel} />}
        </>
      )}
    </div>
  );
}
