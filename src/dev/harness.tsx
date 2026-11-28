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
import { AccountChangedError, createDexieRepository, ImportUnconfirmedError, InvestmentImportError } from '../storage/ledgerRepository';
import { emptyInvestments, type InvestmentData } from '../domain/invest/types';
import { App } from '../ui/App';
import { RepositoryProvider, localLedgerRepository } from '../ui/RepositoryContext';
import { buildCashAdjustmentEntry } from '../domain/invest/cashAdjustment';
import { editedTradeOf } from '../domain/invest/editImpact';
import type { TradeRecord } from '../domain/invest/types';
import { categoriesDemoRepository } from './categoriesDemo';
import { rebalanceDemoRepository, type RebalanceDemoKind } from './rebalanceDemo';
import { demoCashLedger, demoInvestments, demoInvestmentsNoRate, demoInvestmentsWithHistory, demoTransactionsData, demoTransactionsDataWithThai, demoTransactionsLedger } from './investDemo';
import { AccountContext } from '../ui/AuthContext';
import { MigrationWizard } from '../ui/MigrationWizard';
import { wizardDemoRepository, type WizardDemoKind } from './wizardDemo';
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

/** หน้าย้ายข้อมูล (?wizard=…): สร้างปลายทางจำลองครั้งเดียวต่อการโหลดหน้า */
let wizardRepo: ReturnType<typeof wizardDemoRepository> | null = null;
const wizardOnline = () => (wizardRepo ??= wizardDemoRepository(params.get('wizard') as WizardDemoKind));

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
    <AccountContext.Provider value={{ userId: 'dev-user', username: 'ผู้ทดสอบ', signOut: async () => undefined, refresh: async () => undefined }}>
      <PasswordPromptProvider>
        {params.get('wizard') !== null ? (
          <MigrationWizard userId="harness" online={wizardOnline()} mode="migrate" onDone={() => undefined} />
        ) : params.get('investDemo') === 'rebal' || params.get('investDemo') === 'rebal-empty' || params.get('investDemo') === 'rebal-baht' ? (
          <RepositoryProvider repository={rebalanceDemoRepository(params.get('investDemo') as RebalanceDemoKind)}>
            <App />
          </RepositoryProvider>
        ) : params.get('investDemo') === 'cat' ? (
          <RepositoryProvider repository={categoriesDemoRepository()}>
            <App />
          </RepositoryProvider>
        ) : params.get('investDemo') === '1' || params.get('investDemo') === 'report' || params.get('investDemo') === 'norate' || params.get('investDemo') === 'cash' || params.get('investDemo') === 'cashneg' || params.get('investDemo') === 'tx' || params.get('investDemo') === 'txthb' ? (
          <RepositoryProvider repository={params.get('investDemo') === 'report' ? { ...localLedgerRepository(), loadInvestments: () => Promise.resolve(demoInvestmentsWithHistory()) } : params.get('investDemo') === 'norate' ? { ...localLedgerRepository(), loadInvestments: () => Promise.resolve(demoInvestmentsNoRate()) } : params.get('investDemo') === 'cash' || params.get('investDemo') === 'cashneg' ? cashDemoRepository(params.get('investDemo') === 'cashneg') : params.get('investDemo') === 'tx' ? txRepository() : params.get('investDemo') === 'txthb' ? txRepository(true) : demoRepository()}>
            <App />
          </RepositoryProvider>
        ) : params.get('importRetry') !== null ? (
          <RepositoryProvider repository={importRetryRepository((params.get('importRetry') ?? '').split(','))}>
            <App />
          </RepositoryProvider>
        ) : params.get('importCategories') !== null ? (
          <RepositoryProvider repository={importDemoRepository(Number(params.get('importCategories')))}>
            <App />
          </RepositoryProvider>
        ) : (
          <App />
        )}
      </PasswordPromptProvider>
    </AccountContext.Provider>
  );
}

/**
 * ปุ่มลองนำเข้าข้อมูลลงทุนอีกครั้ง (?importRetry=ผลของแต่ละรอบ: fail | lost | ok · รอบแรกใช้ unconfirmed = สมุดเข้าแต่ยืนยันผลไม่ได้ · unconfirmed-empty = ไม่ได้เข้า · unconfirmed-wrong = เข้าแต่เนื้อหาไม่ตรง) · สมุดบัญชีเข้าที่เก็บในเครื่องจริง ขั้นลงทุนจำลอง
 * ?online=empty|match|different|error|late|oldcats ผลการอ่านข้อมูลลงทุนก่อนลองใหม่ (late = ว่างครั้งแรก แล้วตรง) · ?verify=fail ตรวจยอดล้มหนึ่งครั้งหลังลองสำเร็จ · verify=firstfail ตรวจยอดล้มหนึ่งครั้งหลังนำเข้ารอบแรก · twice = ล้มสองครั้ง · account = บัญชีเปลี่ยนตอนตรวจยอด · ?importCategories=N หมวดค้างตอนลองใหม่ · ?readDelay=ms
 */
