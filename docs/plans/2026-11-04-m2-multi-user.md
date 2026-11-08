# แผน M2: บัญชีผู้ใช้ + ฐานข้อมูลออนไลน์ (หลายผู้ใช้)

> เขียน 4 พ.ย. 2569 · **ฉบับ 2** (เปลี่ยนเป็น username + password แทน magic link ตามเจ้าของสั่ง 4 พ.ย. 2569) · สถานะ: ตัดสินใจครบแล้ว **ยังไม่ลงมือ M2-A** รอเจ้าของสร้างโปรเจกต์ Supabase และส่ง URL/key ตามข้อ 3
> อ้างอิง: `docs/decisions/2026-11-02-multi-user.md`, `docs/decisions/2026-11-04-m2-auth.md`, `docs/money-rules.md` (R1, R4, R6, R15, R16)

## 1. เป้าหมายและขอบเขต (ตัดสินแล้ว ไม่ถามซ้ำ)

- ผู้ใช้ ≤ 20 คน เจ้าของสร้างบัญชีให้เองใน Supabase Dashboard (ปิดสมัครเอง) · ไม่เก็บเงิน · งบ 0 บาท (Supabase Free + Vercel Hobby)
- ข้อมูลแยกรายคนด้วย RLS `auth.uid() = user_id` · ไม่มีการแชร์ ไม่มีกระปุกร่วม
- **ออนไลน์เป็นหลัก** Supabase คือแหล่งข้อมูลจริง (เจ้าของอนุมัติแก้ข้อความ "local-first" ใน CLAUDE.md แล้ว) · คง Dexie ไว้จน M2-D เสร็จ
- ฝั่งเว็บใช้เฉพาะ publishable (anon) key · **ห้าม `service_role` ในโค้ดเว็บ** · ไม่เอาข้อมูลการเงินจริงมาเป็นตัวอย่างหรือเทสต์

## 2. การตัดสินใจเรื่องล็อกอิน (เจ้าของ 4 พ.ย. 2569)

| เรื่อง | ตัดสิน |
|---|---|
| วิธีล็อกอิน | username + password ไม่ใช้อีเมลจริง ไม่มี SMTP |
| อีเมลภายใน | แปลง username → `<username>@users.money-buddy.internal` ผู้ใช้ไม่เห็น (ดู 4.5 ว่าตรวจอย่างไรและโดเมนสำรอง) |
| การสมัคร | ปิดสมัครเอง · ปิดยืนยันอีเมล · รหัสขั้นต่ำ 10 ตัว · เจ้าของสร้างบัญชีเองใน Dashboard |
| ล็อกอินครั้งแรก | บังคับเปลี่ยนรหัส · มีหน้าเปลี่ยนรหัสในตั้งค่า |
| ลืมรหัส | สคริปต์ reset รันในเครื่องเจ้าของเท่านั้น อ่าน service_role key จากไฟล์ **นอกโปรเจกต์** `C:\Users\owenn\.money-buddy-admin\admin.env` (เจ้าของสั่ง 4 พ.ย. 2569) ห้ามมีไฟล์ secret ในโฟลเดอร์โปรเจกต์ ห้ามอ่าน/แสดงค่า key ห้ามอยู่ในโค้ดเว็บ |
| PDPA | คงหน้ายินยอม, ส่งออกข้อมูล, ลบบัญชี (M2-E) |
| ก่อน M2-C | ตรวจช่วงปลอดภัยของสูตรรวมยอด (`periodTotals`, `cashBalance`/`netWorthAt`, `incomeChannels`, `runwayTenths`) เป็น Ticket **M2-pre** |

## 3. สิ่งที่เจ้าของต้องทำเอง (ผมทำแทนไม่ได้: สมัครบริการ / ใส่ key)

1. สร้างโปรเจกต์ Supabase (Free) ภูมิภาค Singapore · เก็บรหัสฐานข้อมูลไว้เอง
2. Authentication → Sign In / Providers → Email: **ปิด "Allow new users to sign up"**, **ปิด "Confirm email"**, ตั้ง **Minimum password length = 10** · ตั้ง Site URL = https://money-buddy-phi.vercel.app
3. ส่งให้ผม **เฉพาะ Project URL และ publishable (anon) key** ใส่ใน 2 ที่ด้วยชื่อตัวแปรนี้ (ไม่ใช่ความลับ แต่ผมก็ไม่อ่านไฟล์ `.env` — คุณใส่เอง): ไฟล์ `.env` ของโปรเจกต์ และ Vercel → Settings → Environment Variables (Production + Preview + Development)
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = publishable key (ขึ้นต้น `sb_publishable_` หรือ anon JWT)
   - ผมจะไม่ขอ service_role / secret key
