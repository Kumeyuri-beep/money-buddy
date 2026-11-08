import { useEffect, useState } from 'react';
import { msUntilNextThaiMidnight, thaiIsoDate } from '../app/dates';

/** ตรวจซ้ำอย่างน้อยทุก 60 วินาที (คำทักทายเปลี่ยนตามชั่วโมง) */
const TICK_MS = 60_000;
/** เผื่อเวลาให้ timer ยิงหลังเที่ยงคืนไทยจริงเสมอ */
const MIDNIGHT_SLACK_MS = 1_000;

/**
 * เวลาปัจจุบัน (Date) ที่รีเฟรชเอง: ทุกนาที เมื่อกลับมาเปิดแท็บ/หน้าต่าง และทันทีหลังข้ามเที่ยงคืนไทย
 * ใช้กับคำทักทายและวันที่หัวหน้า
 */
export function useThaiNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const interval = window.setInterval(refresh, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return now;
}

/**
 * "วันนี้" ตามเวลาไทย (YYYY-MM-DD) ที่อัปเดตเองเมื่อข้ามเที่ยงคืน หรือกลับมาเปิดแท็บ/หน้าต่างหลังพักไว้นาน
 * (timer ของแท็บที่พักอยู่อาจถูกเบราว์เซอร์หน่วง จึงตรวจซ้ำตอนกลับมาเปิดเสมอ) ค่าไม่เปลี่ยน = ไม่ render ซ้ำ
 */
export function useThaiToday(): string {
  const [today, setToday] = useState(() => thaiIsoDate());
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => setToday(thaiIsoDate());
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refresh();
        arm();
      }, msUntilNextThaiMidnight() + MIDNIGHT_SLACK_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        arm();
      }
    };
    arm();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
  return today;
}
