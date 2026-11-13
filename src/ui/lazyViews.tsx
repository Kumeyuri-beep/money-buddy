import { use, type ComponentProps, type ComponentType } from 'react';

/** โหลดไฟล์ของหน้าไม่สำเร็จ (เน็ตสะดุด หรือแอปเพิ่งอัปเดตจนไฟล์เก่าหาย) ไม่เกี่ยวกับข้อมูลหรือยอดเงิน */
export class ViewLoadError extends Error {
  constructor() {
    super('โหลดไฟล์ของหน้านี้ไม่สำเร็จ');
    this.name = 'ViewLoadError';
  }
}

/**
 * หน้าที่โหลดเมื่อเปิดครั้งแรกเท่านั้น (ลดขนาดไฟล์ที่ต้องโหลดก่อนเห็นหน้าแรก โดยเฉพาะบนมือถือ)
 * ไม่ใช้ React.lazy เพราะมันจำผลที่ล้มไว้ถาวร (ปุ่ม "ลองอีกครั้ง" จะไม่ได้โหลดใหม่จริง)
 * ที่นี่: โหลดล้ม ลองซ้ำทันที 1 รอบ ล้มอีก = ล้างค่าที่จำไว้แล้วโยน ViewLoadError ให้ ErrorBoundary (ลองอีกครั้ง = โหลดไฟล์ใหม่จริง)
 */
export function makeViewLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      const attempt: Promise<T> = load()
        .catch(() => load())
        .catch(() => {
          if (pending === attempt) pending = null;
          throw new ViewLoadError();
        });
      pending = attempt;
    }
    return pending;
  };
}

function lazyView<C extends ComponentType<any>>(load: () => Promise<C>): ComponentType<ComponentProps<C>> {
  const get = makeViewLoader(load);
  return function LazyView(props: ComponentProps<C>) {
    const Component = use(get());
    return <Component {...(props as any)} />;
  };
}

export const TaxView = lazyView(() => import('./TaxView').then((m) => m.TaxView));
export const TaxPortfolioLink = lazyView(() => import('./TaxPortfolioLink').then((m) => m.TaxPortfolioLink));
export const RetirementView = lazyView(() => import('./RetirementView').then((m) => m.RetirementView));
export const PortfolioView = lazyView(() => import('./PortfolioView').then((m) => m.PortfolioView));
export const AveragingView = lazyView(() => import('./AveragingView').then((m) => m.AveragingView));
export const AccountView = lazyView(() => import('./AccountView').then((m) => m.AccountView));

/** ข้อความระหว่างรอหน้าโหลด: โปรแกรมอ่านจอบอกสถานะ (role=status, aria-live) และไม่ทำให้เลย์เอาต์กระโดด */
export function ViewLoading() {
  return (
    <div className="muted view-loading" role="status" aria-live="polite">
      กำลังโหลดหน้า…
    </div>
  );
}