4. **service_role / secret key ใส่เองในไฟล์ `C:\Users\owenn\.money-buddy-admin\admin.env`** (อยู่นอกโปรเจกต์ ไม่ถูก Vite โหลด ไม่ถูก `vercel env pull` เขียนทับ) บรรทัดละตัวแปร: `SUPABASE_URL=…` และ `SUPABASE_SERVICE_ROLE_KEY=…` (ถ้าโปรเจกต์ออก key แบบใหม่ ใช้ชื่อ `SUPABASE_SECRET_KEY` แทนได้) · ห้ามมี prefix `VITE_` · ใช้กับสคริปต์ `scripts/` เท่านั้น · ห้ามวางในแชท · ห้ามใส่ใน Vercel env หรือ GitHub Actions secrets
5. สร้างบัญชีผู้ใช้: แนะนำใช้สคริปต์ `scripts/create-user.mjs` (ทำใน M2-B) ซึ่งตั้งธงบังคับเปลี่ยนรหัสให้อัตโนมัติ · หรือทำมือใน Dashboard → Authentication → Users → Add user: email = `<username>@users.money-buddy.internal`, รหัสชั่วคราว ≥ 10 ตัว, ติ๊ก Auto Confirm User (ปลอดภัยเช่นกัน: trigger สร้าง profiles ให้อัตโนมัติโดยธงบังคับเปลี่ยนรหัสเป็น true — ดู 4.6 ข้อ 1)

เมื่อได้ URL + publishable key แล้ว ผมเริ่ม M2-A · ระหว่างนั้นทำ M2-0 และ M2-pre ได้โดยไม่ต้องใช้ key

## 4. สถาปัตยกรรม

### 4.1 โครงตาราง (Postgres, ทุกตารางเปิด RLS)

| ตาราง | คอลัมน์สำคัญ | หมายเหตุ |
|---|---|---|
| `accounts` | `id text`, `user_id uuid default auth.uid()`, `type`, `name`, `currency`, `sort_order`, `archived`, ... | PK `(user_id, id)` |
| `entries` | `id text`, `user_id`, `date date`, `memo`, `source`, `created_at`, `group_id`, `bill jsonb` | `bill` = `{id, cycle, before?}` ตามที่ทำใน #6 |
| `lines` | `user_id`, `entry_id`, `idx`, `account_id`, `amount bigint` | FK `(user_id, entry_id)` ON DELETE CASCADE |
| `bills` | ฟิลด์ตาม `domain/bills/types.ts` | |
| `settings` | `user_id pk`, `value jsonb` | แทน `meta` แถว settings |

- `amount bigint` + `CHECK (abs(amount) <= 9007199254740991)` — ให้ตรง R1 / `Number.isSafeInteger` ฝั่งเว็บ (ไม่ปล่อยให้ค่าที่ JS อ่านแล้วเพี้ยนเข้าฐานข้อมูล)
- ยอดคงเหลือ **ไม่เก็บ** คำนวณจากบรรทัดเสมอ (R16)
- สมดุลศูนย์ต่อสกุลเงิน: constraint trigger แบบ `DEFERRABLE INITIALLY DEFERRED` บน `lines` ตรวจ `sum(amount) = 0` ต่อ `(entry_id, currency ของบัญชี)` และ ≥ 2 บรรทัด ตอน commit
- ลบ/แก้บัญชีที่มีรายการ: ใช้ `archived` (ไม่ลบจริง) ตามที่โค้ดปัจจุบันทำ

### 4.2 RLS

- ทุกตาราง: policy `FOR ALL TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()))`
- `anon` role ไม่มีสิทธิ์ใดๆ · ห้ามเปิด policy ที่อ้าง `user_metadata` (ผู้ใช้แก้เองได้)
- ฟังก์ชัน RPC ทุกตัวเป็น `SECURITY INVOKER` (RLS ยังมีผล) ตั้ง `search_path` ชัดเจน
- รัน `get_advisors` (security) หลังทุก migration

### 4.3 การเขียนแบบ atomic ผ่าน RPC

ฟังก์ชันใน `repository.ts` ที่ต้องเป็นธุรกรรมเดียว (Dexie `transaction`) ย้ายเป็นฟังก์ชัน SQL เพื่อไม่ให้เขียนครึ่งเดียวเมื่อเน็ตหลุด:

| ฟังก์ชันเดิม | RPC |
|---|---|
| `appendEntry` / `updateEntry` / `deleteEntry` | `create_entry(entry jsonb)`, `update_entry`, `delete_entry` (กฎ: source `system` แก้/ลบไม่ได้, `recurring` ที่มี `bill` ลบ = ยกเลิกการจ่าย) |
| `payBill` / `undoPayBill` | `pay_bill(bill_id, expected_cycle, ...)` สร้างรายการ + ตั้ง `lastPaidMonth` ในธุรกรรมเดียว |
| `cancelBillPayment` / `cancelLatestBillPayment` | `cancel_bill_payment(entry_id)` |
| `saveInitialLedger` | `setup_ledger(accounts, entries)` (ทำได้เมื่อผู้ใช้ยังไม่มีข้อมูล) |

