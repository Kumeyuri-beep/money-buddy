# ข้อเสนอ R2-1: Categories (หมวดของผู้ใช้ + เป้า % ต่อหมวด)

สถานะ: **ร่าง รออนุมัติจากเจ้าของ · ยังไม่แก้โค้ด ไม่รัน migration ไม่แตะ `docs/money-rules.md`** (เจ้าของสั่ง 21 พ.ย. 2569 ขั้นที่ 0)
แบบร่าง: `docs/design/invest-v2/25-portfolio-categories.png` · ตัวเลขในแบบร่างเป็นข้อมูลตัวอย่าง
งานนี้แตะฐานข้อมูล จึงเป็นงานของ GM (migration แบบ "เพิ่ม" · dry-run rollback · เทสต์ SQL ครบ · `admin:live-contract` บน branch และบน `main`)

## 1. สิ่งที่สำรวจพบในระบบตอนนี้
- ตาราง `assets` (`supabase/migrations/20261111000100_invest_schema.sql`) **ไม่มีคอลัมน์ sector หรือหมวดเลย** และใน `src/domain/invest/types.ts` ก็ไม่มี → แบบร่างที่ว่า "เริ่มจาก sector" ต้องมีที่เก็บ sector ก่อน และ **ระบบยังไม่มีแหล่งข้อมูลตลาด (Phase B)** จึงเติม sector อัตโนมัติจากภายนอกไม่ได้
- ตารางลงทุนทุกตัวใช้แพทเทิร์นเดียวกัน: `user_id default auth.uid()` + RLS "เจ้าของแถว" (permissive) + ด่าน `private.can_use_data()` (restrictive) + ล็อกขณะเซสชันนำเข้าเปิด + `revoke all ... from public, anon` แล้ว `grant ... to authenticated` + เพดานจำนวนแถวต่อผู้ใช้ (`private.enforce_invest_limits`) → ตารางใหม่ทำตามแพทเทิร์นนี้
- ข้อมูลของผู้ใช้ต้อง "ส่งออกได้เสมอ" (CLAUDE.md) → หมวด/เป้า/sector ต้องอยู่ในไฟล์สำรองและนำเข้าได้ (ดูข้อ 5)
- ที่เก็บในเครื่อง (Dexie) ปฏิเสธข้อมูลลงทุนอยู่แล้ว (`localInvestError`) → ฟีเจอร์นี้ออนไลน์เท่านั้นเหมือน /invest ส่วนอื่น

## 2. การออกแบบ
**หมวดหนึ่งสินทรัพย์ต่อหนึ่งหมวด** (แบบร่าง: "6 categories" รวมทุกหุ้น) จึงเก็บเป็นคอลัมน์บน `assets` ไม่ต้องมีตารางเชื่อม

| ที่เก็บ | ชนิด | ความหมาย |
|---|---|---|
| `assets.sector` (เพิ่ม) | `text null` ยาว 1–60 | sector ที่ผู้ใช้กรอก/เลือก (ไม่บังคับ) ใช้เป็นที่มาของปุ่ม "Create categories from sectors" |
| `assets.category_id` (เพิ่ม) | `text null` | หมวดของสินทรัพย์นี้ · ไม่มี = "Uncategorized" |
| `asset_categories` (ตารางใหม่) | ดูด้านล่าง | หมวดของผู้ใช้ |

`asset_categories`: `user_id, id, name (1–60 ตัวอักษร ไม่ซ้ำในผู้ใช้เดียวกันแบบไม่สนตัวพิมพ์), target_bps (null หรือ 0–10,000), sort_order, created_at`
- **เป้า % เก็บเป็น bps จำนวนเต็ม** (45% = 4,500) ไม่มี float
- **กฎเป้ารวม = 100%:** ถ้ามีหมวดใดตั้งเป้า ทุกหมวดต้องตั้งเป้า และผลรวมต้อง 10,000 พอดี · ถ้าไม่ตั้งเลย (ทุกหมวด null) ยอมให้ (หน้า Rebalancing จะขึ้น "Set up categories and target allocations first") · บังคับที่ฐานข้อมูลด้วย **deferred constraint trigger** (ตรวจตอน commit จึงแก้หลายหมวดพร้อมกันในธุรกรรมเดียวได้) และการเขียนจริงผ่าน RPC `save_categories` ธุรกรรมเดียว
- **สร้างจาก sector:** ฝั่งเว็บอ่าน `sector` ของสินทรัพย์ที่ถืออยู่ จัดกลุ่ม แล้วส่งเข้า `save_categories` (สินทรัพย์ที่ไม่มี sector → ไม่ใส่หมวด "Uncategorized") · ผู้ใช้เปลี่ยนชื่อ / รวมหมวด (ย้ายสินทรัพย์ทั้งหมดไปหมวดเดียวแล้วลบหมวดเดิม) / ตั้งเป้าเองได้ ทั้งหมดผ่าน `save_categories` ครั้งเดียวต่อการกด Save
- ลบหมวด: สินทรัพย์ในหมวดนั้นกลับเป็น Uncategorized (`on delete set null` เฉพาะคอลัมน์ `category_id` ต้อง PostgreSQL ≥ 15 ซึ่ง Supabase ใช้อยู่ · ตรวจเวอร์ชันก่อนใส่)
- เพดาน: หมวดไม่เกิน 50 ต่อผู้ใช้

