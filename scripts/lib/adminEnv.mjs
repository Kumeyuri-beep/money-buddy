// ตัวช่วยล้วน (ไม่แตะไฟล์/เครือข่าย) ของสคริปต์ผู้ดูแล · ทดสอบใน tests/unit/adminScripts.test.ts

/** ไฟล์ key ของผู้ดูแลอยู่ "นอกโปรเจกต์" เท่านั้น: <โฟลเดอร์บ้าน>/.money-buddy-admin/admin.env */
export const ADMIN_DIR_NAME = '.money-buddy-admin';
export const ADMIN_FILE_NAME = 'admin.env';

export function adminEnvPath(home, sep = '/') {
  return `${String(home).replace(/[\\/]+$/, '')}${sep}${ADMIN_DIR_NAME}${sep}${ADMIN_FILE_NAME}`;
}

function normalizePath(p) {
  // ไม่สนตัวพิมพ์/ทิศทางทับ (Windows) · เกินดีกว่าขาด: ถ้าไม่แน่ใจให้ถือว่าอยู่ข้างใน
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** child อยู่ใน parent (หรือเป็นที่เดียวกัน) ไหม */
export function isInsideDir(child, parent) {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** ปิดบังความลับในข้อความก่อนแสดง (กัน error ของไลบรารีพา key ออกมา) */
export function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('***');
  }
  return out;
}

// ตัดตัวอักษรที่สับสนง่าย (0/O, 1/l/I) ออก เพราะเจ้าของต้องส่งรหัสให้ผู้ใช้ทางข้อความ
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const ALPHABET = UPPER + LOWER + DIGIT;

/**
 * รหัสผ่านชั่วคราวสุ่ม 16 ตัว (ตัวพิมพ์ใหญ่ เล็ก และตัวเลขอย่างละอย่างน้อย 1) ด้วย CSPRNG
 * ใช้ rejection sampling เพื่อไม่ให้การกระจายเอียง · fill ฉีดได้เพื่อทดสอบ
 */
export function generateTempPassword(fill = (bytes) => globalThis.crypto.getRandomValues(bytes), length = 16) {
  const limit = 256 - (256 % ALPHABET.length);
  for (let attempt = 0; attempt < 200; attempt++) {
    let out = '';
    for (let round = 0; out.length < length && round < 1000; round++) {
      const bytes = fill(new Uint8Array(32));
      for (const b of bytes) {
        if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
      }
    }
    if (out.length < length) throw new Error('ตัวสุ่มให้ข้อมูลไม่พอ');
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[0-9]/.test(out)) return out;
  }
  throw new Error('สุ่มรหัสผ่านชั่วคราวไม่สำเร็จ');
}