กฎที่ต้องไม่หายระหว่างย้าย: R15 (`lastPaidMonth` ไม่เกินเดือนปัจจุบัน, `before < cycle`, `bill` ใช้ได้เฉพาะ `recurring`) — ตรวจซ้ำทั้งฝั่งเว็บ (domain) และฝั่งฐานข้อมูล

### 4.4 ฝั่งเว็บ (M2-C)

- `src/storage/repository.ts` ตอนนี้รับ `db: MoneyDB` ตรงๆ → แยก **interface `LedgerRepository`** (async ทุกเมธอด) + `DexieRepository` (โค้ดเดิม ย้ายเฉยๆ) + `SupabaseRepository`
- `src/app/` และ `src/ui/` รับ repository ผ่าน context ไม่ import `db` ตรงๆ (ปัจจุบัน `instance.ts` เป็น singleton)
- domain ไม่เปลี่ยน (ไม่แตะ DOM/ฐานข้อมูล) — สูตรเงินยังอยู่ฝั่งเว็บ ฐานข้อมูลตรวจเพียงความถูกต้องเชิงโครงสร้าง
- ชุดเทสต์สัญญา (contract tests) ชุดเดียวรันกับทั้งสอง implementation: `tests/unit/storage.test.ts`, `billsStorage`, `billsPay`, `billCancel` ปรับให้รับ factory
- Supabase client ตัวเดียว `src/storage/supabase.ts` อ่านเฉพาะ `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`

### 4.5 ล็อกอินด้วย username + password (M2-B)

**username → อีเมลภายใน**
- กฎ username: `a-z 0-9 . _ -` ยาว 3-32 ตัว แปลงเป็นตัวพิมพ์เล็กก่อนเสมอ (ฟังก์ชัน domain ล้วน `usernameToEmail` มีเทสต์ขอบเขต: ว่าง, ยาวเกิน, อักขระแปลก, ตัวพิมพ์ใหญ่, มี `@`)
- อีเมล = `<username>@users.money-buddy.internal` ผู้ใช้เห็นแต่ username
- **ยังตรวจไม่ได้จนกว่าจะมีโปรเจกต์:** GoTrue ตรวจรูปแบบอีเมลและอาจปฏิเสธโดเมนที่ไม่มีอยู่ ต้องทำ spike ต้น M2-B: สร้างผู้ใช้ทดสอบผ่าน Admin API (`email_confirm: true`) แล้วล็อกอินด้วยรหัสผ่าน
  - ถ้า `.internal` ไม่ผ่าน เสนอตามลำดับ: `users.money-buddy.invalid` (TLD `.invalid` สงวนตาม RFC 2606 ห้ามมีอยู่จริง) → `users.money-buddy.test` (RFC 2606)  (ไม่ใช้โดเมนจริงแม้ไม่ตั้ง MX: ถ้าโดเมนหลุดมือแล้วมีคนตั้ง MX อีเมลกู้รหัสจาก Dashboard จะไปถึงเขา)
  - เก็บโดเมนเป็นค่าคงที่ค่าเดียว (`AUTH_EMAIL_DOMAIN`) เปลี่ยนที่เดียวได้
- ไม่ส่งอีเมลใดๆ: ไม่ใช้ magic link / reset ทางอีเมล / `signUp` จากเว็บ (ปิดที่ Dashboard และไม่มีโค้ด `signUp` ในเว็บ — มีเทสต์ค้นโค้ดยืนยัน)

**ข้อความผิดพลาด:** ล็อกอินผิดทุกกรณี (ไม่มีผู้ใช้ / รหัสผิด) แสดงข้อความเดียวกัน "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" (กันเดาว่ามี username ไหนอยู่) · ถูกจำกัดอัตรา (rate limit) แสดงแยกว่า "ลองใหม่ภายหลัง"