## 3. ร่าง SQL (ยังไม่ได้รัน ยังไม่ได้ทดสอบ · ต้อง dry-run rollback)
```sql
-- migration แบบ "เพิ่ม" เท่านั้น: add column / create table / create function (ไม่มี drop/delete/truncate/เปลี่ยนชนิด)
-- ชื่อ/sector: ยาว 1-60, ไม่มีช่องว่างหน้าหลัง (x = btrim(x)), ไม่มีอักขระควบคุม/ศูนย์ความกว้าง/ตัวกลับทิศ (แบบเดียวกับ accounts_name_no_invisible)
alter table public.assets add column sector text
  check (sector is null or (char_length(sector) between 1 and 60 and sector = btrim(sector)
         and sector !~ E'[\\x01-\\x1F\\x7F-\\x9F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]'));
alter table public.assets add column category_id text;
create index assets_user_category_idx on public.assets (user_id, category_id) where category_id is not null;  -- ให้ FK on delete set null หาแถวเร็ว

create table public.asset_categories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)
    and name !~ E'[\\x01-\\x1F\\x7F-\\x9F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]'),
  -- กุญแจชื่อไม่สนตัวพิมพ์ ใช้กับ unique แบบ deferrable (สลับชื่อสองหมวดในการบันทึกครั้งเดียวได้)
  name_key text generated always as (lower(name)) stored,
  target_bps integer check (target_bps is null or (target_bps between 0 and 10000)),
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  created_at timestamptz not null default now()
    check (created_at >= timestamptz '1900-01-01 00:00:00+00' and created_at < timestamptz '3000-01-01 00:00:00+00'),
  primary key (user_id, id)
);
alter table public.asset_categories add constraint asset_categories_name_uniq unique (user_id, name_key) deferrable initially deferred;

alter table public.assets
  add constraint assets_category_fk foreign key (user_id, category_id)
  references public.asset_categories (user_id, id) on delete set null (category_id);

-- เพดาน 50 หมวดต่อผู้ใช้ (ตรวจระดับคำสั่งเหมือน private.enforce_invest_limits)
create function private.enforce_category_limit() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare v_user uuid; v_n bigint;
begin
  for v_user in select distinct user_id from new_rows loop
    select count(*) into v_n from public.asset_categories where user_id = v_user;
    if v_n > 50 then raise exception 'หมวดเกินเพดาน (50 หมวดต่อผู้ใช้)' using errcode = '54000'; end if;
  end loop;
  return null;
end $$;
create trigger asset_categories_limit_trg after insert on public.asset_categories
  referencing new table as new_rows for each statement execute function private.enforce_category_limit();

-- เป้ารวม = 100% (deferred: ตรวจตอน commit)
-- ข้าม role ผู้ดูแลเหมือนด่านเดิมทุกตัว (trades_delete_guard ฯลฯ): ลบผู้ใช้ทั้งบัญชี (cascade ผ่าน auth.users) ทำงานด้วย role เหล่านี้ ซึ่งไม่มีสิทธิ์ในตารางนี้
create function private.categories_target_check() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare v_user uuid; v_n integer; v_set integer; v_sum bigint;
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return null;
  end if;
  v_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;  -- ไม่ใช้ coalesce(new, old): NEW ตอน DELETE ยังไม่ถูกกำหนด
  select count(*), count(target_bps), coalesce(sum(target_bps), 0) into v_n, v_set, v_sum
    from public.asset_categories where user_id = v_user;
  if v_set > 0 and (v_set <> v_n or v_sum <> 10000) then
    raise exception 'เป้ารวมของทุกหมวดต้องเท่ากับ 100%% (ตั้งเป้าให้ครบทุกหมวด)' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger asset_categories_target_trg
  after insert or update or delete on public.asset_categories
  deferrable initially deferred for each row execute function private.categories_target_check();

-- RLS: แพทเทิร์นเดียวกับ assets/trades (เจ้าของแถว + ด่านเปลี่ยนรหัส + ล็อกขณะนำเข้า)
alter table public.asset_categories enable row level security;
create policy asset_categories_own on public.asset_categories as permissive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy asset_categories_gate on public.asset_categories as restrictive for all to authenticated
  using ((select private.can_use_data())) with check ((select private.can_use_data()));
create policy asset_categories_import_lock_ins on public.asset_categories as restrictive for insert to authenticated
  with check ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on');
create policy asset_categories_import_lock_upd on public.asset_categories as restrictive for update to authenticated
  using ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on')
  with check ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on');
create policy asset_categories_import_lock_del on public.asset_categories as restrictive for delete to authenticated
  using ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on');
revoke all on public.asset_categories from public, anon, authenticated;
grant select, insert, update, delete on public.asset_categories to authenticated;

-- RPC: บันทึกหมวด + การจัดหมวดของสินทรัพย์ในธุรกรรมเดียว (security invoker: RLS ยังบังคับใช้)
-- p_categories = [{id,name,targetBps,sortOrder}] ทั้งชุด (ที่ไม่อยู่ในชุด = ถูกลบ)
-- p_assignments = [{assetId, categoryId?, sector?}] เฉพาะ key ที่ส่งมาเท่านั้นที่เปลี่ยน (ไม่ส่ง key = คงค่าเดิม)
create function public.save_categories(p_categories jsonb, p_assignments jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_c jsonb; v_a jsonb; v_n integer; v_assign jsonb := coalesce(p_assignments, '[]'::jsonb);
begin
  if v_user is null then raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000'; end if;
  if not private.can_use_data() then raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501'; end if;
  if private.import_session_exists() then raise exception 'กำลังนำเข้าข้อมูล ทำรายการนี้ไม่ได้ในตอนนี้' using errcode = '55000'; end if;
  -- ตรวจชนิดก่อน แล้วค่อยตรวจจำนวน/ขนาด (แยก IF กันลำดับการประเมิน)
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_typeof(v_assign) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  if jsonb_array_length(p_categories) > 50 or jsonb_array_length(v_assign) > 200
     or pg_column_size(p_categories) > 65536 or pg_column_size(v_assign) > 65536 then
    raise exception 'ข้อมูลมากเกินกำหนด' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_categories) x where jsonb_typeof(x) is distinct from 'object'
             or coalesce(x->>'targetBps', '0') !~ '^[0-9]{1,5}$' or coalesce(x->>'sortOrder', '0') !~ '^[0-9]{1,4}$')
     or exists (select 1 from jsonb_array_elements(v_assign) x where jsonb_typeof(x) is distinct from 'object') then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  -- กันสองแท็บบันทึกพร้อมกัน แม้ผู้ใช้ยังไม่มีหมวดเลย (แบบเดียวกับ import_ledger_investments) และกำหนดลำดับล็อกเดียวกัน
  perform pg_advisory_xact_lock(hashtext('categories:' || v_user::text));
  -- สินทรัพย์ที่ชี้หมวดที่จะถูกลบถูกตั้งเป็น null โดย FK (set null) ก่อนลบ
  delete from public.asset_categories c
   where c.user_id = v_user
     and c.id not in (select x->>'id' from jsonb_array_elements(p_categories) x);
  for v_c in select * from jsonb_array_elements(p_categories) loop
    insert into public.asset_categories (id, name, target_bps, sort_order)
    values (v_c->>'id', v_c->>'name', (v_c->>'targetBps')::integer, coalesce((v_c->>'sortOrder')::integer, 0))
    on conflict (user_id, id) do update set name = excluded.name, target_bps = excluded.target_bps, sort_order = excluded.sort_order;
  end loop;
  for v_a in select * from jsonb_array_elements(v_assign) loop
    update public.assets a set
      category_id = case when v_a ? 'categoryId' then v_a->>'categoryId' else a.category_id end,
      sector = case when v_a ? 'sector' then nullif(v_a->>'sector', '') else a.sector end
     where a.user_id = v_user and a.id = v_a->>'assetId';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'ไม่พบสินทรัพย์ที่จะจัดหมวด' using errcode = '23503'; end if;
  end loop;
  return jsonb_build_object('categories', jsonb_array_length(p_categories), 'assignments', jsonb_array_length(v_assign));
end $$;
revoke all on function public.save_categories(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_categories(jsonb, jsonb) to authenticated;
```
ข้อสังเกตของร่าง (ปรับตามผล security-auditor 21 พ.ย. 2569): (ก) `update assets` ไม่ไปกระตุ้นด่าน `assets_guard` (ทำงานเมื่อแก้ `account_id`) และ `assets_currency_guard` (แก้สกุล) จึงเลี่ยงด่านไม่ได้ · (ข) ชื่อซ้ำ/สลับชื่อ/รวมหมวดในการบันทึกครั้งเดียวทำได้เพราะ unique ของชื่อเป็น **deferrable initially deferred** (ตัวสร้าง unique index ธรรมดาไม่ deferred) + ลำดับ "ลบก่อนแทรก" · (ค) **ตาราง `assets` ผู้ใช้ยังมีสิทธิ์ update ทุกคอลัมน์อยู่แล้ว** (grant เดิมใน `invest_schema.sql`) ผู้ใช้จึงแก้ `sector`/`category_id` ของแถวตัวเองตรงๆ ได้โดยไม่ผ่าน RPC (ไม่ข้ามผู้ใช้ เพราะมี RLS + FK แบบ composite) · ถ้าจะจำกัดเป็นสิทธิ์รายคอลัมน์แบบ `accounts_update_name_only` ให้แยกเป็นงานต่างหาก (มี REVOKE จึงต้องรันเทสต์ SQL ครบทุกไฟล์) · (ง) ล็อกด้วย `pg_advisory_xact_lock` ต่อผู้ใช้แทน `for update` (ผู้ใช้ที่ยังไม่มีหมวดก็ล็อกได้ และไม่เกิด deadlock ระหว่างล็อกหมวดกับล็อกสินทรัพย์) · (จ) ระหว่างเซสชันนำเข้าเปิดอยู่ ฟังก์ชันล้มด้วย 55000 ตรงๆ (นโยบาย RLS แบบ restrictive ของ update/delete แค่กรองแถวเงียบๆ ทำให้ข้อความ "ไม่พบสินทรัพย์" เข้าใจผิด) · (ฉ) ตรวจชนิดและขนาด JSON ก่อน cast (เพดาน 64 KB ต่อพารามิเตอร์ ตัวเลขตรวจด้วย regex)

