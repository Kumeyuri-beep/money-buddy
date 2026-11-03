// คัดลอกตัวอ่านรูป (Tesseract) และไฟล์ภาษาจาก node_modules ไปที่ public/ocr/
// เพื่อให้แอปโหลดจากโปรเจกต์ของเราเอง ไม่เรียก CDN ภายนอก (รูปสลิปไม่ออกนอกเครื่อง และใช้ออฟไลน์ได้)
// รันอัตโนมัติก่อน npm run dev / build (public/ocr อยู่ใน .gitignore)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');

// ใช้ชุด LSTM เท่านั้น (3 รุ่นให้เบราว์เซอร์เลือกตามความสามารถของ CPU) ไม่ต้องใช้ชุด legacy
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz', 'lang/tha.traineddata.gz'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];

for (const [from, to] of files) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.error(`copy-ocr-assets: ไม่พบ ${from} (รัน npm install ก่อน)`);
    process.exit(1);
  }
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
console.log(`copy-ocr-assets: คัดลอก ${files.length} ไฟล์ไปที่ public/ocr/`);