**บังคับเปลี่ยนรหัสครั้งแรก — ฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่ฝั่ง UI**
- ตาราง `profiles(user_id pk → auth.users on delete cascade, must_change_password bool, consented_at timestamptz)` เปิด RLS: ผู้ใช้ **อ่าน** แถวตัวเองได้ แต่ **เขียนไม่ได้** (ไม่มี policy insert/update) ยกเว้น `consented_at` ผ่าน RPC เฉพาะกิจ (M2-E)
- ธงอยู่ในตาราง ไม่ใช่ `user_metadata` (ผู้ใช้แก้เองได้) และไม่เชื่อธงฝั่งเว็บ
- trigger `AFTER UPDATE OF encrypted_password ON auth.users` ตั้ง `must_change_password = false` — ธงเคลียร์ได้เฉพาะเมื่อรหัสเปลี่ยนจริง
- policy `AS RESTRICTIVE` บนตารางข้อมูลทุกตาราง: ผ่านเมื่อ `must_change_password` ของ `auth.uid()` เป็น false (ผ่านฟังก์ชัน `SECURITY DEFINER` ที่ตั้ง `search_path`) → ยังไม่เปลี่ยนรหัส = อ่าน/เขียนข้อมูลการเงินไม่ได้แม้เรียก API ตรงๆ
- เว็บ: หลังล็อกอินถ้า `must_change_password` เป็น true แสดงหน้าเปลี่ยนรหัสเท่านั้น (`auth.updateUser({ password })` รหัสใหม่ ≥ 10 ตัว ไม่เท่ากับ username)
- หน้าเปลี่ยนรหัสในตั้งค่า: ฟังก์ชันเดียวกัน · ให้กรอกรหัสเดิมซ้ำ (เรียก `signInWithPassword` ตรวจก่อน)
- ต้องยืนยันใน spike: trigger บน `auth.users` สร้างได้ผ่าน migration ของโปรเจกต์ (ทั่วไปทำได้) ถ้าไม่ได้ ให้ใช้ Edge Function ฝั่งเซิร์ฟเวอร์ตรวจแล้วเคลียร์ธง

**สคริปต์ที่เจ้าของรันในเครื่องเท่านั้น** (`scripts/` อยู่นอก `src/` จึงไม่เข้า bundle ของเว็บ)
- `create-user.mjs <username>` สร้างผู้ใช้ (`email_confirm: true`) + สุ่มรหัสชั่วคราว 16 ตัวพิมพ์ออกหน้าจอครั้งเดียว + ตั้ง `must_change_password = true`
- `reset-password.mjs <username>` ตั้งรหัสชั่วคราวใหม่ **แล้วตั้งธงบังคับเปลี่ยนรหัสหลังเปลี่ยนรหัสเสร็จ** (ลำดับสำคัญ เพราะ trigger เคลียร์ธงเมื่อรหัสเปลี่ยน) และเพิกถอน session เดิมของผู้ใช้
- อ่านค่าจากพาธตายตัว `<โฟลเดอร์บ้านผู้ใช้>/.money-buddy-admin/admin.env` ผ่าน `process.loadEnvFile()` (ไม่รับพาธจากอาร์กิวเมนต์) · **ปฏิเสธการรันถ้าพาธนั้นอยู่ในโฟลเดอร์โปรเจกต์** · **ไม่พิมพ์ key ไม่ log ไม่ใส่ใน error** (ครอบ try/catch ข้อความผิดพลาดต้องไม่มีค่า env) · ปฏิเสธการรันถ้าไม่มี `SUPABASE_SERVICE_ROLE_KEY` หรือพบตัวแปรชื่อ `VITE_*SERVICE*` · reset ปฏิเสธถ้าไม่มีผู้ใช้นั้น · รหัสชั่วคราวเป็นสิ่งเดียวที่พิมพ์
- เทสต์รักษากติกา (รันใน `npm test`): (1) ไม่พบ `service_role` / `SERVICE_ROLE` ใน `src/` (2) สคริปต์อ้างพาธ `.money-buddy-admin/admin.env` และไม่อ้าง `.env.local`/`.env` ในโปรเจกต์ (3) `scripts/*.mjs` ไม่ `console.*` ตัวแปร key (4) `package.json` ไม่มี script ที่ส่งค่า key ผ่านบรรทัดคำสั่ง · และตรวจ `dist/` หลัง build ว่าไม่มีสตริง `service_role`
- Supabase Free ไม่มี leaked-password protection (ของ Pro) → ตรวจรหัสอ่อนฝั่งเว็บเอง: ขั้นต่ำ 10 ตัว, ไม่อยู่ในรายการรหัสยอดนิยมสั้นๆ ที่ฝังไว้, ไม่เท่ากับ username

**ลบบัญชีตัวเอง (M2-E):** ฟังก์ชัน `delete_my_account()` แบบ `SECURITY DEFINER` ลบแถวใน `auth.users` ของ `auth.uid()` เท่านั้น (ทุกตารางข้อมูลมี FK `user_id → auth.users ON DELETE CASCADE`) ต้องกรอกรหัสผ่านยืนยัน + กล่องยืนยัน

### 4.6 ข้อกำหนดความปลอดภัยเพิ่มจากผลตรวจ security-auditor (4 พ.ย. 2569)

ต้องทำตามนี้ใน M2-A / M2-B (ข้อที่ไม่แน่ใจเรื่องพฤติกรรม Supabase ให้ยืนยันใน spike ก่อนเขียนจริง)

