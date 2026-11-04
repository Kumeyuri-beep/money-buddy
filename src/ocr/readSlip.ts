/**
 * อ่านข้อความจากรูปสลิปบนเครื่องผู้ใช้ด้วย Tesseract (ไทย + อังกฤษ)
 *
 * - โหลด Tesseract เฉพาะตอนเรียกฟังก์ชันนี้ (dynamic import) หน้าแรกจึงไม่ช้า
 * - ตัวอ่านและไฟล์ภาษาอยู่ใน public/ocr/ ของเราเอง (scripts/copy-ocr-assets.mjs) ไม่เรียก CDN ภายนอก
 * - รูปไม่ถูกส่งออกนอกเครื่อง และไม่ถูกเก็บ: วาดบน canvas ชั่วคราว อ่านเสร็จแล้วล้าง canvas และปิด worker เสมอ
 * - อ่าน 2 รอบด้วยวิธีเตรียมรูปต่างกัน (ทดลองกับสลิปจริงแล้ว ไม่มีวิธีเดียวที่อ่านเดือน/ยอดได้ทุกใบ)
 *     รอบ A: ขยาย 2 เท่า + ขาวดำสนิท (Otsu) · รอบ B: ขยาย 2 เท่า + เทายืดคอนทราสต์ + โหมดข้อความกระจาย
 *   แล้วคืนข้อความของทุกรอบ ให้ src/app/slipParser.ts รวมผลทีละช่อง ตัวนี้ไม่มีสูตรเงิน
 */

import {
  binarizeOtsu,
  ocrSize,
  readImageSize,
  toGrayscale,
  validateSlipDimensions,
  validateSlipFile,
} from '../app/slipImage';
import { withTimeout } from './withTimeout';

/** อ่านหัวไฟล์แค่นี้เพื่อหาความกว้างยาว (JPEG ที่มี EXIF/รูปย่อใหญ่อาจมี SOF อยู่ไกล) */
const HEADER_BYTES = 1024 * 1024;
/** เวลาสูงสุดต่อการอ่านหนึ่งรอบ กันค้างไม่รู้จบ */
const OCR_TIMEOUT_MS = 60_000;

export class SlipOcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlipOcrError';
  }
}

/** preparing = เตรียมรูป · loading = โหลดตัวอ่าน/ไฟล์ภาษา (ครั้งแรกช้า) · reading = กำลังอ่านข้อความ */
export type SlipOcrPhase = 'preparing' | 'loading' | 'reading';

export interface ReadSlipOptions {
  /** ความคืบหน้า 0..1 ของขั้นนั้นๆ (ขั้น reading รวมทั้งสองรอบ) */
  onProgress?: (progress: number, phase: SlipOcrPhase) => void;
}

function ocrUrl(path: string): string {
  return `${import.meta.env.BASE_URL}ocr/${path}`;
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** วาดรูปลง canvas ขนาด ocrSize และคืนพิกเซล (ผู้เรียกต้องล้าง canvas เอง) */
async function drawScaled(file: Blob): Promise<{ canvas: HTMLCanvasElement; pixels: ImageData }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new SlipOcrError('เปิดรูปนี้ไม่ได้ ลองแคปหน้าจอสลิปใหม่เป็น PNG หรือ JPEG');
  }
  try {
    const { width, height } = ocrSize(bitmap.width, bitmap.height);
    const canvas = newCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new SlipOcrError('เบราว์เซอร์นี้ประมวลผลรูปไม่ได้');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { canvas, pixels: ctx.getImageData(0, 0, width, height) };
  } finally {
    bitmap.close();
  }
}

/** อ่านข้อความจากรูปสลิป คืนข้อความของแต่ละรอบ โยน SlipOcrError (ข้อความภาษาไทย) เมื่อทำไม่ได้ */
export async function readSlipImage(file: File | Blob, options: ReadSlipOptions = {}): Promise<string[]> {
  const check = validateSlipFile(file);
  if (!check.ok) throw new SlipOcrError(check.message);

  // กันรูปบอมบ์: ดูความกว้างยาวจากหัวไฟล์ก่อน createImageBitmap จะแตกรูปทั้งภาพในหน่วยความจำ
  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const dimensions = validateSlipDimensions(readImageSize(head));
  if (!dimensions.ok) throw new SlipOcrError(dimensions.message);

  options.onProgress?.(0, 'preparing');
  const { canvas: grayCanvas, pixels } = await drawScaled(file);
  const canvases = [grayCanvas];
  let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | undefined;
  try {
    // รอบ B ใช้ภาพเทายืดคอนทราสต์บน canvas เดิม รอบ A ใช้สำเนาที่แปลงเป็นขาวดำสนิท
    const { width, height } = pixels;
    const gray = new Uint8ClampedArray(pixels.data);
    toGrayscale(gray, true);
    const binary = new Uint8ClampedArray(gray);
    binarizeOtsu(binary);
    const binaryCanvas = newCanvas(width, height);
    canvases.push(binaryCanvas);
    binaryCanvas.getContext('2d')?.putImageData(new ImageData(binary, width, height), 0, 0);
    grayCanvas.getContext('2d')?.putImageData(new ImageData(gray, width, height), 0, 0);

    let tesseract: typeof import('tesseract.js');
    try {
      tesseract = await import('tesseract.js');
    } catch {
      throw new SlipOcrError('โหลดตัวอ่านสลิปไม่สำเร็จ ลองรีเฟรชหน้าแล้วสแกนใหม่');
    }
    let pass = 0;
    const passes = [
      { canvas: binaryCanvas, mode: tesseract.PSM.AUTO },
      { canvas: grayCanvas, mode: tesseract.PSM.SPARSE_TEXT },
    ];
    try {
      worker = await tesseract.createWorker(['tha', 'eng'], tesseract.OEM.LSTM_ONLY, {
        workerPath: ocrUrl('worker.min.js'),
        corePath: ocrUrl('core'),
        langPath: ocrUrl('lang'),
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text') options.onProgress?.((pass + m.progress) / passes.length, 'reading');
          else options.onProgress?.(m.progress, 'loading');
        },
      });
    } catch {
      throw new SlipOcrError('โหลดไฟล์ภาษาสำหรับอ่านสลิปไม่สำเร็จ ลองรีเฟรชหน้าแล้วสแกนใหม่');
    }

    const texts: string[] = [];
    for (const p of passes) {
      await worker.setParameters({ tessedit_pageseg_mode: p.mode });
      const result = await withTimeout(
        worker.recognize(p.canvas),
        OCR_TIMEOUT_MS,
        () => new SlipOcrError('อ่านสลิปนานเกินไป ลองรูปที่ชัดขึ้นหรือเล็กลง'),
      );
      texts.push(result.data.text);
      pass += 1;
    }
    return texts;
  } finally {
    // ไม่เก็บรูป: ล้าง canvas ทั้งหมดและปิด worker (ปล่อยหน่วยความจำของตัวอ่าน)
    for (const c of canvases) {
      c.width = 0;
      c.height = 0;
    }
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // ปิด worker ไม่สำเร็จ: ไม่ทับข้อผิดพลาดเดิมของการอ่าน
      }
    }
  }
}
