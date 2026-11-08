import { useEffect, useState, type ReactNode } from 'react';
import { localDataAccess } from '../app/localOwner';
import { db } from '../storage/instance';
import { getLocalOwner, hasLocalData, setLocalOwner } from '../storage/localOwner';
import { useAccount } from './AuthContext';

type State = 'checking' | 'allow' | 'ask' | 'blocked' | 'error';

/**
 * ด่านข้อมูลในเครื่อง (ก่อน M2-C): ข้อมูล IndexedDB ของเบราว์เซอร์นี้ผูกกับบัญชีเดียว
 * ผู้ใช้อีกคนที่ล็อกอินบนเบราว์เซอร์เดียวกันจะไม่เห็นข้อมูลของเจ้าของเดิม · ไม่ลบหรือแก้ข้อมูลใดๆ
 * (กันได้ระดับหน้าจอเท่านั้น ใครเปิด DevTools อ่านได้ ทางแก้จริงคือย้ายข้อมูลขึ้นฐานข้อมูลแยกตามผู้ใช้ใน M2-C)
 */
export function LocalDataGate({ userId, children }: { userId: string; children: ReactNode }) {
  const { username, signOut } = useAccount();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const decision = localDataAccess({ ownerId: await getLocalOwner(db), userId, hasData: await hasLocalData(db) });
        if (cancelled) return;
        if (decision === 'bind') {
          await setLocalOwner(db, userId);
          if (!cancelled) setState('allow');
        } else {
          setState(decision);
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const bind = async () => {
    try {
      await setLocalOwner(db, userId);
      setState('allow');
    } catch {
      setState('error');
    }
  };

  switch (state) {
    case 'checking':
      return (
        <main className="auth-page">
          <p className="muted" role="status">
            กำลังเตรียมข้อมูลในเครื่อง...
          </p>
        </main>
      );
    case 'allow':
      return <>{children}</>;
    case 'ask':
      return (
        <main className="auth-page">
          <section className="solid card auth-card" aria-labelledby="bind-title">
            <h1 id="bind-title">ผูกข้อมูลในเครื่องนี้กับบัญชีของคุณ</h1>
            <p>
              เบราว์เซอร์นี้มีข้อมูลการเงินที่บันทึกไว้เดิม ถ้าเป็นข้อมูลของคุณ กดผูกกับบัญชี <strong>{username}</strong>{' '}
              เพื่อใช้งานต่อ ข้อมูลจะไม่ถูกลบหรือแก้ไข หลังผูกแล้วบัญชีอื่นที่ล็อกอินบนเบราว์เซอร์นี้จะไม่เห็นข้อมูลชุดนี้
            </p>
            <div className="actions">
              <button className="btn btn-primary" onClick={() => void bind()}>
                ผูกข้อมูลนี้กับบัญชี {username}
              </button>
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                ไม่ใช่ของฉัน ออกจากระบบ
              </button>
            </div>
          </section>
        </main>
      );
    case 'blocked':
      return (
        <main className="auth-page">
          <section className="solid card auth-card" aria-labelledby="blocked-title">
            <h1 id="blocked-title">ข้อมูลในเครื่องนี้เป็นของบัญชีอื่น</h1>
            <p>
              เบราว์เซอร์นี้เก็บข้อมูลการเงินของผู้ใช้อีกบัญชีหนึ่งไว้ เพื่อความเป็นส่วนตัวจึงไม่แสดงให้บัญชี <strong>{username}</strong> เห็น
              กรุณาใช้เบราว์เซอร์หรือโปรไฟล์เบราว์เซอร์อื่น หรือให้เจ้าของข้อมูลเดิมออกจากระบบแล้วสำรองข้อมูลก่อน
            </p>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                ออกจากระบบ
              </button>
            </div>
          </section>
        </main>
      );
    case 'error':
      return (
        <main className="auth-page">
          <section className="solid card auth-card">
            <h1>เปิดข้อมูลในเครื่องไม่สำเร็จ</h1>
            <p role="alert">กรุณาปิดแล้วเปิดแอปใหม่ ถ้ายังไม่หาย ให้แจ้งผู้ดูแลระบบ</p>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                ออกจากระบบ
              </button>
            </div>
          </section>
        </main>
      );
  }
}