## 4. เทสต์ที่ต้องมี
- **ต้องมีเทสต์เส้นทางลบผู้ใช้จริง** (`admin:delete-user`/ฟังก์ชันลบผู้ใช้ของผู้ดูแล) และ `reset_my_ledger_step` ก่อน merge: ยืนยันว่า deferred trigger ไม่ล้มด้วย "permission denied" ตอน cascade (ผลตรวจ money-auditor · ยังไม่ได้ยืนยันบนฐานจริง)
- เทสต์ SQL ไฟล์ใหม่ `supabase/tests/categories_test.sql`: RLS ข้ามผู้ใช้ (อ่าน/แก้/ลบหมวดของคนอื่นไม่ได้ · กำหนด `category_id` ของสินทรัพย์ไปหมวดของคนอื่นไม่ได้ผ่าน FK) · เป้ารวม ≠ 10,000 ล้มตอน commit · ตั้งเป้าบางหมวด (บางหมวด null) ล้ม · ไม่ตั้งเลยผ่าน · ชื่อซ้ำ (ต่างตัวพิมพ์) ล้ม · เกิน 50 หมวดล้ม · ลบหมวด → สินทรัพย์กลับเป็น null · ผู้ใช้ must_change_password ได้ 42501 · เขียนขณะเซสชันนำเข้าเปิดถูกล็อก (ฟังก์ชันได้ 55000) · ชื่อ/sector ที่มีช่องว่างหน้าหลังหรือยาวเกิน หรืออักขระมองไม่เห็น/ตัวกลับทิศ ถูกปฏิเสธ · สลับชื่อสองหมวดในการบันทึกครั้งเดียวผ่าน · JSON เกิน 64 KB ได้ 22023 · ส่งการจัดหมวดโดยไม่ส่ง key `sector` แล้ว sector เดิมไม่หาย · สองเซสชันบันทึกพร้อมกันไม่ทำให้เป้ารวมผิด (advisory lock) · ล้างข้อมูล/ยกเลิกนำเข้าแล้วไม่เหลือหมวด · เพดาน 50 หมวดเสร็จในเวลา (< 1 วินาที)
- ตามกฎ migration ที่มี **GRANT/REVOKE + RLS + trigger → ต้องรันเทสต์ SQL ครบทุกไฟล์ใน `supabase/tests/`** + dry-run rollback ก่อนใส่ + `admin:live-contract` บน branch และบน `main` หลัง merge
- เทสต์ฝั่งเว็บ: จัดกลุ่มจาก sector · รวมหมวด · เป้ารวมต้อง 10,000 ก่อนกด Save · แสดงตารางตามแบบร่าง (มูลค่า/ลงทุน/กำไร/สัดส่วน/เทียบเป้า ใช้ฟังก์ชัน domain ที่มีอยู่ ไม่มีสูตรเงินในคอมโพเนนต์)

