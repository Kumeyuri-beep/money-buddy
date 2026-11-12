/**
 * คืนโฟกัสให้ปุ่มที่เปิด dialog เมื่อ dialog ปิด (ใช้ในทุก dialog)
 * ถ้าปุ่มนั้นหายไปแล้ว (หน้าเรนเดอร์แถวใหม่หลังบันทึก) หรือไม่มีปุ่มเปิด (เปิดจากการวางรูป/ลากไฟล์ จึงโฟกัสอยู่ที่ body)
 * ให้ไปที่เนื้อหาหลัก (#main) แทน ไม่ปล่อยให้โฟกัสหลุดไป body จนคีย์บอร์ดต้อง Tab จากบนสุดใหม่
 */
export function restoreFocus(opener: HTMLElement | null): void {
  if (opener && opener !== document.body && opener.isConnected) {
    opener.focus();
    return;
  }
  document.getElementById('main')?.focus();
}
