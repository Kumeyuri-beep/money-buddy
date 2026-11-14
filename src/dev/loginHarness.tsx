/**
 * ชุดทดสอบหน้าล็อกอินบนเครื่องผู้พัฒนาเท่านั้น (เปิดผ่าน `npm run dev` ที่ /login-harness.html) ไม่ถูกรวมใน build จริง
 * ใช้ตัวล็อกอินจำลอง (ไม่ต่อ Supabase/เครือข่าย): รหัสผ่านที่ถูกคือ "correct-password-123" ข้อมูลทั้งหมดสมมติ
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuthApi } from '../app/auth';
import { LoginPage } from '../ui/LoginPage';
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/500.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import '@fontsource/ibm-plex-sans-thai/700.css';
import '../ui/styles.css';
import { startLiquidGlass } from '../ui/liquidGlass';

startLiquidGlass();

const fakeApi: AuthApi = {
  signInWithPassword: async ({ password }) => (password === 'correct-password-123' ? { error: null } : { error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } }),
  updateUser: async () => ({ error: null }),
  signOut: async () => ({ error: null }),
  signOutOthers: async () => ({ error: null }),
};

function Harness() {
  const [signedIn, setSignedIn] = useState(false);
  if (signedIn) return <p id="signed-in" role="status">เข้าสู่ระบบสำเร็จ (จำลอง)</p>;
  return <LoginPage api={fakeApi} onSignedIn={() => setSignedIn(true)} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
