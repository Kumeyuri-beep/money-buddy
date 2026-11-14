import { formatBps } from '../domain/invest/allocation';
import type { AllocationModel } from '../app/allocationView';

/**
 * วาดการ์ดแชร์สัดส่วนพอร์ตลง canvas ในเครื่อง (ไม่มีเครือข่าย ไม่โหลดรูป/ฟอนต์จากภายนอกในไฟล์นี้)
 * เนื้อหาในรูป: ชื่อการ์ด · เกณฑ์ (มูลค่า/ต้นทุน) · วันที่ · แถบสัดส่วน · รายการ ป้ายชื่อ + เปอร์เซ็นต์ · หมายเหตุ "ไม่แสดงยอดเงิน"
 * ไม่มียอดเงิน จำนวนหน่วย หรือชื่อผู้ใช้ · ชื่อสินทรัพย์มาจาก model เท่านั้น (ซ่อนเป็นค่าเริ่มต้นที่ allocationView)
 */

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1350;
export const SLICE_COLORS = ['#f2d06b', '#6fd3c4', '#8fb4ff', '#ff9f7a', '#c59bff', '#7be0a1', '#ffcf8a'] as const;
export const OTHER_COLOR = '#8b90a5';
const FONT = `'IBM Plex Sans Thai', system-ui, sans-serif`;

/**
 * สีของการ์ดแชร์ (รูปที่ส่งออก) รวมไว้ที่เดียว (โหมดสว่าง เฟส 1 · 14 พ.ย. 2569): ตอนนี้ใช้ชุดมืดอย่างเดียว ค่าเดิมทุกตัว
 * เฟส 2 ตัดสินร่วมกับ design-critic ว่ารูปที่ส่งออกจะตามธีมหรือคงเป็นการ์ดแบรนด์สีมืดเสมอ
 */
export const SHARE_CARD_PALETTE = {
  bgTop: '#0f1117',
  bgBottom: '#1d2033',
  title: '#ffffff',
  subtitle: '#c9cde0',
  barGap: '#0f1117',
  label: '#ffffff',
  note: '#9fa4bb',
  brand: '#f2d06b',
} as const;

export const sliceColor = (index: number, isOther: boolean): string => (isOther ? OTHER_COLOR : SLICE_COLORS[index % SLICE_COLORS.length]!);

/** สี่เหลี่ยมมุมมน (เบราว์เซอร์เก่าที่ไม่มี roundRect ใช้สี่เหลี่ยมธรรมดา) */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** ตัดข้อความที่ยาวเกินด้วย … โดยตัดทีละ "กลุ่มอักษร" (ไม่ตัดกลางสระ/วรรณยุกต์ภาษาไทย) */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
  const parts = seg ? Array.from(seg.segment(text), (x) => x.segment) : Array.from(text);
  while (parts.length > 1 && ctx.measureText(`${parts.join('')}…`).width > maxWidth) parts.pop();
  return `${parts.join('')}…`;
}

export function drawShareCard(ctx: CanvasRenderingContext2D, model: AllocationModel, asOfLabel: string): void {
  const W = SHARE_CARD_WIDTH;
  const H = SHARE_CARD_HEIGHT;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, SHARE_CARD_PALETTE.bgTop);
  bg.addColorStop(1, SHARE_CARD_PALETTE.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE_CARD_PALETTE.title;
  ctx.font = `700 60px ${FONT}`;
  ctx.fillText('สัดส่วนพอร์ตการลงทุน', 72, 130);
  ctx.fillStyle = SHARE_CARD_PALETTE.subtitle;
  ctx.font = `400 32px ${FONT}`;
  ctx.fillText(`${model.basis === 'value' ? 'ตามมูลค่า (ราคาที่ผู้ใช้กรอก)' : 'ตามต้นทุน (ราคาที่ซื้อ)'} · ${asOfLabel}`, 72, 184);

  // แถบสัดส่วน (ความกว้างเป็นพิกเซลเพื่อวาดเท่านั้น ไม่ใช่ยอดเงิน)
  const barX = 72;
  const barY = 240;
  const barW = W - 144;
  const barH = 72;
  ctx.save();
  ctx.beginPath();
  rrect(ctx, barX, barY, barW, barH, 24);
  ctx.clip();
  let x = barX;
  model.slices.forEach((s, i) => {
    const w = (s.bps / 10_000) * barW;
    ctx.fillStyle = sliceColor(i, s.isOther);
    ctx.fillRect(x, barY, w + 1, barH);
    // เส้นคั่นระหว่างช่วง (ไม่ให้แยกสีอย่างเดียว)
    if (i > 0) {
      ctx.fillStyle = SHARE_CARD_PALETTE.barGap;
      ctx.fillRect(x - 1, barY, 2, barH);
    }
    x += w;
  });
  ctx.restore();

  // รายการ
  const rowTop = 400;
  const rowH = 100;
  model.slices.slice(0, 8).forEach((s, i) => {
    const y = rowTop + i * rowH;
    ctx.fillStyle = sliceColor(i, s.isOther);
    ctx.beginPath();
    rrect(ctx, 72, y - 34, 40, 40, 10);
    ctx.fill();
    ctx.fillStyle = SHARE_CARD_PALETTE.label;
    ctx.font = `400 42px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, s.label, 600), 136, y);
    ctx.font = `700 46px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(formatBps(s.bps), W - 72, y);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE_CARD_PALETTE.note;
  ctx.font = `400 34px ${FONT}`;
  ctx.fillText('แสดงเฉพาะสัดส่วน ไม่แสดงยอดเงิน', 72, H - 110);
  ctx.fillStyle = SHARE_CARD_PALETTE.brand;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText('Money Buddy', 72, H - 60);
}
