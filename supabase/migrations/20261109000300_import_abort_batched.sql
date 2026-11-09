-- import_ledger_abort แบบลบเป็นชุด (ต่อจาก 20261109000200_import_chunked)
-- วัดจริงบนฐานข้อมูลจริง (ธุรกรรม rollback): ล้าง 10,000 รายการ/20,000 บรรทัด = 1.4 วินาที · 10,000 รายการ/200,000 บรรทัด = 10.9 วินาที
-- role authenticated มี statement_timeout 8 วินาที → กรณีหนักสุดจะล้มและผู้ใช้ติดหน้า "นำเข้าไม่เสร็จ"
-- ใหม่: ลบรายการชุดละ ≤ 500 (บรรทัดลบตามด้วย cascade) คืน 'more' = ยังเหลือ เรียกซ้ำ · คืน 'done' เมื่อล้างหมดและปิดเซสชันแล้ว · 'none' = ไม่มีเซสชัน
-- ทุกชุดเป็นธุรกรรมของตัวเอง สมดุลต่อรายการเสมอ (ลบทั้งรายการพร้อมบรรทัด) ระหว่างล้างเซสชันยังเปิด การเขียนทางอื่นยังถูกล็อก
-- บัญชี/บิล/ตั้งค่าลบในชุดสุดท้ายเท่านั้น (หลังรายการหมด) จึงไม่ติด foreign key

drop function public.import_ledger_abort();

create function public.import_ledger_abort() returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'ต้องเรียกแบบเขียนได้ (POST) เท่านั้น' using errcode = '25006';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if not exists (select 1 from private.import_sessions where user_id = v_user) then
    return 'none';
  end if;
  with batch as (
    select e.id from public.entries e where e.user_id = v_user order by e.id limit 500
  )
  delete from public.entries e using batch b where e.user_id = v_user and e.id = b.id;
  get diagnostics v_deleted = row_count;
  if v_deleted >= 500 then
    return 'more';
  end if;
  delete from public.bills where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return 'done';
end
$$;

revoke all on function public.import_ledger_abort() from public, anon, authenticated;
grant execute on function public.import_ledger_abort() to authenticated;
