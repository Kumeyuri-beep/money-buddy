import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gateStateFromProfile, signOutQuietly } from '../app/auth';
import { usernameOfEmail } from '../domain/auth/credentials';
import { authApi, loadProfile, supabase } from '../storage/supabase';
import { AccountContext } from './AuthContext';
import { ChangePasswordForm } from './ChangePasswordForm';
import { LocalDataGate } from './LocalDataGate';
import { LoginPage } from './LoginPage';

type GateView =
  | { kind: 'loading' }
  | { kind: 'no-config' }
  | { kind: 'signed-out' }
  | { kind: 'must-change'; userId: string; username: string }
  | { kind: 'no-profile'; userId: string; username: string }
  | { kind: 'error'; userId: string; username: string }
  | { kind: 'ready'; userId: string; username: string };

function sameView(a: GateView, b: GateView): boolean {
  if (a.kind !== b.kind) return false;
  if ('userId' in a && 'userId' in b) return a.userId === b.userId && a.username === b.username;
  return true;
}

/**
 * ด่านหน้าของทั้งแอป (M2-B): ไม่ล็อกอิน = เห็นแต่หน้าเข้าสู่ระบบ · ธงบังคับเปลี่ยนรหัส = เห็นแต่หน้าเปลี่ยนรหัส
 * หน้าจอนี้เป็นแค่การแสดงผลที่ถูกต้อง ด่านจริงคือ RLS ฝั่งฐานข้อมูล (ไม่เปลี่ยนรหัส = อ่าน/เขียนข้อมูลไม่ได้)
 * - ตรวจสถานะซ้ำเมื่อมีเหตุการณ์ล็อกอิน/ต่ออายุ token/เปลี่ยนผู้ใช้ (รวมจากแท็บอื่น) ผลที่ช้ากว่าไม่เขียนทับผลใหม่
 * - เปลี่ยนผู้ใช้ = ทิ้ง state ของแอปทั้งหมด (key ตามรหัสผู้ใช้)
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<GateView>({ kind: 'loading' });
  const generation = useRef(0);

  const show = useCallback((next: GateView) => setView((prev) => (sameView(prev, next) ? prev : next)), []);

  const evaluate = useCallback(async () => {
    const mine = ++generation.current;
    const stale = () => mine !== generation.current;
    if (!supabase) {
      show({ kind: 'no-config' });
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (stale()) return;
    const session = data.session;
    if (!session) {
      show({ kind: 'signed-out' });
      return;
    }
    const userId = session.user.id;
    const username = usernameOfEmail(session.user.email);
    const loaded = await loadProfile(supabase);
    if (stale()) return;
    if (!loaded.ok) {
      show({ kind: 'error', userId, username });
      return;
    }
    const state = gateStateFromProfile(loaded.profile);
    show({ kind: state === 'ready' ? 'ready' : state === 'must-change' ? 'must-change' : 'no-profile', userId, username });
  }, [show]);

  useEffect(() => {
    if (!supabase) {
      console.warn('ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
    }
    void evaluate();
    if (!supabase) return;
    // อย่าเรียกเมธอด supabase ภายใน callback นี้โดยตรง (อาจค้าง) จึงเลื่อนด้วย setTimeout
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        generation.current++;
        show({ kind: 'signed-out' });
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        window.setTimeout(() => void evaluate(), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [evaluate, show]);

  const signOut = useCallback(async () => {
    generation.current++; // ผลตรวจที่ยังค้างอยู่ต้องไม่เขียนทับสถานะออกจากระบบ
    if (authApi) await signOutQuietly(authApi);
    show({ kind: 'signed-out' });
  }, [show]);

  const account = useMemo(
    () => (view.kind === 'ready' ? { username: view.username, signOut, refresh: evaluate } : null),
    [view, signOut, evaluate],
  );

  switch (view.kind) {
    case 'loading':
      return (
        <main className="auth-page">
          <h1 className="sr-only">Money Buddy</h1>
          <p className="muted" role="status">
            กำลังตรวจสอบการเข้าสู่ระบบ...
          </p>
        </main>
      );
    case 'no-config':
      return (
        <main className="auth-page">
          <section className="solid card auth-card">
            <h1>ระบบยังไม่พร้อมใช้งาน</h1>
            <p role="alert">ยังไม่ได้ตั้งค่าการเชื่อมต่อเซิร์ฟเวอร์ กรุณาติดต่อผู้ดูแลระบบ</p>
          </section>
        </main>
      );
    case 'signed-out':
      return <LoginPage onSignedIn={evaluate} />;
    case 'must-change':
      return (
        <main className="auth-page">
          <section className="solid card auth-card" aria-labelledby="force-title">
            <h1 id="force-title">ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน</h1>
            <p>
              บัญชี <strong>{view.username}</strong> ยังใช้รหัสผ่านที่ผู้ดูแลระบบให้ไว้ กรุณาตั้งรหัสผ่านใหม่ของคุณเอง จึงจะเข้าถึงข้อมูลได้
            </p>
            <ChangePasswordForm username={view.username} onDone={evaluate} />
            <hr className="auth-sep" />
            <button className="btn btn-ghost" onClick={() => void signOut()}>
              ออกจากระบบ
            </button>
          </section>
        </main>
      );
    case 'no-profile':
    case 'error':
      return (
        <main className="auth-page">
          <section className="solid card auth-card">
            <h1>{view.kind === 'error' ? 'โหลดข้อมูลบัญชีไม่สำเร็จ' : 'บัญชีนี้ยังไม่พร้อมใช้งาน'}</h1>
            <p role="alert">
              {view.kind === 'error'
                ? 'กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'
                : 'กรุณาแจ้งผู้ดูแลระบบเพื่อตรวจสอบบัญชีของคุณ'}
            </p>
            <div className="actions">
              {view.kind === 'error' ? (
                <button className="btn btn-primary" onClick={() => void evaluate()}>
                  ลองอีกครั้ง
                </button>
              ) : null}
              <button className="btn btn-ghost" onClick={() => void signOut()}>
                ออกจากระบบ
              </button>
            </div>
          </section>
        </main>
      );
    case 'ready':
      return account ? (
        <AccountContext.Provider key={view.userId} value={account}>
          <LocalDataGate userId={view.userId}>{children}</LocalDataGate>
        </AccountContext.Provider>
      ) : null;
  }
}
