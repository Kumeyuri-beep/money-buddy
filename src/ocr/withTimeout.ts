/**
 * ให้ promise มีเวลาหมดอายุ: ช้าเกิน ms มิลลิวินาทีให้ reject ด้วย error ที่ onTimeout สร้าง
 * ล้างตัวจับเวลาเมื่องานเสร็จ และไม่ให้การล้มของงานหลังหมดเวลาแล้วกลายเป็น unhandled rejection
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
