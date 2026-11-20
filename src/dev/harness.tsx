/**
 * ชุดทดสอบหน้าจอบนเครื่องผู้พัฒนาเท่านั้น (เปิดผ่าน `npm run dev` ที่ /harness.html) ไม่ถูกรวมใน build จริง (vite build ใช้ index.html ตัวเดียว)
 * ติดตั้งแอปบนข้อมูลในเครื่อง (Dexie ของเบราว์เซอร์นั้น) ข้ามการล็อกอิน เพื่อถ่ายภาพหน้าจอ 360px ด้วยเบราว์เซอร์แบบไม่มีหน้าต่าง
 * พารามิเตอร์: ?seed=1 ใส่ข้อมูลสมมติ · ?investDemo=1 ใส่ข้อมูลลงทุนสมมติ (src/dev/investDemo.ts) · ?view=<ชื่อเมนู> เปิดหน้านั้น · ?menu=1 เปิดเมนูมือถือ
 * ห้ามใส่ข้อมูลการเงินจริง ข้อมูลทั้งหมดเป็นตัวเลขสมมติ
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildInitialLedger } from '../app/setup';
import { db } from '../storage/instance';
import { createDexieRepository } from '../storage/ledgerRepository';
import { App } from '../ui/App';
import { RepositoryProvider, localLedgerRepository } from '../ui/RepositoryContext';
import { buildCashAdjustmentEntry } from '../domain/invest/cashAdjustment';
import { demoCashLedger, demoInvestments, demoInvestmentsNoRate, demoInvestmentsWithHistory } from './investDemo';
import { AccountContext } from '../ui/AuthContext';
import { PasswordPromptProvider } from '../ui/PasswordPrompt';
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/500.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import '@fontsource/ibm-plex-sans-thai/700.css';
import '../ui/styles.css';
import { startLiquidGlass } from '../ui/liquidGlass';

startLiquidGlass();

const params = new URLSearchParams(location.search);

async function seed(): Promise<void> {
  const repo = createDexieRepository(db);
  if (params.get('reset') === '1') await repo.resetAll();
  if (params.get('seed') !== '1' || !(await repo.isEmpty())) return;
  await repo.saveInitialLedger(buildInitialLedger([{ name: 'เงินสด', opening: '5408.41' }, { name: 'บัญชีออมทรัพย์', opening: '25000' }], '2026-11-01'));
  const { accounts } = await repo.loadLedger();
  const wallet = accounts.find((a) => a.type === 'asset')!;
  const food = accounts.find((a) => a.type === 'expense')!;
  const income = accounts.find((a) => a.type === 'income');
  await repo.appendEntry({ id: 'demo-e1', date: '2026-11-05', memo: 'ข้าวมันไก่', lines: [{ accountId: food.id, amount: 6500 }, { accountId: wallet.id, amount: -6500 }] });
  if (income) await repo.appendEntry({ id: 'demo-e2', date: '2026-11-03', memo: 'เงินเดือน (สมมติ)', lines: [{ accountId: wallet.id, amount: 3_000_000 }, { accountId: income.id, amount: -3_000_000 }] });
  await repo.addBill({ id: 'bill-demo', name: 'ค่าเน็ต (สมมติ)', amount: 59900, dueDay: 5 } as never, '2026-11-13');
}

/** StrictMode เรียก effect สองรอบ: ใส่ข้อมูลสมมติครั้งเดียว */
let seedOnce: Promise<void> | null = null;

function Harness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    seedOnce ??= seed();
    void seedOnce.then(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    const view = params.get('view');
    const menu = params.get('menu') === '1';
    const timer = window.setTimeout(() => {
      if (menu) document.querySelector<HTMLElement>('[aria-label*="เมนู"], .menu-fab, button.menu-button')?.click();
      if (view) {
        const btn = Array.from(document.querySelectorAll<HTMLElement>('nav button, nav a, button')).find((b) => (b.textContent ?? '').trim().startsWith(view));
        btn?.click();
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [ready]);
  if (!ready) return null;
  return (
    <AccountContext.Provider value={{ username: 'ผู้ทดสอบ', signOut: async () => undefined, refresh: async () => undefined }}>
      <PasswordPromptProvider>
        {params.get('investDemo') === '1' || params.get('investDemo') === 'report' || params.get('investDemo') === 'norate' || params.get('investDemo') === 'cash' || params.get('investDemo') === 'cashneg' ? (
          <RepositoryProvider repository={params.get('investDemo') === 'report' ? { ...localLedgerRepository(), loadInvestments: () => Promise.resolve(demoInvestmentsWithHistory()) } : params.get('investDemo') === 'norate' ? { ...localLedgerRepository(), loadInvestments: () => Promise.resolve(demoInvestmentsNoRate()) } : params.get('investDemo') === 'cash' || params.get('investDemo') === 'cashneg' ? cashDemoRepository(params.get('investDemo') === 'cashneg') : demoRepository()}>
            <App />
          </RepositoryProvider>
        ) : (
          <App />
        )}
      </PasswordPromptProvider>
    </AccountContext.Provider>
  );
}

/** ที่เก็บข้อมูลลงทุนสมมติที่ลบรายการได้ (เฉพาะ ?investDemo=1 · ใช้ทดสอบปุ่ม Delete ของหน้า Holdings) */
let demoRepo: ReturnType<typeof makeDemoRepository> | null = null;
const demoRepository = () => (demoRepo ??= makeDemoRepository());
function makeDemoRepository() {
  const demo = demoInvestments();
  return {
    ...localLedgerRepository(),
    loadInvestments: () => Promise.resolve({ ...demo, trades: [...demo.trades] }),
    deleteTrade: (id: string) => {
      demo.trades = demo.trades.filter((t) => t.id !== id);
      return Promise.resolve();
    },
  };
}

/** ที่เก็บสมมติของหน้า Cash (?investDemo=cash|cashneg): สมุดอยู่ในหน่วยความจำ บันทึกการปรับยอดได้ (ถอนเกินยอดถูกปฏิเสธเหมือนฐานข้อมูลจริง) */
let cashRepo: ReturnType<typeof makeCashDemoRepository> | null = null;
const cashDemoRepository = (negative: boolean) => (cashRepo ??= makeCashDemoRepository(negative));
function makeCashDemoRepository(negative: boolean) {
  const base = localLedgerRepository();
  const demo = demoCashLedger(negative);
  const entries = [...demo.entries];
  return {
    ...base,
    loadLedger: async () => {
      const l = await base.loadLedger();
      return { accounts: [...l.accounts, ...demo.accounts], entries: [...l.entries, ...entries] };
    },
    loadInvestments: () => Promise.resolve(demoInvestments()),
    recordCashAdjustment: (input: Parameters<typeof buildCashAdjustmentEntry>[0]) => {
      const { entry } = buildCashAdjustmentEntry(input);
      if (input.direction === 'withdraw') {
        const balance = entries.flatMap((e) => e.lines).filter((l) => l.accountId === input.cashAccountId).reduce((s, l) => s + l.amount, 0);
        if (balance < input.amountMinor) return Promise.reject(new Error('insufficient cash'));
      }
      entries.push(entry as (typeof entries)[number]);
      return Promise.resolve();
    },
  };
}

const root = document.getElementById('root');
if (!root) throw new Error('ไม่พบ #root');
createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
