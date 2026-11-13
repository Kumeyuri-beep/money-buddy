/**
 * หลังลบรายการลงทุน ปุ่มลบหายไปพร้อมรายการ โฟกัสคีย์บอร์ดจะหลุดไป body (เจ้าของสั่ง 14 พ.ย. 2569)
 * เลือกว่าจะย้ายโฟกัสไปที่ใด: รายการถัดไป → ไม่มีก็รายการก่อนหน้า → ไม่มีเลย (null) = หัว "ประวัติรายการ"
 * ฟังก์ชันล้วน · รับรหัสรายการตามลำดับที่แสดง
 */
export function nextFocusAfterDelete(orderedIds: readonly string[], deletedId: string): string | null {
  const i = orderedIds.indexOf(deletedId);
  if (i < 0) return null;
  return orderedIds[i + 1] ?? orderedIds[i - 1] ?? null;
}