**ธงบังคับเปลี่ยนรหัส ต้อง "ปิดไว้ก่อน"**
1. trigger `AFTER INSERT ON auth.users` สร้างแถว `profiles` อัตโนมัติ `must_change_password default true` (`insert … on conflict do nothing`) — สร้างผู้ใช้ด้วยมือใน Dashboard จึงปลอดภัยโดยปริยาย
2. ฟังก์ชันตรวจ `private.can_use_data()` ผ่านเมื่อ `EXISTS (… profiles where user_id = auth.uid() and must_change_password = false)` เท่านั้น (ไม่มีแถว = ไม่ผ่าน, `auth.uid()` เป็น null = ไม่ผ่าน) · **ไม่รับพารามิเตอร์** · อยู่ใน schema `private` (ไม่เปิดผ่าน API) · `SECURITY DEFINER`, `set search_path = ''`, `stable`, `revoke execute from public, anon`, `grant` ให้ `authenticated` · เรียกใน policy เป็น `(select private.can_use_data())`
3. trigger เคลียร์ธงมี `WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)` และอยู่ใน `private` เช่นกัน · เพิ่ม `password_changed_at` ไว้ตรวจย้อนหลัง · trigger ทุกตัวบน `auth.users` ต้องเรียบที่สุด (error ใน trigger = GoTrue สร้างผู้ใช้/เปลี่ยนรหัสไม่ได้ทั้งระบบ) และมีเทสต์ SQL ว่าสร้างผู้ใช้/เปลี่ยนรหัสยังผ่าน
4. เทสต์ M2-A: ผู้ใช้ที่ไม่มีแถว `profiles` อ่าน/เขียนไม่ได้ · ผู้ใช้ anonymous (ถ้าเผลอเปิด) อ่าน/เขียนไม่ได้
5. ข้อยกเว้นของกฎ "RPC ทุกตัวเป็น INVOKER" มี 3 ตัว: ตัวตรวจธง, trigger บน `auth.users`, `delete_my_account` — แต่ละตัวต้องมี `search_path = ''`, อ้างชื่อเต็ม, `revoke … from public, anon`

**Session และการ reset**
6. `reset-password.mjs` ลำดับ: **เพิกถอน session/refresh token ทั้งหมดของผู้ใช้ → ตั้งรหัสชั่วคราว → ตั้งธง `must_change_password = true` → อ่านธงกลับมาตรวจ** ถ้าขั้นไหนล้มหรือธงไม่เป็น true ให้จบด้วย exit code ≠ 0 และเตือนชัดว่า "ห้ามส่งรหัสให้ผู้ใช้" (กันธงเป็น false ค้างพร้อมรหัสที่เจ้าของเห็นแล้ว)
7. ลดอายุ JWT (JWT expiry) จาก 3600 เหลือ 300-600 วินาที · ทางเลือกแข็งกว่า: `can_use_data()` ตรวจด้วยว่า `auth.jwt()->>'session_id'` ยังมีใน `auth.sessions`
8. เหตุผล: ธงกันได้เฉพาะการเข้าถึงข้อมูลการเงิน คนถือ token เก่า (เครื่องที่ถูกขโมย) ยังเรียก `auth.updateUser({ password })` เองแล้ว trigger เคลียร์ธงให้ได้ และ "กรอกรหัสเดิมซ้ำ" ทำฝั่งเว็บเท่านั้น (Secure password change ของ Supabase ต้องใช้ OTP ทางอีเมล ซึ่งระบบนี้ไม่มี) → ข้อ 6-7 คือด่านจริง

**`delete_my_account()` และ RPC ยินยอม**
9. ตรวจ `must_change_password = false` เอง · รับรหัสผ่านและตรวจฝั่งเซิร์ฟเวอร์กับ `auth.users.encrypted_password` (ถ้า `crypt()` ทำไม่ได้ใน spike ให้ใช้ Edge Function ที่เรียก Admin API) · ลบเฉพาะ `where id = auth.uid()` และจบทันทีถ้า `auth.uid()` เป็น null
10. RPC `consented_at` ตั้ง `now()` ฝั่งเซิร์ฟเวอร์ ไม่รับเวลาจากเว็บ

**โครงตารางและกฎเงิน**
11. ทุกตารางมี FK `user_id → auth.users ON DELETE CASCADE` · `lines.account_id` ใช้ composite FK `(user_id, account_id) → accounts(user_id, id)` · RPC ตรวจ `bill.id` ว่าเป็นของ `auth.uid()` · trigger สมดุลเป็น INVOKER และ join ด้วย `user_id` เสมอ
12. trigger สมดุล (≥ 2 บรรทัด, ผลรวม 0) ต้องข้ามเมื่อ entry ไม่มีอยู่แล้ว · FK อื่นใช้ `NO ACTION` ไม่ใช้ `RESTRICT` → การลบทั้งก้อนจาก `delete_my_account` ไม่ล้ม · เทสต์ "ลบบัญชีแล้วทุกตารางว่าง" (PDPA)
13. **R15 ฝั่งเซิร์ฟเวอร์:** policy แบบ `FOR ALL` เปิดให้เขียนตารางตรงผ่าน REST ได้ จึงข้ามกฎที่อยู่ใน RPC (source `system` แก้ไม่ได้, `lastPaidMonth`) → ย้ายกฎเป็น CHECK/trigger บนตาราง (แนะนำ เพราะยังเป็น INVOKER) เขตเวลา "เดือนปัจจุบัน" ใช้ `Asia/Bangkok` · ต้องจดตัวเลือกใน `docs/decisions/`
14. ทุก view ต้อง `with (security_invoker = true)` · `revoke all on all tables in schema public from anon`