## 5. สิ่งที่ต้องแก้ตามมา (ไม่ใช่แค่ตารางใหม่)
1. **ไฟล์สำรอง/นำเข้า:** `BackupData` ส่วนลงทุน + `import_ledger_investments` + ตัวตรวจ `import_fx_verify` ต้องรองรับ `sector`, `category_id`, `asset_categories` (ข้อมูลผู้ใช้ต้องส่งออก/นำเข้าได้ครบ) · เป็น `create or replace function` (แบบเพิ่ม) แต่เป็นงานเสี่ยงที่ต้องมีเทสต์นำเข้า/ส่งออกวนกลับ
2. **ฟังก์ชันล้างข้อมูลและยกเลิกนำเข้า:** `asset_categories` ไม่ผูกกับ `accounts` จึง **ไม่ถูกลบตามเมื่อล้างข้อมูล** (การล้างลบ accounts → cascade ลบ assets เท่านั้น) ผู้ใช้กด "ล้างข้อมูล" แล้วชื่อหมวดและเป้าที่ตัวเองพิมพ์จะค้าง (PDPA) และชนกับการนำเข้าไฟล์สำรองภายหลัง → ใน migration เดียวกันต้อง `create or replace` `reset_my_ledger_step`, `import_ledger_abort` (และ `reset_my_ledger` ถ้ายัง grant อยู่ · ดู `20261109000400_batched_delete.sql`) ให้ `delete from public.asset_categories where user_id = v_user` พร้อมเทสต์ "ล้างข้อมูลแล้วไม่เหลือหมวด" · ลบผู้ใช้ทั้งบัญชี cascade ผ่าน `auth.users` อยู่แล้ว
3. ฟอร์มเพิ่มหุ้น (`UsStocksView`) เพิ่มช่อง Sector (เลือกจากรายการ GICS 11 กลุ่มหรือพิมพ์เอง ไม่บังคับ)
4. ฝั่งเว็บต้องแปลง errcode เป็นข้อความของเราเอง **ห้ามแสดงหรือ `console.log` ข้อความ DETAIL/payload ของฐานข้อมูล** (มี user_id/ชื่อหมวด/ยอดเงิน) · ตัวช่วย CSV ต้อง escape ค่าที่ขึ้นต้นด้วย `= + - @` (ใช้ `csvText` ที่แก้แล้วใน #247)
5. ปุ่ม Export/Import ในแบบร่าง 25: ตีความเป็น **ส่งออก/นำเข้าหมวดและเป้าเป็นไฟล์ CSV/JSON** (ใช้ตัวช่วย CSV ของ Report) · "See tutorial" ยังไม่ทำ

## 6. คำถามที่ต้องให้เจ้าของตัดสิน
1. **sector มาจากไหน:** (ก, แนะนำ) ผู้ใช้เลือกเองในฟอร์มหุ้น (รายการ GICS 11 กลุ่ม + พิมพ์เองได้ ไม่บังคับ) · (ข) ใส่ตารางจับคู่ ticker → sector ในแอป (ต้องดูแลข้อมูล เสี่ยงผิด ต้องให้ investment-expert ตรวจ) → รอ Phase B
2. **หุ้นที่ถืออยู่แต่ไม่มีหมวด (Uncategorized):** ให้ Rebalancing หยุดและบอกให้จัดหมวดก่อน (แนะนำ) หรือถือเป็นหมวดเป้า 0%
3. แบบร่างมีปุ่ม Import/Export/Create from scratch: ยืนยันตีความตามข้อ 5.4
