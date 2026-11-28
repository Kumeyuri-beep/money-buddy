-- ฐานข้อมูลตรวจผู้ใช้ที่หน้าจอตั้งใจกับทุกการเขียน: บันทึกรายการ บิล การลงทุน ค่าตั้งค่า บัญชี หมวด (เจ้าของอนุมัติให้ "เตรียม" 28 พ.ย. 2569 · HANDOFF §125 backlog 3)
-- **ยังไม่ได้ใส่ฐานข้อมูล รอเจ้าของอนุมัติ** · dry-run แบบย้อนกลับกับเทสต์ SQL ครบ 34/34 ไฟล์ผ่าน (28 พ.ย. 2569)
--
-- ปัญหา: เบราว์เซอร์ใช้เซสชันร่วมกันทุกแท็บ แท็บค้างของบัญชีหนึ่งอาจส่งคำสั่งเขียนด้วยเซสชันของอีกบัญชี
-- ทางแก้: เว็บแนบหัวคำขอ x-expected-user · trigger ระดับคำสั่งเทียบกับ auth.uid() ในธุรกรรมเดียวกับการเขียน ไม่ตรง = PT412 (ข้อความและรหัสเดียวกับตัวห่อ *_as)
-- ใช้ trigger แทนตัวห่อ *_as เพราะหลายคำสั่งเขียนตารางตรงๆ (บิล บัญชี สินทรัพย์ ราคา ลบรายการ) ไม่ผ่านฟังก์ชัน
-- trigger ระดับคำสั่งทำงานแม้ไม่มีแถวถูกแตะ (เช่น ลบรายการของอีกบัญชีที่ RLS มองไม่เห็น) จึงตอบ PT412 ไม่ใช่สำเร็จเงียบๆ
--
-- ไม่มีหัวคำขอ = ผ่าน: เว็บรุ่นเก่า เทสต์ SQL งานผู้ดูแล และระบบล็อกอินทำงานเหมือนเดิม
-- ไม่ใช่ด่านกันคนอื่นเข้าถึงข้อมูล (RLS ทำหน้าที่นั้น และหัวคำขอเป็นค่าที่ผู้เรียกบอกเอง) กันความผิดพลาดของหน้าจอเท่านั้น
-- เป็นการเพิ่มอย่างเดียว: create function / create trigger · ตาราง policy สิทธิ์ และฟังก์ชันเดิมไม่ถูกแตะ

create function private.expected_user_header_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_expected text;
begin
  if v_headers is null or v_headers = '' then
    return null;
  end if;
  v_expected := (v_headers::json) ->> 'x-expected-user';
  if v_expected is null then
    return null;
  end if;
  if pg_catalog.lower(v_expected) is distinct from (select auth.uid())::text then
    raise exception 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป ยังไม่ได้ทำอะไร' using errcode = 'PT412';
  end if;
  return null;
end
$$;
revoke all on function private.expected_user_header_guard() from public, anon, authenticated;

-- ชื่อขึ้นต้น a_ ให้ทำงานก่อน trigger ระดับคำสั่งอื่น (Postgres เรียงตามชื่อ)
create trigger a_expected_user_trg before insert or update or delete on public.accounts for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.entries for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.lines for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.bills for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.settings for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.assets for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.trades for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.asset_prices for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.fx_rates for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.fx_exchanges for each statement execute function private.expected_user_header_guard();
create trigger a_expected_user_trg before insert or update or delete on public.asset_categories for each statement execute function private.expected_user_header_guard();
