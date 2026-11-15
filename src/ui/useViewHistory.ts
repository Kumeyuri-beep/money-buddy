import { useEffect } from 'react';
import { urlForView, viewFromLocation, type RouteView } from '../app/route';

const VIEWS: readonly RouteView[] = ['today', 'ledger', 'bills', 'account', 'averaging', 'portfolio', 'retirement', 'tax'];
const isView = (v: unknown): v is RouteView => typeof v === 'string' && (VIEWS as readonly string[]).includes(v);

/** หน้าเริ่มต้นของแอป: URL ที่ระบุหน้าเฉพาะ (/invest /tax) ก่อน · ไม่มีก็ใช้หน้าที่เก็บใน history.state (รีเฟรช/ย้อนกลับ) · ไม่มีเลย = ภาพรวม */
export function initialView(): RouteView {
  const fromUrl = viewFromLocation(window.location);
  if (fromUrl) return fromUrl;
  const st: unknown = window.history.state;
  const stored = st && typeof st === 'object' ? (st as { view?: unknown }).view : undefined;
  return isView(stored) ? stored : 'today';
}

/**
 * ผูกหน้าของแอปกับ history ของเบราว์เซอร์: เปลี่ยนหน้า = pushState (ปุ่ม back/forward ทำงาน) · back/forward = ตั้งหน้าตาม state/URL
 * /invest และ /tax มี URL ของตัวเอง (เปิดตรงหรือรีเฟรชแล้วอยู่หน้าเดิม) · หน้าอื่นใช้ "/" และเก็บชื่อหน้าใน history.state
 */
export function useViewHistory(view: RouteView, setView: (v: RouteView) => void): void {
  useEffect(() => {
    const target = urlForView(view, window.location);
    const current = window.location.pathname + window.location.search + window.location.hash;
    const stateView = (window.history.state as { view?: unknown } | null)?.view;
    if (stateView === view && current === target) return; // ตรงกันแล้ว (เช่น เพิ่งกลับด้วยปุ่ม back)
    if (stateView === undefined) window.history.replaceState({ view }, '', target); // รอบแรก: ผูก state กับรายการ history ปัจจุบัน
    else window.history.pushState({ view }, '', target);
  }, [view]);

  useEffect(() => {
    const onPop = (): void => {
      const st = window.history.state as { view?: unknown } | null;
      setView(isView(st?.view) ? st.view : (viewFromLocation(window.location) ?? 'today'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setView]);
}
