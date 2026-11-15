-- A2 (ผลตรวจ money-auditor F1 + security-auditor ข้อ 1 และ 3): ล็อก Entry/บรรทัดของรายการแลกเงิน และห้ามซ่อนหมวดผลลงทุน USD
-- migration แบบ "เพิ่ม" เท่านั้น: create or replace function 3 ตัว (ไม่มี drop/delete/truncate/เปลี่ยนชนิดคอลัมน์ · สิทธิ์ตารางไม่เปลี่ยน · trigger เดิมยังชี้ฟังก์ชันชื่อเดิม)
--
-- 1) private.entries_trade_guard: UPDATE Entry ที่ผูก fx_exchanges ไม่ได้ (เหมือน trades) · DELETE ไม่เปลี่ยน (ลบ Entry แล้ว fx_exchanges หายตามผ่าน cascade)
-- 2) private.lines_trade_guard: เพิ่ม/แก้บรรทัดของ Entry ที่ผูก fx_exchanges ไม่ได้ (record_fx_exchange เพิ่มบรรทัดก่อนแถว fx_exchanges จึงไม่ติด)
--    เหตุผล: ไม่งั้นผู้ใช้แก้ยอดสมุดของการแลกเงินได้โดยตารางแลกเงินไม่ตรง (สมดุลต่อสกุลยังผ่าน จึงสร้างเงิน USD ขึ้นมาได้) ขัดแผน A และ R20.2
-- 3) public.set_category_archived: ห้ามซ่อนหมวดผลลงทุนฝั่ง USD (inv-gain-usd, inv-loss-usd, inv-dividend-usd, inv-wht-usd) เหมือนฝั่งบาท

create or replace function private.entries_trade_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_trade public.trades%rowtype;
  v_problem text;
begin
  if tg_op = 'UPDATE' then
    if exists (select 1 from public.trades t where t.user_id = old.user_id and t.entry_id = old.id) then
      raise exception 'รายการนี้ผูกกับรายการลงทุน แก้ไขไม่ได้ (ลบรายการลงทุนแล้วบันทึกใหม่)' using errcode = '42501';
    end if;
    if exists (select 1 from public.fx_exchanges x where x.user_id = old.user_id and x.entry_id = old.id) then
      raise exception 'รายการนี้ผูกกับการแลกเงิน แก้ไขไม่ได้ (ลบรายการแล้วบันทึกใหม่)' using errcode = '42501';
    end if;
    return new;
  end if;
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return old;
  end if;
  select * into v_trade from public.trades t where t.user_id = old.user_id and t.entry_id = old.id;
  if found then
    perform 1 from public.assets a where a.user_id = v_trade.user_id and a.id = v_trade.asset_id for update;
    v_problem := private.trade_delete_problem(v_trade.user_id, v_trade.id);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '23514';
    end if;
  end if;
  return old;
end
$$;

create or replace function private.lines_trade_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_entry text := coalesce(new.entry_id, old.entry_id);
begin
  if exists (select 1 from public.trades t where t.user_id = v_user and t.entry_id = v_entry) then
    raise exception 'บรรทัดของรายการที่ผูกกับรายการลงทุน แก้ไขไม่ได้ (ลบรายการลงทุนแล้วบันทึกใหม่)' using errcode = '42501';
  end if;
  if exists (select 1 from public.fx_exchanges x where x.user_id = v_user and x.entry_id = v_entry) then
    raise exception 'บรรทัดของรายการที่ผูกกับการแลกเงิน แก้ไขไม่ได้ (ลบรายการแล้วบันทึกใหม่)' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function public.set_category_archived(p_id text, p_archived boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_type text;
  v_visible integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if p_id is null or p_archived is null then
    raise exception 'ข้อมูลไม่ครบ' using errcode = '22023';
  end if;
  if p_id in ('inv-gain', 'inv-loss', 'inv-dividend', 'inv-wht', 'inv-gain-usd', 'inv-loss-usd', 'inv-dividend-usd', 'inv-wht-usd') then
    raise exception 'ซ่อนหมวดผลการลงทุนที่ระบบสร้างไม่ได้' using errcode = '42501';
  end if;

  select a.type into v_type
  from public.accounts a
  where a.user_id = v_user and a.id = p_id and a.type in ('income', 'expense') and a.kind = 'normal';
  if v_type is null then
    raise exception 'ไม่พบหมวดนี้' using errcode = 'P0002';
  end if;

  perform 1 from public.accounts a
  where a.user_id = v_user and a.type = v_type and a.kind = 'normal'
  order by a.id for update;

  if p_archived then
    select count(*) into v_visible
    from public.accounts a
    where a.user_id = v_user and a.type = v_type and a.kind = 'normal' and a.currency = 'THB'
      and not a.archived and a.id <> p_id
      and a.id not in ('inv-gain', 'inv-loss', 'inv-dividend', 'inv-wht', 'inv-gain-usd', 'inv-loss-usd', 'inv-dividend-usd', 'inv-wht-usd');
    if v_visible < 1 then
      raise exception 'ต้องเหลือหมวดที่ใช้งานอย่างน้อย 1 หมวด' using errcode = '23514';
    end if;
  end if;

  update public.accounts set archived = p_archived where user_id = v_user and id = p_id;
  return true;
end
$$;

revoke all on function public.set_category_archived(text, boolean) from public, anon, authenticated;
grant execute on function public.set_category_archived(text, boolean) to authenticated;
