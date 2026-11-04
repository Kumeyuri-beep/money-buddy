# แผน M2: บัญชีผู้ใช้ + ฐานข้อมูลออนไลน์ (หลายผู้ใช้)

> เขียน 4 พ.ย. 2569 · สถานะ: **แผนเท่านั้น ยังไม่ลงมือ** · รอเจ้าของตอบคำถามข้อ 2 และสมัคร Supabase (ข้อ 3)
> อ้างอิง: `docs/decisions/2026-11-02-multi-user.md` (ขอบเขตที่ตัดสินแล้ว), `docs/money-rules.md` (R1, R4, R6, R15, R16)

## 1. เป้าหมายและขอบเขต (ตัดสินแล้ว ไม่ถามซ้ำ)

- ผู้ใช้ ≤ 20 คน เชิญเท่านั้น (ปิดสมัครเอง) · ไม่เก็บเงิน · งบ 0 บาท (Supabase Free + Vercel Hobby)
- ข้อมูลแยกรายคนด้วย RLS `auth.uid() = user_id` · ไม่มีการแชร์ ไม่มีกระปุกร่วม
- ห้ามใส่ `service_role` key ในโค้ดเว็บ · ใช้เฉพาะ publishable (anon) key ใน `.env` / Vercel env
- ไม่เอาข้อมูลการเงินจริงมาเป็นตัวอย่างหรือเทสต์

## 2. คำถามที่ต้องให้เจ้าของตัดสินก่อนลงมือ (ผมแนะนำตัวหนา)

1. **โมเดลข้อมูล:** (ก) **ออนไลน์เป็นหลัก — Supabase คือแหล่งจริง, Dexie เก็บเฉพาะโหมดทดลองไม่ล็อกอิน** (ข) offline-first ซิงก์สองทาง
   — เหตุผลที่แนะนำ (ก): ซิงก์สองทางกับสมุดบัญชีคู่ที่ต้องสมดุลเสมอ (R16) ซับซ้อนและเสี่ยงข้อมูลเพี้ยน ผู้ใช้เป็นเว็บเดสก์ท็อปที่ออนไลน์อยู่แล้ว · ข้อเสีย: ใช้ตอนไม่มีเน็ตไม่ได้ (CLAUDE.md เขียนว่า local-first จึงต้องแก้ข้อความเป็น "ข้อมูลเป็นของผู้ใช้ ส่งออกได้เสมอ" — **เจ้าของต้องอนุมัติ**)
2. **วิธีล็อกอิน:** (ก) **Magic link อีเมล** (ข) Google (ค) ทั้งสอง — แนะนำ (ก) ก่อน ตั้งค่าน้อยสุด เพิ่ม Google ภายหลังได้
3. **ผู้ใช้เดิมของเครื่องนี้:** ข้อมูล Dexie เดิมของเจ้าของนำเข้าขึ้นบัญชีใหม่ผ่าน M2-D (ต้องสำรอง JSON ก่อนทุกครั้ง)
4. **โหมดไม่ล็อกอิน (Dexie เดิม):** แนะนำ **คงไว้เป็นโหมดทดลองอ่าน/เขียนในเครื่องจนกว่า M2-D เสร็จ แล้วค่อยตัดสินใจปิด** เพื่อไม่ทำข้อมูลเดิมหาย

## 3. สิ่งที่เจ้าของต้องทำเอง (ผมทำแทนไม่ได้ ตามกติกาโหมดทำงานเอง: สมัครบริการ / ใส่ key)

1. สมัคร/สร้างโปรเจกต์ Supabase (แพ็กเกจ Free) ภูมิภาคใกล้ไทย (Singapore) ตั้งรหัสฐานข้อมูลเก็บไว้ในที่ปลอดภัย
2. ใน Dashboard → Authentication: **ปิด "Allow new users to sign up"**, ตั้ง Site URL = https://money-buddy-phi.vercel.app และเพิ่ม `http://localhost:5173` ใน Redirect URLs
3. คัดลอก **Project URL** และ **publishable (anon) key** → ใส่ `.env` ของเครื่อง (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) และ Vercel → Settings → Environment Variables · **ห้ามส่ง service_role key ให้ผมหรือใส่ในโค้ด**
4. (ภายหลัง M2-F) เชิญผู้ใช้ผ่าน Dashboard → Authentication → Invite user

เมื่อเจ้าของทำข้อ 1-3 แล้ว บอกผม ผมจะตรวจว่าตัวแปรถูกตั้ง (ไม่ดูค่า) แล้วเริ่ม M2-A

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

## 5. Ticket (1 Ticket = 1 PR, เรียงตามลำดับ)

