import { describe, expect, it } from 'vitest';
import { passwordProblem } from '../../src/domain/auth/credentials';
import { adminEnvPath, generateTempPassword, isInsideDir, redact } from '../../scripts/lib/adminEnv.mjs';
import { findSecretKeys } from '../../scripts/lib/distScan.mjs';

describe('adminEnvPath / isInsideDir (ไฟล์ key ต้องอยู่นอกโปรเจกต์)', () => {
  it('ต่อพาธไฟล์ key จากโฟลเดอร์บ้าน', () => {
    expect(adminEnvPath('C:\\Users\\owenn')).toBe('C:\\Users\\owenn/.money-buddy-admin/admin.env');
    expect(adminEnvPath('/home/x/', '/')).toBe('/home/x/.money-buddy-admin/admin.env');
  });
  const project = 'C:\\Users\\owenn\\Documents\\money-buddy';
  it('ไฟล์ key นอกโปรเจกต์ = ไม่อยู่ข้างใน', () => {
    expect(isInsideDir('C:\\Users\\owenn\\.money-buddy-admin\\admin.env', project)).toBe(false);
  });
  it('ไฟล์ในโปรเจกต์ (รวมโฟลเดอร์ย่อย ตัวพิมพ์/ทิศทางทับต่างกัน) = อยู่ข้างใน', () => {
    expect(isInsideDir('C:\\Users\\owenn\\Documents\\money-buddy\\.env', project)).toBe(true);
    expect(isInsideDir('c:/users/OWEN/documents/money-buddy/a/b/admin.env'.replace('OWEN', 'owenn'), project)).toBe(true);
    expect(isInsideDir(project, project)).toBe(true);
    expect(isInsideDir(`${project}\\`, project)).toBe(true);
  });
  it('โฟลเดอร์พี่น้องที่ชื่อขึ้นต้นเหมือนกันไม่ใช่ข้างใน', () => {
    expect(isInsideDir('C:\\Users\\owenn\\Documents\\money-buddy-2\\x', project)).toBe(false);
    expect(isInsideDir('C:\\Users\\owenn\\Documents', project)).toBe(false);
  });
});

describe('redact', () => {
  it('ปิดบังความลับทุกตำแหน่ง', () => {
    expect(redact('key=abcdefgh1234 and abcdefgh1234!', ['abcdefgh1234'])).toBe('key=*** and ***!');
  });
  it('ข้ามค่าว่าง/สั้นเกิน/ไม่ใช่ข้อความ (กันแทนที่ทั้งข้อความ)', () => {
    expect(redact('hello world', ['', 'o', undefined])).toBe('hello world');
  });
});

describe('generateTempPassword', () => {
  const AMBIGUOUS = /[0O1lI]/;
  it('ยาว 16 ตัว มีตัวพิมพ์ใหญ่ เล็ก ตัวเลข ไม่มีตัวอักษรสับสน ผ่านกฎรหัสผ่านของเว็บ', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[!@#$%&*?_+=-]/); // สัญลักษณ์ครบ 4 ชนิดเสมอ
      expect(p).not.toMatch(AMBIGUOUS);
      expect(passwordProblem(p, 'someuser')).toBeNull();
    }
  });
  it('สุ่มจริง: 100 ครั้งไม่ซ้ำกัน', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateTempPassword()));
    expect(set.size).toBe(100);
  });
  it('ใช้ตัวสุ่มที่ฉีดเข้ามา และปัดทิ้งไบต์ที่ทำให้การกระจายเอียง (rejection sampling)', () => {
    // ไบต์ 0..255 วนซ้ำ ผลต้องเกิดจากไบต์ที่ต่ำกว่าขีดจำกัดเท่านั้น
    let n = 0;
    const fill = (b: Uint8Array) => {
      for (let i = 0; i < b.length; i++) b[i] = (n++ * 37) % 256; // กระโดดข้าม ให้ได้ตัวอักษรหลายชนิด
      return b;
    };
    const p = generateTempPassword(fill);
    expect(p).toHaveLength(16);
    expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9!@#$%&*?_+=-]+$/);
  });
  it('ตัวสุ่มเสีย (ได้แต่ไบต์ที่ถูกปัดทิ้ง) ต้องล้มไม่วนไม่รู้จบ', () => {
    expect(() => generateTempPassword((b) => b.fill(255))).toThrow();
  });
  it('ตัวสุ่มที่ได้แต่ตัวอักษรชนิดเดียวไม่ผ่านเกณฑ์ชนิดตัวอักษร ต้องล้ม', () => {
    expect(() => generateTempPassword((b) => b.fill(0))).toThrow();
  });
});

describe('findSecretKeys (ตรวจ dist/ ตามรูปแบบ key จริง ไม่ใช่แค่คำ)', () => {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = (payload: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${'s'.repeat(20)}`;

  it('พบ secret key แบบใหม่ (sb_secret_ ตามด้วยอักขระยาว)', () => {
    expect(findSecretKeys(`const k="sb_secret_${'A1b2'.repeat(8)}";`)).toEqual(['sb_secret']);
  });
  it('ไม่ฟ้องโค้ดตรวจ prefix ของไลบรารีเอง (sb_secret_ สั้น)', () => {
    expect(findSecretKeys('e=>e.startsWith(`sb_publishable_`)||e.startsWith(`sb_secret_`)')).toEqual([]);
    expect(findSecretKeys('sb_secret_')).toEqual([]);
  });
  it('publishable key ยาวๆ ไม่ใช่ความลับ', () => {
    expect(findSecretKeys(`sb_publishable_${'Z9y8'.repeat(8)}`)).toEqual([]);
  });
  it('พบ JWT ที่ payload เป็น role service_role', () => {
    expect(findSecretKeys(`x="${jwt({ iss: 'supabase', role: 'service_role' })}"`)).toEqual(['jwt-service-role']);
  });
  it('JWT ของ anon (เปิดเผยได้) ไม่ถูกฟ้อง', () => {
    expect(findSecretKeys(`x="${jwt({ iss: 'supabase', role: 'anon' })}"`)).toEqual([]);
  });
  it('สตริงคล้าย JWT แต่ไม่ใช่ (decode ไม่ได้) ไม่ทำให้ล้ม', () => {
    expect(findSecretKeys('eyJhbGciOiJIUzI1NiJ9.eyJ!!!notbase64!!!.abcdefghijkl')).toEqual([]);
    expect(findSecretKeys('')).toEqual([]);
  });
  it('พบทั้งสองชนิดในข้อความเดียว', () => {
    const text = `a="sb_secret_${'Q'.repeat(30)}" b="${jwt({ role: 'service_role' })}"`;
    expect(findSecretKeys(text).sort()).toEqual(['jwt-service-role', 'sb_secret']);
  });
});
