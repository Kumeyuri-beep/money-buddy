import { BillFormError } from './billForm';
import { StorageError } from '../storage/repository';

/** ข้อความผิดพลาดที่ผู้ใช้อ่านเข้าใจ: ใช้ข้อความไทยของแอปเอง ส่วนข้อผิดพลาดของระบบใช้ข้อความสำรอง */
export function friendlyError(error: unknown): string {
  if (error instanceof BillFormError || error instanceof StorageError) return error.message;
  return 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง';
}