let retryDemo: ReturnType<typeof localLedgerRepository> | null = null;
function importRetryRepository(outcomes: string[]) {
  if (retryDemo) return retryDemo;
  const local = localLedgerRepository();
  let file: InvestmentData = emptyInvestments();
  let failed = false;
  let saved = false;
  let reads = 0;
  let breakVerify = 0;
  const step = () => {
    const outcome = outcomes.shift() ?? 'ok';
    if (outcome === 'ok') return;
    failed = true;
    throw new InvestmentImportError(
      outcome === 'lost' ? 'นำเข้าสมุดบัญชีสำเร็จแล้ว แต่ยืนยันผลไม่ได้ว่าข้อมูลลงทุนเข้าหรือไม่ (การเชื่อมต่อมีปัญหา)' : 'นำเข้าสมุดบัญชีสำเร็จแล้ว แต่นำเข้าข้อมูลลงทุนไม่สำเร็จ (จำลอง) ข้อมูลลงทุนยังไม่เข้า (ไม่ได้เข้าครึ่งเดียว)',
      outcome === 'lost' ? 'unknown' : 'not_saved',
    );
  };
  retryDemo = {
    ...local,
    loadLedger: () => {
      if (breakVerify === 0) return local.loadLedger();
      breakVerify -= 1;
      return Promise.reject(new Error('จำลอง: อ่านไม่ได้'));
    },
    confirmSameAccount: () => (params.get('verify') === 'account' ? Promise.reject(new AccountChangedError('บัญชีที่เข้าสู่ระบบเปลี่ยนไป (จำลอง)')) : Promise.resolve()),
    countCategories: () => Promise.resolve(failed ? Number(params.get('importCategories') ?? 0) : 0),
    importBackup: async ({ investments, ...data }, onProgress) => {
      file = investments ?? emptyInvestments();
      const unconfirmed = () => new ImportUnconfirmedError('ยืนยันผลไม่ได้ว่านำเข้าสมุดบัญชีครบหรือไม่ (จำลอง)');
      if (outcomes[0] === 'unconfirmed-empty') {
        failed = true;
        throw unconfirmed();
      }
      if (outcomes[0] === 'unconfirmed-wrong') {
        failed = true;
        await local.importBackup({ ...data, entries: data.entries.map((e) => ({ ...e, memo: 'ต่างจากไฟล์ (จำลอง)' })) });
        throw unconfirmed();
      }
      const counts = await local.importBackup(data, onProgress);
      const verify = params.get('verify');
      if (verify === 'firstfail' || verify === 'twice' || verify === 'account') {
        saved = true; // ข้อมูลลงทุนเข้าครบในรอบแรก
        failed = true;
        if (verify !== 'account') breakVerify = verify === 'twice' ? 2 : 1;
      }
      if (outcomes[0] === 'unconfirmed') {
        outcomes.shift();
        failed = true;
        throw unconfirmed();
      }
      step();
      return counts;
    },
    loadInvestments: async () => {
      if (!failed) return emptyInvestments();
      await new Promise((resolve) => window.setTimeout(resolve, Number(params.get('readDelay') ?? 0)));
      const online = params.get('online');
      // gone=1: บันทึกแล้วแต่ถูกล้างจากที่อื่น
      if ((saved && params.get('gone') !== '1') || (online === 'late' && reads++ > 0)) return file;
      if (online === 'oldcats') return { ...emptyInvestments(), categories: [{ id: 'old', name: 'หมวดเก่า (สมมติ)', targetBps: null, sortOrder: 0 }] };
      if (online === 'error') throw new Error('จำลอง: อ่านไม่ได้');
      if (online === 'match') return file;
      if (online === 'different') return { ...file, assets: file.assets.map((a) => ({ ...a, name: a.name + ' (ต่าง)' })) };
      return emptyInvestments();
    },
    retryImportInvestments: async (_investments, options) => {
      const w = window as unknown as { __retryCalls?: unknown[] };
      (w.__retryCalls ??= []).push(options ?? null);
      step();
      saved = true;
      breakVerify = params.get('verify') === 'fail' ? 1 : breakVerify;
    },
  };
  return retryDemo;
}

