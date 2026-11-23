# บรีฟ worker A: หน้า Tools → Rebalancing (R29)

**branch/worktree:** `auto/r2-rebalance-page` แตกจาก `origin/main` ล่าสุด (`git worktree add -b auto/r2-rebalance-page ../money-buddy-wt-rebalance-page origin/main`) · push ชื่อเต็ม · ห้าม merge/rebase/force · `git merge origin/main` เท่านั้น · ห้าม `git add -A`/`.` · commit+push ทุกครั้งที่จบชิ้น · PR ชื่อ `[invest-v2-r2] หน้า Rebalancing` · commit ระบุกฎ `[R29,R20,R26]`

## เป้าหมาย
หน้า Tools → Rebalancing ตามแบบร่าง `docs/design/invest-v2/30-tools-rebalancing.html/.png` (ดูรูป) ใช้ฟังก์ชันล้วน `rebalance()` ใน `src/domain/invest/rebalance.ts` (อยู่บน main แล้ว · ห้ามคิดสูตรเงินใน component · ห้ามแก้ไฟล์นั้นถ้าไม่จำเป็น ถ้าพบบั๊กในโดเมนให้หยุดแจ้ง GM) และหมวด/เป้าจากหน้า Categories (`loadInvestments().categories`, `asset.categoryId`) · อ่าน **R29 ใน `docs/money-rules.md` ข้อ 29 ให้ครบ** และ `docs/proposals/R29-rebalancing.md`, `docs/plans/investment-design.md` ข้อ 3 (ข้อยกเว้น "Result")

## ขอบเขต
**ทำ:**
1. หน้า `src/ui/invest/pages/RebalancePage.tsx` + `src/ui/invest/rebalance/**` + ลงทะเบียนหน้า (แก้ `src/app/investRoute.ts` เปลี่ยน rebalancing จาก soon เป็น live และจุดลงทะเบียนใน `InvestMode.tsx` ขั้นต่ำ แจ้งใน PR)
2. อินพุต: โหมด Deposit/Withdraw + ยอด (USD เซนต์ ห้าม float ใช้ตัวช่วยแปลงข้อความ→เซนต์ใน domain ที่มีอยู่ หรือเขียนฟังก์ชันล้วนใหม่ใน `src/domain/invest/` พร้อมเทสต์ ปฏิเสธค่าติดลบ/ทศนิยมเกิน 2 ตำแหน่ง/ไม่ใช่ตัวเลข) · Set up: Allow sales (ค่าเริ่มต้นปิด) · เศษหุ้น (ค่าเริ่มต้นเปิด 3 ทศนิยม) · ยอดสั่งขั้นต่ำ (ค่าเริ่มต้น 0) เก็บค่าตั้งไว้ใน browser (`localStorage` ครอบ try/catch ตั้งเป็นความสะดวกต่อผู้ดู ไม่ใช่ข้อมูลสำคัญ ห้ามเขียนฐานข้อมูล)
3. ผลลัพธ์: ตารางหมวด Now / Target / After (คิดจากหน่วยที่ปัดจริง) · รายการซื้อ/ขายต่อหุ้น (หน่วยแสดง 3 ทศนิยมตามที่คำนวณ ห้ามแสดงต่างจากที่คิด + ราคา + วันที่ราคา + จำนวนเงิน) · "Left over" · "Short by" (โหมดถอน) · droppedRows พร้อมเหตุผล · เหตุผลที่ไม่คำนวณ (reason enum → ข้อความ ไม่เดา) · คำเตือน (ขายหมดตำแหน่ง/หมวด, ราคาเก่ากว่า 30 วัน, ไม่มีหุ้นให้ซื้อในหมวด, Already at your targets) · หัวตาราง "closest without selling" เมื่อไม่เปิด Allow sales
4. **ข้อความบังคับ** ติดกับ Result ทุกครั้งบนหน้าจอและในไฟล์ส่งออก (ข้อความเต็มตามบรรทัด "ข้อความบังคับ" ของ R29 ใน money-rules.md · คัดลอกตรงตัว) · ใช้คำ "Result" / "Trades needed to reach your target" · **ห้าม** คำ "Recommend/Recommendation/Advice/คำแนะนำ" ในหน้า (มีเทสต์ตรวจข้อความทั้งหน้า) · **ไม่มีปุ่มสร้างรายการซื้อขาย ไม่เขียนสมุด/ฐานข้อมูล**
5. ส่งออก CSV ของผลลัพธ์ (ใช้ `csvText` กัน formula injection · มีข้อความบังคับท้ายไฟล์)
6. มุมมอง THB: คำนวณเป็น USD เสมอ (ขอบเขต R26) แสดงข้อความบอกชัด · สินทรัพย์ THB ในหมวดที่ยังมีหน่วย > 0 → reason ของโดเมนหยุดคำนวณ แสดงข้อความ
**ไม่ทำ:** การสร้างรายการ · ราคาตลาดอัตโนมัติ · ภาษี/ค่าธรรมเนียม · Top dividend stocks · มือถือ (ห้ามพัง: สไตล์เฉพาะคอมครอบ `@media (min-width: 1024px)`)

## ไฟล์ที่แตะได้
`src/ui/invest/pages/RebalancePage.tsx` · `src/ui/invest/rebalance/**` · `src/ui/invest/invest.css` (เฉพาะส่วนใหม่) · `src/app/investRoute.ts` + `tests/unit/investRoute.test.ts` · `InvestMode.tsx` (ขั้นต่ำ) · `src/domain/invest/` (ฟังก์ชันล้วนใหม่ เช่น แปลงอินพุต/แถวแสดงผล · ห้ามแก้ `rebalance.ts` เว้นแต่แจ้ง GM) · `tests/unit/**` · `tests/e2e/invest-rebalance.spec.ts` · `src/dev/**` (ข้อมูลสมมติสำหรับ Playwright เหมือน `?investDemo=cat`) · `docs/learning/`
## ห้ามแตะ
`docs/HANDOFF.md` · `docs/money-rules.md` · `CLAUDE.md` · `supabase/**` · `src/storage/**` · design tokens ใน `src/ui/styles.css` · routes หลักอื่น

## เกณฑ์เสร็จ
- หน้าผลลัพธ์ตรงตัวอย่าง A (เปิด/ปิดเศษหุ้น) จาก `tests/fixtures/r29-examples.json` เมื่อป้อนข้อมูลสมมติชุดเดียวกัน (e2e ตั้งหมวดและเป้า → Result ตรงตัวอย่าง A: CCC 2.187 หุ้น = $131.22 · DDD 8.750 = $218.75 · Left over $0.03) · ไม่มีคำต้องห้ามทั้งหน้า · มีข้อความบังคับ · ไม่มีปุ่มสร้างรายการ
- เทสต์หน่วยของตัวแปลงอินพุต/แถวแสดงผล · Playwright 1280/1440 (หลัก) + 360/390 ต้องไม่พัง · คีย์บอร์ด/aria: ฟิลด์ยอดมี label, ผลลัพธ์ `aria-live` แบบสุภาพ, ตารางมี caption · ตัวหนังสือผ่าน WCAG AA · การ์ดกระจกไม่เกินโควตา ตาราง/รายการพื้นทึบ
- `npm test` + typecheck + build ผ่าน

## ส่งกลับ GM
สรุปไทย · ข้อสังเกต/จุดที่แบบร่างหรือกฎไม่ชัด (อย่าเดา ให้ถาม) · เรื่องที่ต้องแก้ไฟล์กลาง · ลิงก์ PR (GM เรียก money-auditor และ design-critic เอง) · ห้ามใช้ข้อมูลการเงินจริง
