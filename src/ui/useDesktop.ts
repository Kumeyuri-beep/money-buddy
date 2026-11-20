import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

/** จอคอม (≥1024px) ตามกติกา "คอมก่อน มือถือห้ามเปลี่ยนหน้าตา" · ใช้เมื่อพฤติกรรมต้องต่างตามความกว้างจอ (CSS อย่างเดียวไม่พอ) */
export function useDesktop(): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}
