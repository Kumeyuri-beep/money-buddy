import { useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../../../app/ids';
import { CATEGORY_PROBLEM_TEXT } from '../../../domain/invest/categories';
import { buildCategoryTable, fromSectors, stateFromData, stateToSave, type CategoryState } from '../../../domain/invest/categoriesView';
import { buildHoldingsView, totalsOf } from '../../../domain/invest/holdingsView';
import { useRepository } from '../../RepositoryContext';
import { CategoryEditor } from '../categories/CategoryEditor';
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
  const [message, setMessage] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
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
      document.getElementById('cg-edit-title')?.scrollIntoView({ block: 'nearest' });
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
    setMessage('');
    setEditing(true);
  };

  const createFromSectors = () => {
    if (!data) return;
    const base = editing ? state : stateFromData(data.assets, data.categories ?? []);
    const next = fromSectors(base, data.assets, heldIds, () => newId('cat'));
    if (next === base) {
      const text = 'No stock you hold has a sector yet. Add a sector when you add a stock.';
      if (editing) setNotice(text);
      else setMessage(text);
      return;
    }
    const added = next.drafts.length - base.drafts.length;
    setState(next);
    setError('');
    setMessage('');
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
    setMessage('Categories saved.');
  };

  const cancel = () => {
    setEditing(false);
    setError('');
    setNotice('');
  };

  const noAssets = data !== null && data.assets.length === 0;

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
          <button type="button" className="iv-btn iv-btn-gold" onClick={startEdit} disabled={data === null || editing || busy}>
            Change
          </button>
        </div>
      </div>
      <p className="muted cg-lead">Group your stocks into your own categories and set a target % for each. Targets are for comparing with your actual allocation.</p>
      <div role="status">{message !== '' && <p className="muted">{message}</p>}</div>

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
      ) : noAssets ? (
        <section className="glass-lite card">
          <h3 className="hd-empty-title">No stocks yet</h3>
          <p className="muted">Add a stock in Portfolio → Holdings first. Then you can group it into a category.</p>
        </section>
      ) : (
        <>
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
          {editing && <CategoryEditor state={state} onChange={setState} assets={assets} busy={busy} error={error} notice={notice} onSave={() => void save()} onCancel={cancel} />}
        </>
      )}
    </div>
  );
}
