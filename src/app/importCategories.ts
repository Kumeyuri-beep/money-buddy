/** ข้อความยืนยันก่อนลบหมวดเดิมตอนนำเข้าไฟล์สำรอง (existing = ของเดิมที่จะถูกลบ · incoming = หมวดในไฟล์) */
export function categoryReplaceWarning(existing: number, incoming: number): string {
  return incoming > 0
    ? `พบหมวดเดิม ${existing} หมวด จะถูกลบและแทนด้วยหมวดจากไฟล์สำรอง ${incoming} หมวด`
    : `พบหมวดเดิม ${existing} หมวด จะถูกลบ ไฟล์สำรองไม่มีหมวด หลังนำเข้าจะไม่มีหมวดเลย`;
}