**ตั้งค่า Dashboard เพิ่ม:** ปิด Anonymous sign-ins · ปิด Phone และ provider อื่นทั้งหมด · ถ้ามี Password requirements (ตัวเล็ก/ใหญ่/ตัวเลข) ให้ตั้งที่เซิร์ฟเวอร์ด้วย เพราะการตรวจรหัสอ่อนฝั่งเว็บข้ามได้ด้วยเรียก `updateUser` ตรง · เทสต์ M2-F: เรียก `/auth/v1/signup` ด้วย anon key ต้องถูกปฏิเสธ

**key และ secret**
15. key โปรเจกต์ใหม่เป็นรูป `sb_publishable_…` / `sb_secret_…` ไม่ใช่ JWT `anon`/`service_role` เสมอไป · เทสต์ค้น `service_role|SERVICE_ROLE|sb_secret_|c2VydmljZV9yb2xl` (base64 ของ `service_role`) ใน `src/`, `dist/`, `scripts/` และ `git diff --cached` · สคริปต์รองรับทั้งสองชื่อ (`SUPABASE_SECRET_KEY` หรือ `SUPABASE_SERVICE_ROLE_KEY`)
16. **ที่เก็บ secret (เจ้าของตัดสิน 4 พ.ย. 2569):** ไฟล์นอกโปรเจกต์ `C:\Users\owenn\.money-buddy-admin\admin.env` เท่านั้น ห้ามมีไฟล์ secret ในโปรเจกต์ (Vite โหลด `.env.local` เอง และ `vercel env pull` เขียนทับได้ จึงไม่ใช้) → เทสต์ว่า `vite.config.ts` ไม่มี `envPrefix`, `loadEnv(`, หรือ `process.env` ใน `define` (กันไว้เผื่อมีคนเพิ่มภายหลัง) · **ห้ามใส่ secret ใน Vercel env หรือ GitHub Actions secrets เด็ดขาด** · `.claude/settings.json` deny การอ่านพาธนี้และ `.env*` แล้ว (ดูข้อ 19)
19. **กฎ deny ของ Claude Code (เจ้าของอนุญาต 4 พ.ย. 2569):** `Read(./.env*)`, `Read(**/.env*)`, `Read` / `Edit` / `Write` ของ `~/.money-buddy-admin/**`, และคำสั่ง Bash/PowerShell ที่อ่านหรือคัดลอกไฟล์เหล่านี้ (cat, type, Get-Content, grep, Select-String, cp, node ฯลฯ) · ข้อจำกัด: กฎจับจากข้อความคำสั่ง จึงกันไม่ครบทุกรูปแบบ (alias, สคริปต์ที่เปิดไฟล์ข้างใน, ตัวแปรประกอบพาธ) กติกา "ห้ามอ่านค่า key" ยังต้องถือตามเสมอ · ผลข้างเคียง: คำสั่ง `grep`/`cat` ที่มี `.env` อยู่ในอาร์กิวเมนต์ถูกบล็อกด้วย (ใช้เครื่องมือ Grep/Read แทน)
17. สคริปต์: พิมพ์เฉพาะ `err.message`/`err.status` ห้าม `console.error(err)` ทั้งก้อน · ห้ามรับรหัสหรือ key ทางอาร์กิวเมนต์ (ค้างใน history) · เตือนให้ส่งรหัสชั่วคราวให้ผู้ใช้ทางช่องส่วนตัว
18. เทสต์ M2-F ที่ต้องใช้ฐานข้อมูลจริงรันในเครื่องหรือบน branch DB เท่านั้น ไม่ใส่ secret ใน CI

**สมมติฐานที่ต้องยืนยันใน spike (ผลที่คาด → ทางสำรอง)**

