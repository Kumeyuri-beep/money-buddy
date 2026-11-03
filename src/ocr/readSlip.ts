/**
 * อ่านข้อความจากรูปสลิปบนเครื่องผู้ใช้ด้วย Tesseract (ไทย + อังกฤษ)
 *
 * - โหลด Tesseract เฉพาะตอนเรียกฟังก์ชันนี้ (dynamic import) หน้าแรกจึงไม่ช้า
 * - ตัวอ่านและไฟล์ภาษาอยู่ใน public/ocr/ ของเราเอง (scripts/copy-ocr-assets.mjs) ไม่เรียก CDN ภายนอก
 * - รูปไม่ถูกส่งออกนอกเครื่อง และไม่ถูกเก็บ: ย่อบน canvas ชั่วคราว อ่านเสร็จแล้วล้าง canvas และปิด worker เสมอ
 * - ตัวนี้แค่คืน "ข้อความ" ให้ src/app/slipParser.ts ไปตีความ ไม่มีสูตรเงินที่นี่
 */

import { fitWithin, validateSlipFile } from '../app/slipImage';

export class SlipOcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipOcrError';
  }
}

export interface ReadSlipOptions {
  /** ความคืบหน้า 0..1 (สถานะข้อความ เช่น "กำลังอ่านรูป") */
  onProgress?: (progress: number, status: string) => void;
}

function ocrUrl(path: string): string {
  return `${import.meta.env.BASE_URL}ocr/${path}`;
}

/** ย่อรูปให้ด้านยาวไม่เกิน 1600px บน canvas ชั่วคราว (คืน canvas ที่ผู้เรียกต้องล้างเอง) */
async function drawFitted(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new SlipOcrError('เปิดรูปนี้ไม่ได้ ลองแคปหน้าจอสลิปใหม่เป็น PNG หรือ JPEG');
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new SlipOcrError('เบราว์เซอร์นี้ประมวลผลรูปไม่ได้');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** อ่านข้อความจากรูปสลิป โยน SlipOcrError (ข้อความภาษาไทย) เมื่อทำไม่ได้ */
export async function readSlipImage(file: File | Blob, options: ReadSlipOptions = {}): Promise<string> {
  const check = validateSlipFile(file);
  if (!check.ok) throw new SlipOcrError(check.message);

  options.onProgress?.(0, 'กำลังเตรียมรูป');
  const canvas = await drawFitted(file);
  let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | undefined;
  try {
    let tesseract: typeof import('tesseract.js');
    try {
      tesseract = await import('tesseract.js');
    } catch {
      throw new SlipOcrError('โหลดตัวอ่านสลิปไม่สำเร็จ ลองรีเฟรชหน้าแล้วสแกนใหม่');
    }
    try {
      worker = await tesseract.createWorker(['tha', 'eng'], tesseract.OEM.LSTM_ONLY, {
        workerPath: ocrUrl('worker.min.js'),
        corePath: ocrUrl('core'),
        langPath: ocrUrl('lang'),
        gzip: true,
        logger: (m) => options.onProgress?.(m.progress, m.status),
      });
    } catch {
      throw new SlipOcrError('โหลดไฟล์ภาษาสำหรับอ่านสลิปไม่สำเร็จ ลองรีเฟรชหน้าแล้วสแกนใหม่');
    }
    const result = await worker.recognize(canvas);
    return result.data.text;
  } finally {
    // ไม่เก็บรูป: ล้าง canvas และปิด worker (ปล่อยหน่วยความจำของตัวอ่าน)
    canvas.width = 0;
    canvas.height = 0;
    if (worker) await worker.terminate();
  }
}
