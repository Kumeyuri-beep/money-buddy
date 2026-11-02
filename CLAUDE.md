# Money Buddy Pro 2.0

แอปจัดการเงินส่วนตัวภาษาไทย ข้อมูลอยู่ในเครื่องผู้ใช้ (local-first) สไตล์ Glassy Dashboard เน้นเว็บเดสก์ท็อป

## ก่อนเริ่มทุกงาน

1. อ่าน `docs/money-rules.md` ให้ครบ (กฎเหล็ก ห้ามละเมิดและห้ามแก้เอง)
2. อ่าน `docs/money-rules-R16-proposal.md` (ข้อเสนอที่โค้ดทำตามอยู่ แต่ยังรออนุมัติ)
3. หากกฎขัดกันหรือไม่ชัดเจน ให้หยุดและถาม อย่าเดา

## คำสั่ง

- `npm run dev` เปิดหน้าเว็บ
- `npm test` รันเทสต์ทั้งหมด (Vitest)
- `npm run typecheck` ตรวจชนิดข้อมูล
- `npm run build` ตรวจชนิดแล้ว build

## วิธีทำงาน: ทีละ Ticket

Spec -> เขียนเทสต์ -> เขียนโค้ด -> รันเทสต์ -> สรุปผลและวิธีทดสอบ -> รอผู้ใช้ยืนยันก่อนไป Ticket ถัดไป
ห้ามแก้โค้ดนอกขอบเขต Ticket โดยไม่แจ้ง ก่อน Migration ทุกครั้งต้องสร้าง Snapshot

Commit ต้องระบุกฎที่แตะ เช่น `[R1,R8,R16] เพิ่มฟังก์ชัน ...`

## โครงสร้าง

- `src/domain/money/` สตางค์ ปัดเศษ micro-units (BigInt) ไม่แตะ DOM หรือฐานข้อมูล
- `src/domain/ledger/` สมุดบัญชีคู่ ยอดคงเหลือ รายรับรายจ่าย Integrity Check
- `src/storage/` IndexedDB (Dexie) เขียนผ่าน `repository.ts` เท่านั้น เปลี่ยนโครงสร้างต้องเพิ่ม `version(n)` ใน `db.ts`
- `src/app/` ขั้นตอนใช้งาน (use case) เช่น `setup.ts` ที่ประกอบ domain เข้าด้วยกัน ไม่แตะ React
- `src/ui/` หน้าจอ React (ห้ามมีสูตรเงินในคอมโพเนนต์ ให้เรียก domain เท่านั้น)
- `tests/unit/` เทสต์สูตรเงิน (ทุกฟังก์ชันเงินต้องมีเทสต์ขอบเขต: ยอด 0, น้อยมาก, วันสิ้นเดือน)

## ดีไซน์

สไตล์ Glassy Dashboard: กระจกฝ้าเฉพาะการ์ดสรุป ส่วนรายการและตารางใช้พื้นทึบ ตัวหนังสือบนกระจกต้องผ่าน WCAG AA
ปรับให้เป็นพื้นทึบเมื่อผู้ใช้ตั้งค่าลดความโปร่งใส (ดู `src/ui/styles.css`) จำกัดการ์ดกระจกราว 6-8 ใบต่อหน้า

## ความปลอดภัย

ห้ามนำข้อมูลการเงินจริงมาใช้เป็นตัวอย่างหรือส่งออกนอกเครื่อง เก็บ token ใน `.env` ที่อยู่ใน `.gitignore`
ตั้งแต่ M2 เป็นเว็บหลายผู้ใช้ (ดู `docs/decisions/2026-11-02-multi-user.md`): ข้อมูลแต่ละคนแยกด้วย RLS เสมอ
ห้ามใส่ service_role key ในโค้ดฝั่งเว็บ ห้าม `git push` จนกว่าเจ้าของจะยืนยัน

## ทีมผู้ช่วย

คุณ (session หลัก) เป็นหัวหน้า: คุยกับเจ้าของ เขียนโค้ด และตัดสินใจรวม ผู้ช่วยใน `.claude/agents/` อ่านอย่างเดียว เรียกเมื่อจำเป็นเท่านั้น
- product-advisor: เจ้าของลังเลเรื่องฟีเจอร์หรือลำดับงาน
- money-auditor: หลังแก้โค้ดเงิน/บัญชี/SQL ที่คำนวณยอด
- security-auditor: หลังแตะล็อกอิน, Supabase, RLS, `.env`, นำเข้า/ส่งออก
- design-critic: หลังแก้หน้าจอ
Skill: `/grill-me` ซักแผนก่อนลงมือ, `money-rules` ใช้อัตโนมัติเมื่อแตะเงิน, `/ship` ตรวจแล้วรอยืนยันก่อน push

## Superpowers (plugin)

ใช้ได้ แต่กติกาในไฟล์นี้มาก่อน skill ของ Superpowers เสมอ
- ฟีเจอร์ใหม่หรือ Ticket ใหญ่: ใช้ `brainstorming` → `writing-plans` (ถามเจ้าของทีละข้อ ภาษาไทย) · ไอเดียเล็กใช้ `/grill-me` แทนได้
- เขียนโค้ด: ใช้ `test-driven-development` และ `executing-plans` (ทำเองใน session นี้)
  **ห้ามใช้ `subagent-driven-development` / `dispatching-parallel-agents`** เว้นแต่เจ้าของสั่ง เพราะกินโควตามาก
- บั๊ก: ใช้ `systematic-debugging` · ก่อนบอกว่าเสร็จ: `verification-before-completion`
- Git: ทำงานบน branch `main` ไม่ต้องสร้าง worktree · ห้าม merge, push หรือเปิด PR เอง ใช้ `/ship` แล้วรอเจ้าของยืนยัน
- แผนที่เขียนให้เก็บไว้ที่ `docs/plans/` (เปิดดูใน Obsidian ได้)
