import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToolsPanel } from '../../src/ui/overview/ToolsPanel';

const noop = (): void => undefined;
const html = renderToString(createElement(ToolsPanel, { onOpenPortfolio: noop, onOpenAveraging: noop, onOpenRetirement: noop, onOpenTax: noop }));

describe('ToolsPanel (เครื่องมือวางแผน บนหน้าภาพรวม)', () => {
  it('มีหัวข้อและลัดครบ 4 เครื่องมือ: พอร์ต ถัวเฉลี่ย แผนเกษียณ ภาษี', () => {
    expect(html).toContain('เครื่องมือวางแผน');
    for (const t of ['พอร์ตการลงทุน', 'ถัวเฉลี่ยต้นทุน', 'แผนเกษียณ', 'คำนวณภาษี']) expect(html).toContain(t);
    expect(html.match(/<button type="button" class="tool-tile"/g)).toHaveLength(4);
  });
  it('ผูก aria-labelledby กับหัวข้อ และใช้ glass-lite (ไม่ใช่กระจกแท้)', () => {
    expect(html).toContain('aria-labelledby="tools-title"');
    expect(html).toContain('id="tools-title"');
    expect(html).toContain('glass-lite');
  });
  it('เครื่องมือที่ให้ผลเป็นประมาณการบอกคำว่า ประมาณการ และไม่มีตัวเลขเงิน', () => {
    expect(html.match(/ประมาณการ/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/฿|\d{3,}/);
  });
  it('ไม่มีคำชวนซื้อ/สื่อรับประกัน', () => {
    for (const w of ['ควรซื้อ', 'รีบ', 'คุ้ม', 'ประหยัดภาษี', 'แน่นอน', 'รับประกัน', 'การันตี']) expect(html).not.toContain(w);
  });
});

describe('ToolsPanel: คลิกแล้วเรียก handler ที่ถูกต้อง', () => {
  it('ทุกปุ่มเรียกเฉพาะ handler ของตัวเอง', () => {
    const fns = { onOpenPortfolio: vi.fn(), onOpenAveraging: vi.fn(), onOpenRetirement: vi.fn(), onOpenTax: vi.fn() };
    const tree = ToolsPanel(fns) as unknown as { props: { children: unknown[] } };
    const ul = (tree.props.children as { props?: { children?: unknown } }[]).find((c) => c && typeof c === 'object' && 'props' in c && (c as { type?: string }).type === 'ul') as { props: { children: { props: { children: { props: { onClick: () => void } } } }[] } };
    const clicks = ul.props.children.map((li) => li.props.children.props.onClick);
    expect(clicks).toHaveLength(4);
    clicks.forEach((c) => c());
    for (const f of Object.values(fns)) expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('Today ใช้ ToolsPanel และไม่มีแผงเกษียณซ้ำ', () => {
  const today = Object.values(import.meta.glob('/src/ui/Today.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  const app = Object.values(import.meta.glob('/src/ui/App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  it('Today รับ handler ครบ และ App ส่ง averaging/tax ไปหน้าที่ถูกต้อง', () => {
    expect(today).toContain('<ToolsPanel');
    expect(today).not.toContain('RetirementPanel');
    expect(app).toContain("onOpenAveraging={() => setView('averaging')}");
    expect(app).toContain("onOpenTax={() => setView('tax')}");
  });
});