/** นำเข้าไฟล์สำรองเมื่อ "มีหมวดเดิม" (?importCategories=N) · จดตัวเลือกที่หน้าจอส่งมาให้ e2e ตรวจ */
let importDemo: ReturnType<typeof localLedgerRepository> | null = null;
function importDemoRepository(count: number) {
  if (importDemo) return importDemo;
  const local = localLedgerRepository();
  importDemo = {
    ...local,
    countCategories: () => new Promise<number>((resolve) => window.setTimeout(() => resolve(count), Number(params.get('countDelay') ?? 0))),
    importBackup: (data, onProgress, options) => {
      const w = window as unknown as { __importOptions?: unknown[] };
      (w.__importOptions ??= []).push(options ?? null);
      return local.importBackup(data, onProgress);
    },
  };
  return importDemo;
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
    // ลบสินทรัพย์สมมติ: ฐานข้อมูลจริงปฏิเสธเมื่อยังมีรายการ (ที่นี่ทำแบบเดียวกันเพื่อให้ทดสอบหน้าจอได้ตรง)
    deleteAsset: (id: string) => {
      if (demo.trades.some((t) => t.assetId === id)) return Promise.reject(new Error('asset still has transactions'));
      demo.assets = demo.assets.filter((a) => a.id !== id);
      return Promise.resolve();
    },
  };
}

/** ที่เก็บสมมติของหน้า Transactions (?investDemo=tx): ข้อมูลลงทุน + บัญชี/รายการสมุดเพิ่ม · ลบ trade/แลกเงิน/รายการสมุดสมมติได้ในหน่วยความจำ (ไม่เขียนฐานข้อมูล) */
const txRepos: { plain?: ReturnType<typeof makeTxRepository>; thai?: ReturnType<typeof makeTxRepository> } = {};
const txRepository = (thai = false) => (thai ? (txRepos.thai ??= makeTxRepository(true)) : (txRepos.plain ??= makeTxRepository(false)));
function makeTxRepository(thai: boolean) {
  const base = localLedgerRepository();
  const demo = thai ? demoTransactionsDataWithThai() : demoTransactionsData();
  const extra = demoTransactionsLedger();
  const gone = new Set<string>();
  return {
    ...base,
    loadInvestments: () => Promise.resolve({ ...demo, trades: [...demo.trades], fxExchanges: [...(demo.fxExchanges ?? [])] }),
    loadLedger: async () => {
      const l = await base.loadLedger();
      const wallet = l.accounts.find((a) => a.type === 'asset' && a.kind !== 'investment')?.id ?? '';
      const add = extra.entries.filter((e) => !gone.has(e.id)).map((e) => ({ ...e, lines: e.lines.map((x) => (x.accountId === 'WALLET' ? { ...x, accountId: wallet } : x)) }));
      return { accounts: [...l.accounts, ...(extra.accounts as typeof l.accounts)], entries: [...l.entries, ...(add as typeof l.entries)] };
    },
    deleteTrade: (id: string) => {
      demo.trades = demo.trades.filter((t) => t.id !== id);
      return Promise.resolve();
    },
    deleteFxExchange: (id: string) => {
      demo.fxExchanges = (demo.fxExchanges ?? []).filter((x) => x.id !== id);
      return Promise.resolve();
    },
    // แก้รายการสมมติในหน่วยความจำ (กติกาจริงตรวจที่ฟอร์มด้วย previewTradeEdit ก่อนถึงตรงนี้ · ฐานข้อมูลจริงทดสอบด้วย live-contract)
    replaceTrade: ({ oldId, trade }: { oldId: string; trade: TradeRecord }) => {
      // ?replaceFail=1 จำลองการบันทึกล้ม (ข้อมูลเปลี่ยนระหว่างแก้) เพื่อทดสอบหน้าจอ
      if (new URLSearchParams(window.location.search).get('replaceFail') === '1') return Promise.reject(new Error('simulated save failure'));
      const old = demo.trades.find((t) => t.id === oldId);
      if (!old) return Promise.reject(new Error('missing'));
      const next = editedTradeOf(old, trade);
      demo.trades = demo.trades.map((t) => (t.id === oldId ? next : t));
      return Promise.resolve(next);
    },
    deleteEntry: (id: string) => {
      if (extra.entries.some((e) => e.id === id)) {
        gone.add(id);
        return Promise.resolve(extra.entries.find((e) => e.id === id) as never);
      }
      return base.deleteEntry(id);
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
