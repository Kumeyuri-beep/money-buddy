import { useAccount } from './AuthContext';
import { ChangePasswordForm } from './ChangePasswordForm';

/** หน้าโปรไฟล์: ชื่อผู้ใช้ เปลี่ยนรหัสผ่าน ออกจากระบบ (หัวหน้าหลักของแอปเป็น h1 แล้ว หน้านี้ใช้ h2) */
export function AccountView() {
  const { username, signOut } = useAccount();
  return (
    <>
      <section className="solid card" aria-labelledby="account-title">
        <h2 id="account-title" className="page-title">
          โปรไฟล์
        </h2>
        <p>
          ชื่อผู้ใช้: <strong>{username}</strong>
        </p>
        <p className="muted small">
          ข้อมูลการเงินของคุณเก็บในบัญชีออนไลน์ของคุณ แยกจากผู้ใช้คนอื่น ข้อมูลเดิมที่เคยเก็บในเบราว์เซอร์นี้ (ถ้ามี) ยังอยู่และไม่ถูกลบ ควรสำรองข้อมูลเป็นประจำ
        </p>
        <button className="btn btn-ghost" onClick={() => void signOut()}>
          ออกจากระบบ
        </button>
      </section>
      <section className="solid card" aria-labelledby="change-pw-title">
        <h2 id="change-pw-title">เปลี่ยนรหัสผ่าน</h2>
        <ChangePasswordForm username={username} onDone={() => undefined} />
      </section>
    </>
  );
}
