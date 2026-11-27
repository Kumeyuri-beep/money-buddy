/**
 * ที่เก็บสมมติของหน้า Categories (?investDemo=cat) สำหรับ harness/Playwright เท่านั้น · ไม่ต่อฐานข้อมูล ไม่ถูกรวมใน build จริง
 * เก็บหมวด/sector/หมวดของสินทรัพย์ใน sessionStorage (รีโหลดหน้าแล้วยังอยู่ · ปิดแท็บแล้วหาย) · ตรวจหมวดด้วย categoriesProblem ตัวเดียวกับของจริง · ข้อมูลทั้งหมดเป็นของสมมติ
 */
import { categoriesProblem } from '../domain/invest/categories';
import type { Asset, AssetCategory, InvestmentData } from '../domain/invest/types';
import type { CategoryAssignment, LedgerRepository } from '../storage/ledgerRepository';
import { localLedgerRepository } from '../ui/RepositoryContext';
import { demoInvestments } from './investDemo';

interface Saved {
  categories: AssetCategory[];
  patch: Record<string, { categoryId?: string | null; sector?: string | null }>;
  extra: Asset[];
}

const KEY = 'mb-categories-demo-v1';
const SECTORS: Record<string, string> = {
  d1: 'Information Technology', d2: 'Health Care', d3: 'Communication Services', d4: 'Consumer Staples', d5: 'Real Estate',
};

function read(): Saved {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    // อ่านไม่ได้ = เริ่มใหม่
  }
  // ?noStocks=1 = มีหมวดค้างแต่ยังไม่มีหุ้น
  const categories = noStocks() ? ['A', 'B'].map((x, i) => ({ id: `old-${x}`, name: `Old category ${x}`, targetBps: null, sortOrder: i })) : [];
  return { categories, patch: {}, extra: [] };
}
function noStocks(): boolean {
  return new URLSearchParams(window.location.search).get('noStocks') === '1';
}
function write(s: Saved): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // เก็บไม่ได้ = อยู่ในหน่วยความจำของหน้านี้เท่านั้น
  }
}

export function categoriesDemoRepository(): LedgerRepository {
  let saved = read();
  return {
    ...localLedgerRepository(),
    loadInvestments: () => {
      const base: InvestmentData = noStocks() ? { assets: [], trades: [], prices: [] } : demoInvestments();
      const assets: Asset[] = [...base.assets, ...saved.extra].map((a) => {
        const sector = SECTORS[a.id];
        const next: Asset = sector !== undefined ? { ...a, sector } : { ...a };
        const p = saved.patch[a.id];
        if (p) {
          if (p.sector === null) delete next.sector;
          else if (p.sector !== undefined) next.sector = p.sector;
          if (p.categoryId === null) delete next.categoryId;
          else if (p.categoryId !== undefined) next.categoryId = p.categoryId;
        }
        if (next.categoryId !== undefined && !saved.categories.some((c) => c.id === next.categoryId)) delete next.categoryId;
        return next;
      });
      const data: InvestmentData = { ...base, assets, trades: [...base.trades], categories: saved.categories.map((c) => ({ ...c })) };
      return Promise.resolve(data);
    },
    saveCategories: (categories: readonly AssetCategory[], assignments: readonly CategoryAssignment[]) => {
      const problem = categoriesProblem(categories);
      if (problem !== null) return Promise.reject(new Error(problem));
      const patch = { ...saved.patch };
      for (const a of assignments) patch[a.assetId] = { ...patch[a.assetId], ...(a.categoryId !== undefined ? { categoryId: a.categoryId } : {}), ...(a.sector !== undefined ? { sector: a.sector } : {}) };
      saved = { ...saved, categories: categories.map((c) => ({ ...c })), patch };
      write(saved);
      return Promise.resolve();
    },
    addUsdStock: (input) => {
      const asset: Asset = { id: input.id, name: input.name, kind: 'stock', accountId: `inv-${input.id}`, currency: 'USD', ticker: input.ticker, exchange: input.exchange };
      saved = { ...saved, extra: [...saved.extra, asset] };
      write(saved);
      return Promise.resolve(asset);
    },
  };
}
