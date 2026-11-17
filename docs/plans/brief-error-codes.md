# บรีฟลูกน้อง: รหัส error (code + params) ให้ /invest แสดงอังกฤษ หน้าอื่นไทยเหมือนเดิม

เจ้าของอนุมัติ 17 พ.ย. 2569 (ทางเลือก 2) · GM: แชทหลัก · **ห้ามแตะ** `docs/HANDOFF.md`, `docs/money-rules.md`, `CLAUDE.md`, `supabase/`, `.env*` · ไม่เขียน migration/SQL · push เฉพาะ `auto/<ชื่อ>` ด้วยชื่อเต็ม · ห้าม merge, force push, rebase (อัปเดตด้วย `git merge origin/main`) · ทำใน git worktree ของตัวเอง

## โครงที่ใช้ (merge แล้วใน PR โครง: `src/domain/errors/coded.ts`)
- `defineMessages({ 'area.code': { th: (p) => '...', en: (p) => '...' } })` ที่ระดับโมดูล คืนฟังก์ชัน `msg(code, params?, lang='th')` · รหัสทั้งโปรเจกต์ห้ามซ้ำ (ใช้คำนำหน้าตามกลุ่ม เช่น `units.`, `fx.`, `trade.`, `store.`)
- โยน error **ชนิดเดิม** (RangeError, SyntaxError, TradeLinkError, StorageError ...) ด้วย message ไทยจากแม่แบบ แล้วแปะรหัสด้วย `withCode(new X(msg(code, params)), code, params)`
- ฟังก์ชันที่คืน string ปัญหา (เช่น `...Problem(): string | null`) คงสัญญาเดิม (ยังคืน string ไทย) แล้วเพิ่มฟังก์ชันคู่ที่คืน `{ code, params }` ให้ UI ใช้ · ฟอร์มที่คืน `{field, message}` เพิ่ม `code?` และ `params?` ในอ็อบเจ็กต์เดิม ไม่ลบ `message`

## กติกาเหล็ก
1. **ห้ามเปลี่ยนสูตร เงื่อนไขตรวจ หรือลำดับการตรวจ** เปลี่ยนเฉพาะวิธีสร้างข้อความ/แปะรหัส · diff ของตรรกะต้องเป็นศูนย์
2. **ข้อความไทยเหมือนเดิมทุกตัวอักษร** ขั้นตอน: (ก) **ก่อนแก้ไฟล์ใด** คัดลอกข้อความไทยทุกรหัสจากโค้ดเดิมเป็น golden literal ในเทสต์ `tests/unit/errorCodes-<กลุ่ม>.test.ts` ด้วยค่า params ตัวอย่างที่ครอบคลุมทุกรหัส (ข) รันเทสต์เทียบ (ต้องผ่านบนโค้ดเดิมที่ผ่านแม่แบบ) (ค) ตรวจด้วยว่าเทสต์เดิมทั้งหมดผ่านโดยไม่แก้ค่าที่คาดหวัง
3. **ตัวเลข/ค่าในข้อความต้องเป็น params** (เช่น จำนวนหน่วยที่ขายเกิน, วันที่, ค่าสูงสุด) และข้อความอังกฤษต้องแสดงรายละเอียดครบเท่าไทย ห้ามใช้ข้อความกลางๆ (เช่น "Invalid value") แทน · อังกฤษเขียนสั้น ชัด ตรงความหมาย รูปเงินในอังกฤษ ถ้าจำเป็นต้องจัดรูปให้ส่งตัวเลขดิบมาเป็น params แล้วจัดรูปในแม่แบบด้วยฟังก์ชันเดิม (ห้ามคำนวณเงินใหม่)
4. ทุกรหัสต้องมีเทสต์: (ไทย = golden) และ (อังกฤษ ไม่มีตัวอักษรไทยเหลือ `/[\u0E00-\u0E7F]/` และมีค่า params ครบ)
5. ครอบเฉพาะ error ที่ผู้ใช้ /invest เห็นได้จริง ถ้าข้อความอยู่ในโค้ดที่หน้าอื่นเรียกอย่างเดียว ไม่ต้องแตะ · จด "รหัสที่ทำ / ที่ไม่ได้ทำ + เหตุผล" ในสรุป
6. ต้องผ่านก่อนเปิด PR: `npm test`, `npm run typecheck`, `npm run build` · บันทึกการเรียนรู้ไทยสั้นๆ ใน `docs/learning/2026-11-17-<ชื่อ>.md` · commit ระบุกฎ เช่น `[R1,R9]`
7. ต้องส่งกลับ GM (สรุปไทย): รายการรหัส (จำนวน), ไฟล์ที่แตะ, ข้อความที่ไม่มีทางทำเป็นรหัสได้และเหตุผล, ข้อสังเกต, เรื่องที่ต้องแก้ไฟล์กลาง

