// ตรวจว่าไฟล์ที่ build แล้ว (dist/) มี key ระดับผู้ดูแล "ตัวจริง" หลุดเข้าไปไหม
// ไม่ตรวจแค่คำ: bundle ของ supabase-js มีสตริง sb_secret_ อยู่เองในโค้ดตรวจ prefix จึงต้องดูรูปแบบ key จริง
// คืนเฉพาะ "ชนิด" ที่พบ ไม่คืนตัว key (กันความลับไปโผล่ในผลลัพธ์/ล็อก)

const SB_SECRET = /sb_secret_[A-Za-z0-9_-]{20,}/;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function decodeBase64Url(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return globalThis.atob(padded);
}

export function findSecretKeys(text) {
  const kinds = new Set();
  if (SB_SECRET.test(text)) kinds.add('sb_secret');
  for (const match of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(decodeBase64Url(match[1] ?? ''));
      if (payload && typeof payload === 'object' && payload.role === 'service_role') kinds.add('jwt-service-role');
    } catch {
      /* ไม่ใช่ JWT จริง ข้าม */
    }
  }
  return [...kinds];
}
