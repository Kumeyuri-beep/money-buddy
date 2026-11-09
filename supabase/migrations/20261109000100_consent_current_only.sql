-- ให้ record_consent รับเฉพาะเวอร์ชันนโยบาย "ปัจจุบัน" (ข้อ ข จากผล security-auditor ตรวจ record_consent(p_version))
-- เดิม: รับทุกเวอร์ชันในรายการ private.policy_versions → ไคลเอนต์เก่าที่ค้างหน้าเว็บ/ผู้เรียก API เองยอมรับฉบับเก่าได้
-- ใหม่: ระบุฉบับปัจจุบันด้วย is_current (มีได้แถวเดียวเพราะ unique partial index) · ฉบับเก่ายังเก็บเป็นประวัติ แต่ยอมรับไม่ได้อีก
--   ผู้ใช้ที่ยอมรับฉบับเก่าไปแล้วไม่ถูกแตะ (profiles.consented_version คงเดิม) เว็บเทียบเวอร์ชันแล้วขอยินยอมซ้ำเอง
-- (ก) การบังคับยอมรับยังกั้นที่หน้าเว็บเท่านั้น ไม่บังคับที่ฐานข้อมูล ตาม docs/decisions/2026-11-09-m2-e.md ข้อ 1
--
-- เมื่อแก้นโยบายในสาระสำคัญ: migration ใหม่ต้อง (1) update is_current=false ของฉบับเดิม (2) insert ฉบับใหม่ is_current=true
--   (3) มีบรรทัดประกาศ current-policy-version ด้านล่างนี้ด้วยค่าใหม่ (เทสต์เทียบกับ PRIVACY_POLICY_VERSION)
--
-- current-policy-version: 2026-11-09

alter table private.policy_versions add column is_current boolean not null default false;
update private.policy_versions set is_current = true where version = '2026-11-09';
create unique index policy_versions_one_current on private.policy_versions (is_current) where is_current;

create or replace function public.record_consent(p_version text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if p_version is null or not exists (select 1 from private.policy_versions v where v.version = p_version and v.is_current) then
    raise exception 'เวอร์ชันนโยบายไม่ถูกต้องหรือไม่ใช่ฉบับปัจจุบัน' using errcode = '22023';
  end if;
  update public.profiles
     set consented_at = case when consented_at is not null and consented_version is not distinct from p_version then consented_at else now() end,
         consented_version = p_version
   where user_id = v_user;
end
$$;

revoke all on function public.record_consent(text) from public, anon, authenticated;
grant execute on function public.record_consent(text) to authenticated;