## งาน A — `auto/error-codes-domain` : `src/domain/invest/**`
ไฟล์เป้าหมาย: `costBasis.ts, costBasisFx.ts, fx.ts, fxExchange.ts, ledgerLink.ts, ledgerLinkFx.ts, units.ts, rules.ts, dcaPlan.ts, usdIntegrity.ts, portfolioMoney.ts` (และไฟล์อื่นใน `src/domain/invest/` ที่โยน/คืน error ไทยที่ผู้ใช้เห็น) + `src/app/portfolio.ts` (ข้อความ "ข้อมูลรายการไม่สอดคล้อง" และ message ที่ส่งต่อเป็น `row.error` ต้องพก code/params ต่อไปถึง UI: เพิ่มช่อง `errorCode?`/`errorParams?` ถ้าจำเป็น) · ไม่ต้องแปล `glossary.ts`/`labels.ts` (ไม่ใช่ error) · ไม่แตะ `src/app/tradeForm.ts`, `usForms.ts` (งาน B) · ไม่แตะ `src/storage/**` (งาน C)

## งาน B — `auto/error-codes-forms` : ฟอร์ม app
ไฟล์เป้าหมาย: `src/app/tradeForm.ts`, `src/app/usForms.ts`, ฟอร์ม/ตัวตรวจอื่นใน `src/app` ที่หน้า /invest เรียก (เช่น แผนซื้อประจำ ราคา อัตราแลกเงิน โอนเข้า-ออกพอร์ต ถ้ามีข้อความไทยของตัวเอง) · `TradeFormError`/ผลของ usForms เพิ่ม `code`/`params` · ข้อความที่มาจาก `parseUnits`/`parsePriceMicro`/`parseBahtToSatang` (e.message) ต้องพก code จาก error ต้นทาง (งาน A กำลังเพิ่มรหัสให้ `units.ts`: ถ้า error ต้นทางมี `code`/`params` ให้ส่งต่อ ถ้ายังไม่มีให้ใช้ `hasCode` ตรวจ และจด) · ไม่แตะ `src/domain/**`, `src/storage/**`

## งาน C — `auto/error-codes-storage` : `src/storage/**`
ไฟล์เป้าหมาย: `repository.ts` (StorageError และคลาสย่อยเช่น SettingsConflictError), `supabaseRepository.ts` และตัวเก็บอื่นใน `src/storage/` · **เฉพาะ error ที่ผู้ใช้ /invest เห็นได้**: ไล่จากเมธอดที่โหมด /invest เรียก (โหลด/บันทึกข้อมูลลงทุน ซื้อ-ขาย-ปันผล ราคา อัตรา แผนซื้อประจำ ตั้งค่าพอร์ต โอนเข้า-ออกพอร์ต) · ข้อความ error ที่เป็นของหน้าอื่นไม่ต้องทำ · **ห้ามแตะ `supabase/**` และไม่รัน live-contract** (GM รันบน branch ก่อน merge) · ห้ามเปลี่ยนเงื่อนไขหรือลำดับตรวจ/การเรียกฐานข้อมูล ห้ามเปลี่ยนข้อความที่คอลัมน์/ฟังก์ชันฐานข้อมูลคืนมา (ถ้า error มาจากข้อความของฐานข้อมูล ให้จับคู่ด้วย pattern ที่มีอยู่แล้วเท่านั้นและจดไว้)
