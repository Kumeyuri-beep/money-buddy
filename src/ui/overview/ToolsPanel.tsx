/**
 * เครื่องมือวางแผน (glass-lite): ทางลัดจากหน้าภาพรวมไปพอร์ต ถัวเฉลี่ย แผนเกษียณ และภาษี
 * ไม่มีตัวเลขเงิน ไม่คำนวณอะไร (ห้ามมีสูตรเงินในคอมโพเนนต์) เครื่องมือที่ให้ผลเป็นประมาณการบอกคำว่า "ประมาณการ" ในคำอธิบาย
 */

export interface ToolsPanelProps {
  onOpenPortfolio: () => void;
  onOpenAveraging: () => void;
  onOpenRetirement: () => void;
  onOpenTax: () => void;
}

interface Tool {
  id: string;
  title: string;
  hint: string;
  open: () => void;
}

export function ToolsPanel({ onOpenPortfolio, onOpenAveraging, onOpenRetirement, onOpenTax }: ToolsPanelProps) {
  const tools: Tool[] = [
    { id: 'portfolio', title: 'พอร์ตการลงทุน', hint: 'ดูสินทรัพย์ ต้นทุน และกำไรขาดทุน', open: onOpenPortfolio },
    { id: 'averaging', title: 'ถัวเฉลี่ยต้นทุน', hint: 'คำนวณราคาเฉลี่ยเมื่อซื้อเพิ่ม', open: onOpenAveraging },
    { id: 'retirement', title: 'แผนเกษียณ', hint: 'ประมาณเงินที่ต้องมีและเงินเก็บต่อเดือน (ประมาณการ)', open: onOpenRetirement },
    { id: 'tax', title: 'คำนวณภาษี', hint: 'ประมาณภาษีเงินได้ประจำปีและค่าลดหย่อน (ประมาณการ)', open: onOpenTax },
  ];
  return (
    <section className="glass-lite card tools-panel" aria-labelledby="tools-title">
      <h2 id="tools-title">เครื่องมือวางแผน</h2>
      <ul className="tool-grid">
        {tools.map((t) => (
          <li key={t.id}>
            <button type="button" className="tool-tile" onClick={t.open}>
              <span className="tool-title">{t.title}</span>
              <span className="muted small">{t.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