| เรื่อง | ผลที่คาด | ทางสำรองถ้าไม่เป็นจริง |
|---|---|---|
| Admin `updateUserById({password})` เพิกถอน refresh token เดิมไหม | ไม่แน่ใจ | RPC แบบ DEFINER เรียกได้เฉพาะ `service_role` ลบ `auth.sessions`/`auth.refresh_tokens` ของผู้ใช้นั้น |
| `updateUser` ด้วยรหัสเดิมถูกปฏิเสธไหม (same_password) | ควรปฏิเสธ | trigger ใช้ `WHEN` เทียบ hash เดิม/ใหม่แล้ว (ข้อ 3) — ถ้ารหัสเดิมได้ hash ใหม่ (salt) ต้องเทียบด้วย `crypt()` ก่อนเคลียร์ธง |
| GoTrue แก้ `encrypted_password` เองกรณีอื่น (rehash ตอนล็อกอิน) ไหม | ไม่แน่ใจ | เพิ่มเงื่อนไขเคลียร์ธงเฉพาะเมื่อ `updated_at`/เหตุการณ์เปลี่ยนรหัสจริง หรือใช้ Edge Function |
| สร้าง trigger บน `auth.users` ผ่าน migration ได้ไหม | ทำได้ (ตัวอย่างในเอกสาร Supabase) | Edge Function + Admin API |
| role เจ้าของฟังก์ชัน DEFINER ลบ `auth.users` / ใช้ `crypt()` ได้ไหม | ไม่แน่ใจ | Edge Function ที่เรียก Admin API |
| โดเมน `.internal` ผ่าน GoTrue ไหม | อาจถูกปฏิเสธ | `.invalid` → `.test` (ข้อ 4.5) |

**ความเสี่ยงที่ยอมรับ:** rate limit ของ `/token` คิดต่อ IP ไม่ใช่ต่อบัญชี (เดารหัสจากหลาย IP ไม่ถูกจำกัด) — ยอมรับเพราะรหัส ≥ 10 ตัวและผู้ใช้ ≤ 20 คน · access token ที่ออกไปแล้วใช้ได้จนหมดอายุ (ลดด้วยข้อ 7) · สูตรเงินคำนวณฝั่งเว็บ (ยอดไม่ถูกเก็บ กระทบเฉพาะข้อมูลตัวเอง) ส่วน R16 บังคับที่ trigger ฝั่งเซิร์ฟเวอร์

## 5. Ticket (1 Ticket = 1 PR, เรียงตามลำดับ)

| Ticket | เนื้อหา | ผู้ตรวจ | เกณฑ์เสร็จ |
|---|---|---|---|
| **M2-0** | แผนฉบับ 2 (รวมผลตรวจ security-auditor ข้อ 4.6) + `docs/decisions/2026-11-04-m2-auth.md` + แก้ข้อความ "local-first" ใน CLAUDE.md (เจ้าของอนุมัติแล้ว) | security-auditor (ตรวจแผน) | ผู้ตรวจไม่พบช่องร้ายแรง · เจ้าของ merge |
| **M2-pre** | ตรวจช่วงปลอดภัยของ `periodTotals`, `sumNatural`/`cashBalance`/`netWorthAt`, `incomeChannels`, `runwayTenths` (โยน `RangeError`) + try/catch ที่ `LedgerView.tsx` และจุดเรียกอื่น | money-auditor + design-critic | เทสต์ขอบเขตครบ · หน้าไม่ล้มเมื่อยอดเกิน (ไม่ต้องใช้ key) |
| **M2-A** | migration SQL (`supabase/migrations/`): ตาราง, `profiles`, CHECK, trigger สมดุล, RLS + restrictive policy, RPC · เทสต์ SQL (สมดุลศูนย์, ยอดเกินช่วง, ข้ามผู้ใช้, ธงเปลี่ยนรหัส) | money-auditor + security-auditor | ใส่ผ่าน branch DB ก่อน (`create_branch`) แล้วค่อย apply · advisors ไม่มี error · **ต้องมี URL/key** |
| **M2-B** | spike โดเมนอีเมล → `usernameToEmail` + หน้าเข้าสู่ระบบ + บังคับเปลี่ยนรหัส + เปลี่ยนรหัสในตั้งค่า + ออกจากระบบ + guard ทั้งแอป + `scripts/create-user.mjs`, `reset-password.mjs` + เทสต์รักษากติกา key | security-auditor + design-critic | ไม่ล็อกอิน = เห็นแต่หน้าเข้าสู่ระบบ · ไม่มีหน้า/โค้ดสมัคร · ยังไม่เปลี่ยนรหัส = ข้อมูลอ่านไม่ได้แม้เรียก API ตรง |
| **M2-C** | interface `LedgerRepository` + `DexieRepository` (ย้ายโค้ดเดิม) + `SupabaseRepository` + contract tests | money-auditor | เทสต์เดิมทั้งหมดผ่านกับ Dexie · ชุดเดียวกันผ่านกับ Supabase |
| **M2-D** | นำเข้าไฟล์สำรอง JSON เดิม → RPC · ตรวจ R16 ก่อนส่ง · รายงานผล · ไม่ทับข้อมูลที่มีอยู่ · **สำรอง JSON ก่อนทุกครั้ง** | money-auditor + security-auditor | นำเข้าซ้ำไม่ซ้ำซ้อน · ข้อมูลเสียถูกปฏิเสธทั้งก้อน |
| **M2-E** | PDPA: นโยบาย (ระบุว่าเจ้าของโปรเจกต์เห็นข้อมูลได้จากหน้าแอดมิน), ยินยอมก่อนใช้ (`consented_at`), ส่งออก JSON, ลบบัญชี+ข้อมูล | security-auditor + design-critic | ลบแล้วข้อมูลหายจริงทุกตาราง |
| **M2-G** | ล็อก `bills.last_paid_month` ให้เปลี่ยนได้เฉพาะผ่านเส้นทางจ่าย/ยกเลิกบิล (trigger: ห้าม UPDATE/INSERT ค่านี้ตรงๆ ผ่าน REST; เส้นทางจ่าย/ยกเลิกที่ trigger `entries_bill_link`/`entries_guard` ทำอยู่ผ่านได้) · **ต้องเสร็จก่อนเชิญผู้ใช้จริง** (เจ้าของสั่ง 9 พ.ย. 2569, R15 "ทุกเส้นทาง") · addBill ที่ส่ง lastPaidMonth มา (เช่น นำเข้า JSON) ต้องมีทางเฉพาะกิจใน M2-D | security-auditor + money-auditor | ผู้ใช้เรียก PATCH bills ตั้ง last_paid_month ตรงๆ แล้วถูกปฏิเสธ · จ่าย/ยกเลิก/นำเข้ายังทำงาน |
| **M2-F** | ทดสอบ 2 ผู้ใช้อ่านข้อมูลกันไม่ได้ (อ่าน/เขียน/ลบ/RPC) เป็นเทสต์อัตโนมัติ + ผู้ใช้จริงคนแรก | security-auditor | ผู้ใช้ B เรียก RPC ด้วย id ของ A แล้วไม่เห็น/แก้ไม่ได้ |