| Ticket | เนื้อหา | ผู้ตรวจ | เกณฑ์เสร็จ |
|---|---|---|---|
| **M2-0** | ตัดสินข้อ 2 + แก้ข้อความ "local-first" ใน CLAUDE.md (เจ้าของอนุมัติ) + decisions | เจ้าของ | เจ้าของตอบข้อ 2, ทำข้อ 3 |
| **M2-A** | migration SQL (`supabase/migrations/`): ตาราง, CHECK, trigger สมดุล, RLS, RPC · **เทสต์ SQL** ด้วย pgTAP/สคริปต์ (สมดุลศูนย์, ยอดเกินช่วง, ข้ามผู้ใช้) | money-auditor + security-auditor | ใส่ผ่าน branch DB ก่อน (`create_branch`) แล้วค่อย apply · advisors ไม่มี error |
| **M2-B** | ล็อกอิน magic link, หน้าเข้าสู่ระบบ, ออกจากระบบ, guard ทั้งแอป, จัดการ session หมดอายุ | security-auditor + design-critic | ไม่ล็อกอิน = เห็นแต่หน้าเข้าสู่ระบบ · ไม่มีหน้าสมัคร |
| **M2-C** | interface `LedgerRepository` + `DexieRepository` (ย้ายโค้ดเดิม) + `SupabaseRepository` + contract tests | money-auditor | เทสต์เดิมทั้งหมดผ่านกับ Dexie · ชุดเดียวกันผ่านกับ Supabase (local/branch) |
| **M2-D** | นำเข้าไฟล์สำรอง JSON เดิม → ผ่าน `setup_ledger`/RPC · ตรวจ R16 ก่อนส่ง · รายงานผล (กี่บัญชี/รายการ) · ไม่ทับข้อมูลที่มีอยู่ | money-auditor + security-auditor | นำเข้าซ้ำไม่ซ้ำซ้อน · ข้อมูลเสียถูกปฏิเสธทั้งก้อน |
| **M2-E** | PDPA: นโยบายความเป็นส่วนตัว (ระบุว่าเจ้าของโปรเจกต์เห็นข้อมูลได้จากหน้าแอดมิน), ยินยอมก่อนใช้, ส่งออก JSON, **ลบบัญชี+ข้อมูล** (ต้องมี confirm) | security-auditor + design-critic | ลบแล้วข้อมูลหายจริงทุกตาราง |
| **M2-F** | ทดสอบ 2 ผู้ใช้อ่านข้อมูลกันไม่ได้ (อ่าน/เขียน/ลบ/RPC) เป็นเทสต์อัตโนมัติ + เชิญผู้ใช้จริงคนแรก | security-auditor | ผู้ใช้ B เรียก RPC ด้วย id ของ A แล้วไม่เห็น/แก้ไม่ได้ |

ข้อกำหนดทุก Ticket: branch `auto/m2-*` จาก `origin/main` · TDD · `npm test` + `typecheck` + `build` · commit ระบุกฎ · **ก่อน migration ที่กระทบข้อมูลจริงต้องมี Snapshot/สำรอง** (R6)

## 6. ความเสี่ยงและการป้องกัน

| ความเสี่ยง | การป้องกัน |
|---|---|
| ข้อมูลรั่วข้ามผู้ใช้ | RLS ทุกตาราง + M2-F เป็นเทสต์อัตโนมัติ + security-auditor ทุก Ticket |
| key หลุด | เฉพาะ publishable key ฝั่งเว็บ · `.env` อยู่ใน `.gitignore` · ค้น service_role ใน repo ก่อน push |
| สมุดบัญชีไม่สมดุลเพราะเขียนครึ่งเดียว | RPC ธุรกรรมเดียว + trigger ตรวจตอน commit |
| ตัวเลขใหญ่เกิน JS | `CHECK abs(amount) <= 2^53-1` + ฝั่งเว็บโยน `RangeError` (ดู `docs/decisions/2026-11-04-balance-range.md`) |
| โปรเจกต์ฟรีถูกพัก (7 วันไม่ใช้) | ยอมรับแล้ว กดเปิดคืนได้ ข้อมูลไม่หาย · สำรอง JSON เป็นประจำ |
| เปลี่ยน repository แล้ว UI พัง | M2-C ใช้ contract tests ชุดเดียวทั้งสองฝั่ง ไม่แก้ UI เกินจำเป็น |
| ผู้ใช้เดิมทำข้อมูลหาย | คง Dexie ไว้จนกว่า M2-D เสร็จและเจ้าของยืนยัน · ไม่ลบอะไรโดยไม่ถาม |
| เกินโควตาฟรี (500MB DB, 50k MAU) | ผู้ใช้ ≤ 20 คน ข้อมูลข้อความล้วน ไม่เกินแน่นอน · ไม่เก็บรูปสลิป |

## 7. สิ่งที่ยังไม่รวมในแผนนี้ (ตั้งใจ)

- ซิงก์ offline สองทาง (ถ้าเลือกข้อ 2.1 ข) จะเป็นแผนใหม่ ใหญ่กว่านี้มาก
- ฟังก์ชันสะสมที่ยังไม่ตรวจช่วงปลอดภัย (`periodTotals` ฯลฯ — decisions balance-range ข้อ 4) ควรทำก่อน M2-C เพราะข้อมูลนำเข้าจะเพิ่มโอกาสเจอยอดผิดปกติ
- แอปมือถือ / แชร์ข้อมูลระหว่างผู้ใช้ / เก็บเงิน
