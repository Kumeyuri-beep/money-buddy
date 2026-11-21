-- Invest v2 รอบ 1 · หน้า Cash (R16/R20/R23): ปรับยอดเงินสดในพอร์ต (เงินเข้า/ออกจากภายนอกพอร์ต หรือปรับให้ตรงใบแจ้งยอดโบรกเกอร์)
-- migration แบบ "เพิ่ม" เท่านั้น: create function + revoke/grant (ไม่มี drop/delete/truncate/เปลี่ยนชนิดคอลัมน์ · ไม่แตะ RLS/นโยบาย/trigger เดิม)
--
-- record_cash_adjustment(p_entry, p_accounts): บันทึก Entry 2 บรรทัดในสมุดบัญชีคู่
--   บรรทัด 1 = เงินสดของพอร์ต (บัญชีสินทรัพย์ kind investment สกุล THB/USD ไม่ผูกสินทรัพย์ ไม่ถูกเก็บถาวร)
--   บรรทัด 2 = บัญชีพักปรับยอด (equity) ชื่อ inv-cash-adjust-thb / inv-cash-adjust-usd (สกุลตรงกับเงินสด) ฝั่งตรงข้ามเท่ากัน
--   ผลรวมต่อสกุล = 0 (ตัวตรวจสมดุลของ insert_entry) · ไม่ใช่รายรับ/รายจ่าย (บัญชี equity ไม่นับ) · ไม่มี fx (สกุลเดียว)
-- ถอนเงินเกินยอดคงเหลือไม่ได้ (เงินสดห้ามติดลบ)

create function public.record_cash_adjustment(p_entry jsonb, p_accounts jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_acc jsonb;
  v_id text;
  v_unknown integer;
  n_cash integer;
  n_adj integer;
  s_cash numeric;
  s_adj numeric;
  v_cash_acc text;
  v_cash_cur text;
  v_adj_cur text;
  v_balance numeric;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_entry) is distinct from 'object' or jsonb_typeof(coalesce(p_accounts, '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(p_entry->'lines') is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_accounts, '[]'::jsonb)) > 1 or jsonb_array_length(p_entry->'lines') <> 2 then
    raise exception 'การปรับยอดเงินสดต้องมี 2 บรรทัดและสร้างบัญชีพักได้ไม่เกิน 1 บัญชี' using errcode = '22023';
  end if;
  if coalesce(p_entry->>'source', 'manual') <> 'manual' then
    raise exception 'การปรับยอดเงินสดใช้ชนิดรายการ manual เท่านั้น' using errcode = '22023';
  end if;

  for v_acc in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    v_id := v_acc->>'id';
    if v_id is null or v_id not in ('inv-cash-adjust-thb', 'inv-cash-adjust-usd') then
      raise exception 'สร้างบัญชีนี้ผ่านการปรับยอดเงินสดไม่ได้' using errcode = '22023';
    end if;
    insert into public.accounts (user_id, id, type, name, currency, kind)
    values (
      v_user, v_id, 'equity',
      case v_id when 'inv-cash-adjust-thb' then 'บัญชีพักการปรับยอดเงินสด (บาท)' else 'บัญชีพักการปรับยอดเงินสด (USD)' end,
      case v_id when 'inv-cash-adjust-thb' then 'THB' else 'USD' end, 'normal'
    ) on conflict (user_id, id) do nothing;
  end loop;

  select
    coalesce(sum(c.amt) filter (where c.cls = 'cash'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'adj'), 0),
    count(*) filter (where c.cls = 'cash'),
    count(*) filter (where c.cls = 'adj'),
    count(*) filter (where c.cls = 'unknown'),
    max(c.acc) filter (where c.cls = 'cash'),
    max(c.cur) filter (where c.cls = 'cash'),
    max(c.cur) filter (where c.cls = 'adj')
  into s_cash, s_adj, n_cash, n_adj, v_unknown, v_cash_acc, v_cash_cur, v_adj_cur
  from (
    select l.acc, l.amt, a.currency as cur,
      case
        when l.acc in ('inv-cash-adjust-thb', 'inv-cash-adjust-usd') and a.type = 'equity'
             and a.currency = case l.acc when 'inv-cash-adjust-thb' then 'THB' else 'USD' end then 'adj'
        when l.acc not in ('inv-cash-adjust-thb', 'inv-cash-adjust-usd') and a.type = 'asset' and a.kind = 'investment'
             and a.currency in ('THB', 'USD') and not a.archived
             and not exists (select 1 from public.assets s where s.user_id = v_user and s.account_id = a.id) then 'cash'
        else 'unknown'
      end as cls
    from (select l->>'accountId' as acc, (l->>'amount')::numeric as amt from jsonb_array_elements(p_entry->'lines') l) l
    left join public.accounts a on a.user_id = v_user and a.id = l.acc
  ) c;
  if v_unknown > 0 or n_cash <> 1 or n_adj <> 1 then
    raise exception 'การปรับยอดเงินสดต้องใช้เงินสดของพอร์ตและบัญชีพักการปรับยอดอย่างละหนึ่งบรรทัด' using errcode = '23514';
  end if;
  if v_cash_cur is distinct from v_adj_cur then
    raise exception 'สกุลของเงินสดและบัญชีพักต้องตรงกัน' using errcode = '23514';
  end if;
  if s_cash = 0 or s_cash + s_adj <> 0 then
    raise exception 'ยอดปรับต้องไม่เป็นศูนย์และสองบรรทัดต้องหักล้างกันพอดี' using errcode = '23514';
  end if;

  -- ถอนเกินยอดคงเหลือไม่ได้ (ล็อกแถวบัญชีกันบันทึกซ้อนกัน)
  perform 1 from public.accounts a where a.user_id = v_user and a.id = v_cash_acc for update;
  select coalesce(sum(l.amount), 0) into v_balance from public.lines l where l.user_id = v_user and l.account_id = v_cash_acc;
  if v_balance + s_cash < 0 then
    raise exception 'เงินสดไม่พอสำหรับการถอนนี้' using errcode = '23514';
  end if;

  perform private.insert_entry(p_entry);
  return jsonb_build_object('entryId', p_entry->>'id');
end
$$;

revoke all on function public.record_cash_adjustment(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_cash_adjustment(jsonb, jsonb) to authenticated;
