-- M2-B2: ฟังก์ชันสำหรับสคริปต์ผู้ดูแลในเครื่องเจ้าของ (service_role เท่านั้น)
-- เหตุผล: JWT expiry ตั้งไม่ได้ (1 ชั่วโมง) เจ้าของ reset รหัสแล้วต้องเพิกถอน session ของผู้ใช้ทั้งหมดเอง
-- (Supabase ไม่มี endpoint "ออกจากระบบตาม user id" และยังไม่พิสูจน์ว่า Admin updateUserById ลบ session ให้)
-- ลบแถว auth.sessions = refresh token ที่ผูกกับ session ถูกลบตาม (FK cascade) และ private.can_use_data() ปฏิเสธ access token เก่าทันที

create function public.admin_revoke_sessions(p_user uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  -- refresh token ที่ไม่ผูก session (รุ่นเก่า/กรณีพิเศษ) ก็ต้องใช้ต่ออายุไม่ได้
  delete from auth.refresh_tokens where user_id = p_user::text;
  return v_count;
end
$$;

create function public.admin_session_count(p_user uuid) returns integer
language sql stable security definer set search_path = ''
as $$ select count(*)::integer from auth.sessions where user_id = p_user $$;

-- ผู้ใช้ทั่วไป (anon/authenticated) เรียกไม่ได้เด็ดขาด
revoke all on function public.admin_revoke_sessions(uuid), public.admin_session_count(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid), public.admin_session_count(uuid) to service_role;
