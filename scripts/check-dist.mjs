// ตรวจ dist/ หลัง build (รันอัตโนมัติผ่าน postbuild และใน CI): ห้ามมี key ระดับผู้ดูแลตัวจริงในไฟล์ที่จะเผยแพร่
// ใช้ได้โดยไม่ต้องมี key ใดๆ · ไม่พิมพ์ตัว key ออกมา (พิมพ์เฉพาะชื่อไฟล์กับชนิด)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findSecretKeys } from './lib/distScan.mjs';

const DIST = 'dist';
if (!existsSync(DIST)) {
  console.error('ไม่พบโฟลเดอร์ dist (ต้อง build ก่อน)');
  process.exit(2);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let found = 0;
let scanned = 0;
for (const file of walk(DIST)) {
  if (statSync(file).size > 50 * 1024 * 1024) {
    console.error(`ข้ามไฟล์ใหญ่เกิน 50MB: ${file}`);
    continue;
  }
  scanned++;
  // latin1: อ่านทุกไบต์ได้โดยไม่ตีความ UTF-8 (ตรวจไฟล์ไบนารีได้ด้วย key เป็น ASCII เสมอ)
  const kinds = findSecretKeys(readFileSync(file, 'latin1'));
  for (const kind of kinds) {
    found++;
    console.error(`พบ key ระดับผู้ดูแลใน ${file} (ชนิด ${kind}) หยุดการ build`);
  }
}
if (found > 0) process.exit(1);
console.log(`ตรวจ dist แล้ว ${scanned} ไฟล์ ไม่พบ key ระดับผู้ดูแล`);
