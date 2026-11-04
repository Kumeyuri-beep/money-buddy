/** ตรรกะของ ErrorBoundary ที่ไม่ผูกกับ DOM (ทดสอบได้ใน Vitest แบบ node) */

export interface ErrorBoundaryState {
  hasError: boolean;
}

export function getDerivedErrorState(): ErrorBoundaryState {
  return { hasError: true };
}

/** ขณะล้มอยู่ ถ้าผู้ใช้ย้ายไปหน้าอื่น (resetKey เปลี่ยน) ให้ลองแสดงหน้านั้นใหม่ */
export function shouldResetBoundary(hasError: boolean, prevKey: string, nextKey: string): boolean {
  return hasError && prevKey !== nextKey;
}
