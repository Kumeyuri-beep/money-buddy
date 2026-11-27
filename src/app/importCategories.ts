/** ข้อความยืนยันก่อนลบหมวดเดิมตอนนำเข้าไฟล์สำรอง (existing = ของเดิมที่จะถูกลบ · incoming = หมวดในไฟล์ · deleteOnly = ไม่มีอะไรเหลือให้นำเข้า) */
export function categoryReplaceWarning(existing: number, incoming: number, deleteOnly = false): string {
  return incoming > 0
    ? `พบหมวดเดิม ${existing} หมวด จะถูกลบและแทนด้วยหมวดจากไฟล์สำรอง ${incoming} หมวด`
    : `พบหมวดเดิม ${existing} หมวด จะถูกลบ ไฟล์สำรองไม่มีหมวด ${deleteOnly ? 'หลังลบแล้ว' : 'หลังนำเข้า'}จะไม่มีหมวดเลย`;
}
