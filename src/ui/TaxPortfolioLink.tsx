import { useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '../app/errorText';
import { fillAmountText, tagsToPatch, taxTagOf, withAssetTag, type TaxTag } from '../app/taxPortfolio';
import { TAX_PARTIAL_NOTE } from '../app/taxForm';
import type { InvestmentData } from '../domain/invest/types';
import { sanitizeTaxTagIds } from '../domain/invest/taxTags';
import { TAX_CONFIG_2569 } from '../domain/tax/config';
import { formatWholeBaht } from '../domain/tax/display';
import { summarizeTaxPurchases, type TaxPurchaseSummary, type TaxTags } from '../domain/tax/portfolioLink';
import { useRepository } from './RepositoryContext';

/**
 * ดึงยอดซื้อจากพอร์ตมาเติมเครื่องคิดภาษี (ภาษี เฟส 3 · กฎ R19) อยู่ในกลุ่มช่อง RMF/Thai ESG ของ TaxView
 * ผู้ใช้ติดป้ายสินทรัพย์เอง (ค่าเริ่มต้นไม่ติด) เก็บเป็นรหัสใน settings ผ่าน patchSettings · อ่านพอร์ตอย่างเดียว ไม่เขียนสมุดบัญชี
 * ยอดที่เติมเป็นค่าตั้งต้น ผู้ใช้แก้ในช่องได้เอง · ไม่เติมยอด 0 และบอกค่าเดิมเมื่อเติมทับ · ไม่มีสูตรเงินในคอมโพเนนต์ (เรียกโดเมน)
 */
export interface TaxPortfolioLinkProps {
  onFill: (patch: { rmfPaid?: string; thaiEsgPaid?: string }) => void;
  /** ข้อความที่อยู่ในช่องตอนนี้ (ไว้บอกว่าเติมทับค่าเดิม) */
  current: { rmfPaid: string; thaiEsgPaid: string };
}

const TAG_LABEL: Record<TaxTag, string> = { rmf: 'RMF', thaiEsg: 'Thai ESG' };
const cfg = TAX_CONFIG_2569;

/** ค่าจาก select → ป้ายที่รู้จักเท่านั้น (ค่าอื่น = ล้างป้าย) */
const toTag = (value: string): TaxTag | null => (value === 'rmf' || value === 'thaiEsg' ? value : null);

export function TaxPortfolioLink({ onFill, current }: TaxPortfolioLinkProps) {
  const repo = useRepository();
  const [invest, setInvest] = useState<InvestmentData | null>(null);
  const [tags, setTags] = useState<TaxTags>({ rmf: [], thaiEsg: [] });
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [filled, setFilled] = useState('');
  // บันทึกป้ายทีละคิว (เลือกรัวๆ แล้วค่าสุดท้ายต้องเป็นค่าที่เขียน)
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    Promise.all([repo.loadInvestments(), repo.loadSettings()])
      .then(([d, s]) => {
        if (cancelled) return;
        setInvest(d);
        setTags({ rmf: sanitizeTaxTagIds(s.taxRmfAssetIds), thaiEsg: sanitizeTaxTagIds(s.taxThaiEsgAssetIds) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(friendlyError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const summary = useMemo((): { value: TaxPurchaseSummary | null; failure: string } => {
    if (invest === null) return { value: null, failure: '' };
    try {
      return { value: summarizeTaxPurchases(invest, tags, cfg.year), failure: '' };
    } catch (e) {
      return { value: null, failure: friendlyError(e) };
    }
  }, [invest, tags]);

  const changeTag = (assetId: string, tag: TaxTag | null) => {
    // แสดงผลทันทีจากที่เห็นอยู่ (ถ้าเกินเพดานบอกเลย) แล้วเขียนจริงจาก "ค่าล่าสุด" แบบ compare-and-set
    try {
      setTags(withAssetTag(tags, assetId, tag));
    } catch (e) {
      setSaveError(friendlyError(e));
      return;
    }
    setFilled('');
    saveChain.current = saveChain.current.then(async () => {
      try {
        const saved = await repo.updateSettings(['taxRmfAssetIds', 'taxThaiEsgAssetIds'], (current) =>
          tagsToPatch(withAssetTag({ rmf: current.taxRmfAssetIds ?? [], thaiEsg: current.taxThaiEsgAssetIds ?? [] }, assetId, tag)),
        );
        setTags({ rmf: sanitizeTaxTagIds(saved.taxRmfAssetIds), thaiEsg: sanitizeTaxTagIds(saved.taxThaiEsgAssetIds) });
        setSaveError('');
      } catch (e) {
        setSaveError(friendlyError(e));
        try {
          const latest = await repo.loadSettings();
          setTags({ rmf: sanitizeTaxTagIds(latest.taxRmfAssetIds), thaiEsg: sanitizeTaxTagIds(latest.taxThaiEsgAssetIds) });
        } catch {
          /* ใช้ค่าที่แสดงอยู่ต่อ */
        }
      }
    });
  };

  const fill = (field: 'rmfPaid' | 'thaiEsgPaid', satangValue: number) => {
    const text = fillAmountText(satangValue);
    const old = current[field].trim();
    onFill({ [field]: text });
    const label = field === 'rmfPaid' ? 'RMF' : 'Thai ESG';
    setFilled(`เติมช่อง ${label} ด้วยยอดซื้อจากพอร์ต ${formatWholeBaht(satangValue)} แล้ว ยอดแก้เองได้${old !== '' && old !== text ? ` (แทนค่าที่กรอกไว้เดิม ${old})` : ''}`);
  };

  if (loadError !== '') return <p className="muted small">โหลดข้อมูลพอร์ตไม่สำเร็จ กรอกยอดเองได้ในช่องด้านล่าง</p>;
  if (invest === null) return <p className="muted small">กำลังโหลดพอร์ต...</p>;
  if (invest.assets.length === 0) {
    return <p className="muted small">ยังไม่มีสินทรัพย์ในพอร์ต ไปเพิ่มที่หน้าพอร์ตก่อน หรือกรอกยอดเองในช่องด้านล่าง</p>;
  }

  const s = summary.value;
  return (
    <div className="tax-link">
      <p className="small">
        <strong>ดึงยอดซื้อจากพอร์ต (ไม่บังคับ)</strong>
      </p>
      <p className="muted small">เลือกว่าสินทรัพย์ไหนเป็น RMF หรือ Thai ESG แล้วกดเติมยอดซื้อปี {cfg.year} ยอดแก้เองได้</p>
      <ul className="plain-list tax-link-list">
        {invest.assets.map((a) => (
          <li key={a.id}>
            <label htmlFor={`tx-tag-${a.id}`}>
              {a.name}
              {a.archived ? ' (เก็บถาวร)' : ''}
            </label>
            <select id={`tx-tag-${a.id}`} value={taxTagOf(tags, a.id) ?? ''} onChange={(e) => changeTag(a.id, toTag(e.target.value))}>
              <option value="">ไม่ติดป้าย</option>
              <option value="rmf">{TAG_LABEL.rmf}</option>
              <option value="thaiEsg">{TAG_LABEL.thaiEsg}</option>
            </select>
          </li>
        ))}
      </ul>
      {saveError !== '' && (
        <p className="muted small" role="status">
          จำป้ายไม่สำเร็จ ครั้งหน้าอาจต้องติดใหม่ ใช้งานต่อได้ตามปกติ: {saveError}
        </p>
      )}
      {summary.failure !== '' && (
        <p className="avg-err" role="alert">
          สรุปยอดซื้อจากพอร์ตไม่สำเร็จ: {summary.failure}
        </p>
      )}
      {s && (tags.rmf.length > 0 || tags.thaiEsg.length > 0) && (
        <>
          <p className="small">
            ยอดซื้อปีภาษี {s.taxYear} (วันที่ {s.fromDate} ถึง {s.toDate} ตามที่คุณบันทึก)
          </p>
          <p className="small">
            RMF <strong className="num">{formatWholeBaht(s.rmfSatang)}</strong>
          </p>
          <p className="small">
            Thai ESG <strong className="num">{formatWholeBaht(s.thaiEsgSatang)}</strong>
          </p>
          {s.lines.length > 0 && (
            <ul className="muted small">
              {s.lines.map((l) => (
                <li key={l.assetId}>
                  {TAG_LABEL[l.tag]} · {l.name}: {formatWholeBaht(l.amountSatang)} จากการซื้อ {l.buyCount} รายการ
                </li>
              ))}
            </ul>
          )}
          <p className="notice" role="note">
            <strong>วงเงินยังไม่ยืนยันครบ:</strong> {TAX_PARTIAL_NOTE}
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost btn-small" disabled={s.rmfSatang === 0} onClick={() => fill('rmfPaid', s.rmfSatang)}>
              เติมยอด RMF จากพอร์ต
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={s.thaiEsgSatang === 0} onClick={() => fill('thaiEsgPaid', s.thaiEsgSatang)}>
              เติมยอด Thai ESG จากพอร์ต
            </button>
          </div>
          {(s.rmfSatang === 0 || s.thaiEsgSatang === 0) && <p className="muted small">ปุ่มที่กดไม่ได้ = ยังไม่มียอดซื้อของประเภทนั้นในปีนี้ (ตามสินทรัพย์ที่ติดป้าย)</p>}
          {filled !== '' && (
            <p className="muted small" role="status">
              {filled}
            </p>
          )}
          <p className="muted small">นับเฉพาะรายการซื้อที่คุณบันทึกในพอร์ต ไม่รวมค่าธรรมเนียม ปันผลที่นำไปซื้อต่อ หรือแผนซื้อที่ยังไม่ได้ซื้อจริง</p>
          {s.sellCount > 0 && (
            <p className="notice" role="note">
              <strong>ข้อควรระวัง:</strong> มีรายการขาย {s.sellCount} รายการของสินทรัพย์ที่ติดป้ายในปีนี้ ถ้าขายก่อนครบเงื่อนไขการถือครอง อาจต้องคืนสิทธิลดหย่อน แอปไม่ได้ตรวจให้
            </p>
          )}
          {s.skippedCount > 0 && (
            <p className="notice" role="note">
              <strong>ข้อควรระวัง:</strong> ข้ามรายการที่ข้อมูลผิดปกติ {s.skippedCount} รายการ (ยอดหรือวันที่ไม่ถูกต้อง) ตรวจที่หน้าพอร์ต
            </p>
          )}
          {s.missingAssetCount > 0 && <p className="muted small">มีป้ายของสินทรัพย์ที่ถูกลบไปแล้ว {s.missingAssetCount} รายการ ข้ามให้แล้ว</p>}
        </>
      )}
    </div>
  );
}
