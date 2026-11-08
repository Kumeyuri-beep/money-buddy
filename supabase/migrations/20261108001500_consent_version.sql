-- บันทึกเวอร์ชันนโยบายที่ผู้ใช้ยอมรับ (PDPA) · งานค้างหลัง M2 ตามผล security-auditor (M2-E ข้อ 3)
-- เดิม record_consent() ตั้ง consented_at ครั้งเดียว ไม่รู้ว่ายอมรับฉบับใด และขอยินยอมซ้ำเมื่อนโยบายเปลี่ยนไม่ได้
-- ใหม่: record_consent(p_version) รับเฉพาะเวอร์ชันที่อยู่ในรายการอนุญาต private.policy_versions (ไม่รับข้อความอิสระ)
--   เวอร์ชันเดิมซ้ำ = ไม่เปลี่ยนเวลาเดิม · เวอร์ชันใหม่ = ตั้งเวลายอมรับใหม่ · เว็บเทียบเวอร์ชันกับฉบับปัจจุบันแล้วขอยินยอมซ้ำ
-- เมื่อแก้นโยบายในสาระสำคัญ: เพิ่มเวอร์ชันใหม่ในรายการนี้ (migration) แล้วเปลี่ยน PRIVACY_POLICY_VERSION ใน src/domain/privacy/policy.ts
--   (มีเทสต์ตรวจว่าเวอร์ชันปัจจุบันมีใน migration)

alter table public.profiles add column consented_version text;
-- ผู้ที่ยอมรับไปแล้วก่อนหน้านี้ยอมรับฉบับเดียวที่เคยมี
update public.profiles set consented_version = '2026-11-09' where consented_at is not null;

create table private.policy_versions (version text primary key check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'));
insert into private.policy_versions (version) values ('2026-11-09');
revoke all on private.policy_versions from public, anon, authenticated;

drop function public.record_consent();

create function public.record_consent(p_version text) returns void
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
  if p_version is null or not exists (select 1 from private.policy_versions v where v.version = p_version) then
    raise exception 'เวอร์ชันนโยบายไม่ถูกต้อง' using errcode = '22023';
  end if;
  update public.profiles
     set consented_at = case when consented_at is not null and consented_version is not distinct from p_version then consented_at else now() end,
         consented_version = p_version
   where user_id = v_user;
end
$$;

revoke all on function public.record_consent(text) from public, anon, authenticated;
grant execute on function public.record_consent(text) to authenticated;