ข้อกำหนดทุก Ticket: branch `auto/m2-*` จาก `origin/main` · TDD · `npm test` + `typecheck` + `build` · commit ระบุกฎ · **ก่อน migration ที่กระทบข้อมูลจริงต้องมี Snapshot/สำรอง** (R6) · **หยุดถามเจ้าของเมื่อต้องใช้ URL/key หรือแตะข้อมูลจริง**

## 6. ความเสี่ยงและการป้องกัน

| ความเสี่ยง | การป้องกัน |
|---|---|
| ข้อมูลรั่วข้ามผู้ใช้ | RLS ทุกตาราง + M2-F เป็นเทสต์อัตโนมัติ + security-auditor ทุก Ticket |
| service_role key หลุด/ถูกฝังในเว็บ | อยู่นอกโปรเจกต์ (`.money-buddy-admin/admin.env`) ชื่อไม่มี `VITE_` · ใช้เฉพาะ `scripts/` · เทสต์ค้น `src/` `dist/` `scripts/` · deny อ่านไฟล์ใน settings |
| เดารหัส (brute force) | รหัส ≥ 10 ตัว + rate limit ของ Supabase Auth + ข้อความล็อกอินผิดเหมือนกันทุกกรณี · ผู้ใช้ ≤ 20 คน |
| รหัสชั่วคราวรั่ว | สุ่ม 16 ตัว แสดงครั้งเดียว บังคับเปลี่ยนก่อนใช้ข้อมูล (บังคับที่ RLS) |
| ลืมรหัสแล้วไม่มีทางกู้ (ไม่มีอีเมล) | เจ้าของรัน `reset-password.mjs` ให้ · ผู้ใช้ควรส่งออก JSON สำรองเป็นประจำ |
| โดเมนอีเมลภายในถูกปฏิเสธ | spike ต้น M2-B + โดเมนสำรอง `.invalid` / `.test` (ข้อ 4.5) |
| สมุดบัญชีไม่สมดุลเพราะเขียนครึ่งเดียว | RPC ธุรกรรมเดียว + trigger ตรวจตอน commit |
| ตัวเลขใหญ่เกิน JS | `CHECK abs(amount) <= 2^53-1` + ฝั่งเว็บโยน `RangeError` + M2-pre |
| โปรเจกต์ฟรีถูกพัก (7 วันไม่ใช้) | ยอมรับแล้ว กดเปิดคืนได้ ข้อมูลไม่หาย · สำรอง JSON เป็นประจำ |
| เปลี่ยน repository แล้ว UI พัง | M2-C ใช้ contract tests ชุดเดียวทั้งสองฝั่ง |
| ผู้ใช้เดิมทำข้อมูลหาย | คง Dexie จนกว่า M2-D เสร็จและเจ้าของยืนยัน · ไม่ลบอะไรโดยไม่ถาม |
| เกินโควตาฟรี (500MB DB, 50k MAU) | ผู้ใช้ ≤ 20 คน ข้อมูลข้อความล้วน ไม่เก็บรูปสลิป |

## 7. สิ่งที่ยังไม่รวมในแผนนี้ (ตั้งใจ)

- ซิงก์ offline สองทาง · ล็อกอินด้วย Google / magic link / อีเมลจริง · 2FA · แอปมือถือ · แชร์ข้อมูลระหว่างผู้ใช้ · เก็บเงิน
