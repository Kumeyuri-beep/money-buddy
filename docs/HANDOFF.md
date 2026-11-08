# Money Buddy Pro 2.0 — สรุปส่งต่อสำหรับแชทใหม่

> อัปเดต: 4 พ.ย. 2569 (2026-11-04) · อ่านไฟล์นี้ไฟล์เดียวก็ทำงานต่อได้ ไม่ต้องย้อนแชทเก่า

---

## 1. เจ้าของและสภาพแวดล้อม

- เจ้าของ: Kumeyuri (Hisoka) · มือใหม่ด้านเขียนโปรแกรม · คุยภาษาไทย ต้องการคำอธิบายทีละขั้นแบบง่าย
- เครื่อง: Windows · PowerShell · โปรเจกต์อยู่ที่ `C:\Users\owenn\Documents\money-buddy`
  (เคยอยู่ไดรฟ์ `Z:` แต่ย้ายเพราะ Vite ขึ้น EBUSY)
- GitHub: `Kumeyuri-beep/money-buddy` (private) · Vercel: ทีม `kumeyuri` → https://money-buddy-phi.vercel.app
  (Hobby ฟรี, เปิด Vercel Authentication, push ขึ้น main แล้ว deploy อัตโนมัติ)
- CI: GitHub Actions `.github/workflows/ci.yml` รัน typecheck + test + build
- ติดตั้งแล้วบนเครื่อง: Node, Git, GitHub CLI (`gh`), Claude Code, Impeccable (global plugin)
- ปัญหาที่เคยแก้แล้ว: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` (npm.ps1 ถูกบล็อก), ตั้ง `git config --global user.name/email` แล้ว

## 2. กติกาการทำงาน (สำคัญ ห้ามข้าม)

1. ทำ **ทีละ Ticket**: Spec → เขียนเทสต์ → เขียนโค้ด → รันเทสต์/typecheck/build → สรุป + วิธีทดสอบ → รอเจ้าของยืนยันก่อนไป Ticket ถัดไป
2. ส่งงานเป็น **zip เฉพาะไฟล์ที่เปลี่ยน** พร้อมขั้นตอนวางไฟล์และคำสั่ง PowerShell ทีละขั้น
3. **ห้าม push / commit แทนเจ้าของ** จนกว่าเจ้าของจะยืนยัน
4. **ห้ามใช้ข้อมูลการเงินจริง** ในตัวอย่าง/เทสต์ · token อยู่ใน `.env` (อยู่ใน `.gitignore`)
5. **ห้ามแก้ `docs/money-rules.md`** โดยไม่ได้รับอนุญาต (R16 อยู่ในไฟล์ข้อเสนอแยก)
6. Commit ระบุกฎที่แตะ เช่น `[R1,R16] ...`
7. ทดสอบหน้าตาด้วย Playwright ใน sandbox ก่อนส่ง (ถ้าทำได้)

## 3. Stack และคำสั่ง

Vite 8.3.5 · React 19.3 · TypeScript 7.0.2 (strict + `noUncheckedIndexedAccess`) · Vitest 5.0.5 · Dexie 4.4.7 · fake-indexeddb 6.2.7 (dev)

```
npm run dev        # เปิดเว็บ http://localhost:5173
npm test           # 765 เทสต์ผ่านทั้งหมด (28 ไฟล์)
npm run typecheck
npm run build
```

## 4. โครงสร้างโค้ด (ทำเสร็จถึง M1-B3)

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `src/domain/money/` | `satang.ts` (parseBahtToSatang, formatBaht, toBahtString), `round.ts` (roundHalfUp), `micro.ts` (สกุลเงินต่างประเทศ micro-unit + BigInt, convertToSatang) |
| `src/domain/ledger/` | `types.ts` (Account, Line, Entry, EntrySource), `entry.ts` (createEntry ตรวจ R16), `balance.ts` (balanceOf, periodTotals, classifyEntry), `integrity.ts` (runIntegrityCheck) |
| `src/storage/` | Dexie `db.ts` (version 1: accounts, entries, meta), `repository.ts` (loadLedger, saveInitialLedger, appendEntry, updateEntry, deleteEntry, exportSnapshot, resetAll, compareEntries) |
| `src/app/` | `setup.ts` (กระเป๋าเริ่มต้น + หมวด), `entryForm.ts`, `ledgerQuery.ts`, `quickText.ts` (พิมพ์จดด่วน "ข้าวมันไก่ 55"), `dates.ts`, `describe.ts`, `ids.ts` |
| `src/ui/` | `App.tsx`, `Shell.tsx` (เมนู: today, ledger), `Setup.tsx`, `Today.tsx`, `LedgerView.tsx`, `AddEntryDialog.tsx`, `QuickAdd.tsx`, `Toast.tsx` (มี Undo), `styles.css` |
| `tests/unit/` | money, ledger, setup, storage, entryForm, ledgerQuery, quickText |

หลักสำคัญของโค้ด
- **สมุดบัญชีคู่ (R16 ข้อเสนอ)**: Entry มี ≥ 2 Line, debit บวก/credit ลบ, ผลรวมต่อสกุลเงิน = 0, ยอดคงเหลือคำนวณจาก Line เสมอ ไม่เก็บ · โอน/จ่ายบัตร/เงินต้นหนี้/ให้ยืม ไม่ใช่รายรับรายจ่าย
- เงินบาทเก็บเป็นสตางค์จำนวนเต็ม ห้าม float
- บัญชีเรียงด้วย `sortOrder`, รายการวันเดียวกันเรียงด้วย `createdAt` (IndexedDB คืนตาม primary key ต้อง sort เอง)
- รายการ source `system` (ยอดยกมา) แก้/ลบไม่ได้ และไม่ถูกนับในตัวกรองประเภท
- กระเป๋าเริ่มต้น: CashFlow, Mainframe, Vault Zero · หมวด: เงินเดือน, รายรับอื่นๆ, อาหาร, เดินทาง, ที่อยู่, ช้อปปิ้ง, บันเทิง, ดอกเบี้ย, อื่นๆ

## 5. สถานะ Milestone

| ขั้น | สถานะ |
|---|---|
| M0 ฐานโปรเจกต์ + กฎเงิน | ✅ |
| M1-A ตั้งค่าเริ่มต้น + หน้าวันนี้ | ✅ |
| M1-B1 เพิ่มรายการ (dialog) | ✅ |
| M1-B2 สมุดบัญชี แก้/ลบ/Undo/ตัวกรอง | ✅ |
| M1-B3 พิมพ์จดด่วน | ✅ deploy แล้ว ผู้ใช้ทดลองใช้แล้ว |
| M1-B4 สแกนสลิป (OCR) | ✅ เสร็จ ผ่าน money-auditor/design-critic/security-auditor แล้ว · PR `auto/m1-b4-ocr` รอเจ้าของ merge (ดู `docs/plans/2026-11-03-slip-scan-m1-b4.md` และ `docs/decisions/2026-11-04-slip-ocr.md`) · ทดสอบกับสลิป K PLUS จริง 4 ใบ: ยอด/วันที่/เวลาถูกครบ ผู้รับได้ 2 ใบเต็ม อีก 2 ใบได้บางส่วน |
| **ใหม่: เปลี่ยนหน้าตาเป็นดีไซน์ A** | 🔄 แผน `docs/plans/2026-11-02-design-a-aurora-glass.md` (A1-A5) · **A1 ✅ (4b7033e)** · **A2 ✅ + A2.1 ✅** (ฟังก์ชัน domain การ์ดสรุป) · **A3 ✅ (399b0a7)** การ์ดสรุป 8 ใบ ผ่าน `design-critic` แล้ว · A1-A3 push ขึ้น origin/main แล้ว · **A4 ✅** Cash Flow Sankey ผ่าน `money-auditor` แล้ว · **A5 ✅** กระเป๋า+รายการล่าสุด+การ์ดว่าง ผ่าน `design-critic` (รอ push) · งานเก็บตก: `LedgerView`/`Setup` ใช้ `.glass` เกินกติกา, `--glass-highlight` ไม่ได้ประกาศ, ยังไม่มี `prefers-reduced-motion` |
| **M2 ใหม่: บัญชีผู้ใช้ + ฐานข้อมูลออนไลน์** | ⏳ วางแผนแล้ว (ข้อ 6) |
| ถัดไป: บิล/หนี้, พอร์ต, เกษียณ, ภาษี, DCA, ปรับดีไซน์มือถือ | ตาม roadmap เดิม (เลื่อนไป 1 ขั้น) |

## 6. การตัดสินใจ: เว็บหลายผู้ใช้ (M2)

- ผู้ใช้: เพื่อน/ครอบครัว ≤ 20 คน · **เชิญเท่านั้น** (ปิดสมัครเอง) · ไม่เก็บเงิน · งบ 0 บาท
- Supabase ฟรี (Auth + Postgres) + Vercel Hobby · ข้อมูลแยกกันเด็ดขาดด้วย RLS `auth.uid() = user_id` · ไม่มีกระปุกร่วม
- Ticket: **M2-A** ตาราง accounts/entries/lines + RLS + ฟังก์ชัน SQL ตรวจผลรวมเป็นศูนย์ฝั่งเซิร์ฟเวอร์ · **M2-B** ล็อกอิน magic link/Google · **M2-C** แยก repository เป็น interface (Supabase/Dexie) · **M2-D** นำเข้าไฟล์สำรอง JSON เดิม · **M2-E** PDPA: นโยบายความเป็นส่วนตัว, ยินยอม, ส่งออก, ลบบัญชี · **M2-F** ทดสอบผู้ใช้ 2 คนอ่านข้อมูลกันไม่ได้
- ความเสี่ยงที่ยอมรับ: โปรเจกต์ฟรีถูกพักหลังไม่มีใครใช้ 7 วัน (กดเปิดคืนได้) · สำรองข้อมูลเองเป็นประจำ · เจ้าของเห็นข้อมูลจากหน้าแอดมิน → ต้องแจ้งในนโยบาย
- บันทึกฉบับเต็ม: `docs/decisions/2026-11-02-multi-user.md`

## 7. การตัดสินใจ: ดีไซน์ = แบบ A "Aurora Glass" (Liquid Glass มืด)

ไฟล์อ้างอิงอยู่ใน zip: `design/A-aurora-glass.dc.html` (เปิดอ่านโค้ด HTML/CSS ได้ตรงๆ) · canvas: https://claude.ai/artifact/2iVXe5btY1vPDyUS5puqYu

**โครงหน้า** (ยึดไฟล์ `index2.html` เก่าของเจ้าของ)
- แถบซ้ายกระจก: โลโก้ MB + "Money Buddy / เกษียณเป็นเรื่องของคนวางแผน" · การ์ดโปรไฟล์
- เมนูหลัก: **ภาพรวม (หน้าแรก)**, รายรับ-รายจ่าย, พอร์ตการลงทุน, แผนลงทุน, ปรับสมดุลพอร์ต (badge)
- เครื่องมือ: วางแผนเกษียณ, คำนวณภาษี (2569), ถัวเฉลี่ยต้นทุน, โปรไฟล์ · ล่างสุด "บันทึกอัตโนมัติแล้ว"
- หัวหน้า: ทักทาย + วันที่ · ช่องพิมพ์จดด่วน · ปุ่มสแกนสลิป · ปุ่มเพิ่มรายการ (ทอง)

**หน้าภาพรวม เรียงจากบนลงล่าง**
1. แถว 4 การ์ด: NET WORTH (+ เส้นแนวโน้ม, เทียบเดือนก่อน) · INCOME (จำนวนช่องทาง, เข้ากระเป๋าไหน) · OUTGOING (บิล vs ใช้จ่าย, บิลค้างจ่าย) · SURPLUS (% ของรายรับ)
2. แถว 4 การ์ด: **SAFE-TO-SPEND** ฿/วัน + สถานะ (= (คงเหลือ − บิลค้าง − เป้าออม) ÷ วันที่เหลือรวมวันนี้) · SAVINGS RATE (+ เส้นเป้า 20%) · VS LAST MONTH (+ เป้างบเดือน) · RUNWAY (เงินสดไม่รวมพอร์ต ÷ ค่าครองชีพ, เป้า 6 เดือน)
3. **Cash Flow แบบ Sankey** เต็มความกว้าง: รายรับ → งบรายเดือนรวม → หมวด (เหลือเก็บ, บิล, อาหาร, ...) ความหนา = สัดส่วนเงิน · มีเลือกเดือน + ชิปสรุป · หมวดเล็กรวมเป็น "อื่นๆ"
4. กระเป๋าเงิน (แถบ % ของทั้งหมด) | บิลที่จะถึง
5. รายการล่าสุด (พื้นทึบ, จัดกลุ่มตามวัน) | เป้าเกษียณปีนี้ + สัดส่วนพอร์ต
- ทุกการ์ดมีลิงก์ "ดู… →" ไปหน้าย่อย

**Token**
- พื้น `#07080d` + ก้อนแสงเบลอ (ม่วง `#3b2bd6`, เขียวน้ำทะเล `#0fa3a3`, ทอง `#c9871a`, ชมพู `#b0306e`)
- กระจก: `linear-gradient(140deg, rgba(255,255,255,.14), rgba(255,255,255,.035))` + `backdrop-filter: blur(32px) saturate(180%)` + ขอบ `rgba(255,255,255,.16)` + เงาใน `inset 0 1px 0 rgba(255,255,255,.4)` + radius 28px · fallback `prefers-reduced-transparency` = พื้นทึบ `#171a26`
- รายการ/ตาราง: พื้นทึบ `rgba(12,14,21,.9)` radius 24px
- สี: ทอง `#F2D06B` · รายรับ `#6FD9A8` · รายจ่าย `#FF8F82` · โอน `#8FB8FF` · เตือน `#FFB86B` · ข้อความ `#F4F5FA` · รอง `rgba(244,245,250,.66)`
- หมวดใน Sankey: บิล `#A99BFF` อาหาร `#FF8F82` เดินทาง `#FFB86B` ช้อปปิ้ง `#FF7EB6` อื่นๆ `#9AA0B4` เหลือเก็บ `#6FD9A8`
- ฟอนต์: IBM Plex Sans Thai (400–700) · ตัวเลข `tabular-nums` · ปุ่มสูง ≥ 44px · ไอคอนเส้น SVG ไม่ใช้อีโมจิ

**ฟีเจอร์ที่หน้าใหม่ต้องการแต่โค้ดยังไม่มี** (ต้องเพิ่มใน domain ก่อนโชว์ได้จริง)
บิลประจำ/บิลค้างจ่าย, เป้าออมรายเดือน, เป้างบรายเดือน, ประวัติเดือนก่อน, มูลค่าพอร์ต/สัดส่วน, เป้าเกษียณ, ยอดสุทธิย้อนหลัง (เส้นแนวโน้ม) → การ์ดไหนข้อมูลยังไม่มีให้แสดงสถานะว่าง "ตั้งค่า…" แทนตัวเลขปลอม

## 8. ทีมผู้ช่วย AI (ไฟล์อยู่ใน `.claude/` ของโปรเจกต์ใน zip นี้)

- หัวหน้า = session หลักของ Claude Code (คุยกับเจ้าของ เขียนโค้ด รอยืนยันก่อน push)
- ผู้ช่วยอ่านอย่างเดียว: `product-advisor` (opus), `security-auditor` (opus), `design-critic` (sonnet), `money-auditor` (sonnet)
- Skill: `/grill-me` ซักแผน · `money-rules` ใช้อัตโนมัติเมื่อแตะเงิน · `/ship` ตรวจแล้วรอยืนยันก่อน push
- ⚠️ ยังไม่ยืนยันว่าเจ้าของวางไฟล์ `.claude/` ลงเครื่องแล้ว → ถามก่อน
- ประหยัดโควตา: Sonnet เป็นค่าเริ่มต้น, Opus เฉพาะตัดสินใจใหญ่/ความปลอดภัย, `/clear` เมื่อเริ่ม Ticket ใหม่, เรียกผู้ช่วยเฉพาะตอนจำเป็น

## 9. เรื่องที่ยังค้าง (ถามเจ้าของ)

1. ลำดับงานถัดไป: (ก) ปรับหน้าตาแอปเป็นดีไซน์ A ก่อน (ข) M1-B4 สแกนสลิป (ค) M2 ล็อกอินหลายผู้ใช้
   — คำแนะนำ: ทำ (ก) แบบเฉพาะโครง + การ์ดที่มีข้อมูลแล้ว (เมนู, หัวหน้า, INCOME/OUTGOING/SURPLUS, Sankey, กระเป๋า, รายการล่าสุด) แล้วค่อยต่อ (ค) ส่วน OCR ทำทีหลังได้
2. อนุมัติ R16 และการตีความ `roundHalfUp` (ปัดครึ่งออกจากศูนย์) ใน `docs/money-rules-R16-proposal.md`
3. แถบเมนูล่างสำหรับมือถือ → ไว้รอบปรับดีไซน์มือถือ

## 10. ลิงก์

- เอกสารแผนหลัก: https://claude.ai/artifact/8b9jpgNWtqNqZTeSZtzBsa (มีหัวข้อ "อัปเดต 2 พ.ย. 2026")
- Canvas ดีไซน์ 3 แบบ (ใช้แบบ A): https://claude.ai/artifact/2iVXe5btY1vPDyUS5puqYu
- เว็บจริง: https://money-buddy-phi.vercel.app

## 11. ไฟล์ใน zip นี้

```
HANDOFF.md                     ← ไฟล์นี้
START-PROMPT.txt               ← ข้อความสำหรับวางในแชทใหม่
design/A-aurora-glass.dc.html  ← ดีไซน์ที่เลือก (โค้ดอ้างอิง)
project/                       ← โค้ดล่าสุดทั้งหมด (ไม่มี node_modules, dist, .git)
                                 รวม .claude/ (ผู้ช่วย + skill) และ docs/decisions/
```

## 12. โหมดทำงานเอง และสถานะบิลประจำ (อัปเดต 4 พ.ย. 2569)

เจ้าของเปิดโหมดทำงานเอง (กติกาเต็มอยู่ใน `CLAUDE.md` หัวข้อ "โหมดทำงานเอง", กฎกันพลาดใน `.claude/settings.json`): ทุกงานอยู่บน branch `auto/*` ผ่านเทสต์ก่อน พร้อมผู้ช่วยตรวจ แล้วเปิด PR (ห้าม merge เอง ห้าม push main) หยุดถามเฉพาะ ลบข้อมูล / แก้ money-rules / สมัครบริการหรือใช้เงิน / ใส่ key / มี PR รอ merge ครบ 2 อัน

| PR | เนื้อหา | สถานะ |
|---|---|---|
| #1 `auto/m1-b4-ocr` | M1-B4 สแกนสลิป K PLUS (รวม commit กฎโหมดทำงานเอง) | merge แล้ว |
| #2 `auto/bills-domain` | บิลประจำ B1: ฟังก์ชัน domain | merge แล้ว |
| #3 `auto/bills-storage` | B2: Dexie `version(2)` + Snapshot + repository | merge แล้ว |
| #4 `auto/r15-lastpaid` | เพิ่มข้อความ R15: lastPaidMonth ต้องไม่เกินเดือนปัจจุบัน | merge แล้ว |
| #5 `auto/bills-ui` | B3: หน้า "บิลและเป้า" | merge แล้ว |
| #6 `auto/bill-cancel` | ยกเลิกการจ่ายบิล: `Entry.bill` ผูกบิล+รอบ, ยกเลิก atomic คืน lastPaidMonth (decisions ข้อ 35-41) | merge แล้ว |
| #7 `auto/bills-overview` | B4: SAFE-TO-SPEND, แผงบิล, แยกบิล/ใช้จ่าย + เป้างบ, โหนดบิลใน Sankey, override วันเงินเดือน (decisions ข้อ 42-52) | merge แล้ว |

**ลำดับงานบิลประจำ** (แผน `docs/plans/2026-11-04-bills-savings-safe-to-spend.md`, เหตุผล `docs/decisions/2026-11-04-bills-safe-to-spend.md`): B1-B4 ✅ ครบ (PR #2-#7) · ถัดไป: เก็บกวาด backlog แผนดีไซน์ A → เขียนแผน M2 (ล็อกอิน) แล้ว **หยุดก่อนลงมือ เจ้าของต้องสมัคร Supabase เอง**

**ที่เจ้าของควรตัดสินใจ/ทำ**
1. (เสร็จแล้ว) merge PR #6/#7 · ช่องว่างที่ยังเหลือ: รายการจ่ายบิลก่อนอัปเดต #6 ยกเลิกจากหน้าจอไม่ได้ (decisions ข้อ 39)
2. เปิด branch protection บน GitHub สำหรับ `main` (ต้องผ่าน PR, ห้าม force push, ห้ามลบ) และพิจารณาเพิ่มกฎ deny: `git push origin x:main`, `refs/heads/main`, `git push -u origin` บน main, `git -c ... push`, `gh pr merge`, `gh api`, และคำสั่งผ่าน PowerShell (รายละเอียดใน PR #1)
3. พิจารณาเพิ่มข้อความใน R15 ว่าช่วงคำนวณคือ [วันนี้, วันเงินเดือนถัดไป) และบิลที่ครบกำหนดตรงวันเงินเดือนไม่ถูกหัก (ตอนนี้โค้ดทำแบบนี้ ผมไม่ได้แก้ `money-rules.md`)
4. กติกา "ปิดบังตัวเลขยาวในผลวินิจฉัย ยกเว้นยอดเงินและวันที่" ทำให้ยอด/วันที่จริงหลุดลงเอกสารได้ ควรให้ปิดบังด้วยเมื่อมาจากสลิปจริง
5. งานเก็บกวาด: ฟอนต์ Google ภายนอกและไม่มี CSP (มีมาก่อน)

## 13. สถานะ M2 และ backlog (อัปเดต 8 พ.ย. 2569)

M2-A (ตาราง/RLS/RPC ใส่ลง Supabase แล้ว) · M2-pre / M2-pre-2 (โดเมนตรงกับ DB) · R15 เวลาไทย · นาฬิกาไทย · M2-B1 (ล็อกอินฝั่งเว็บ) merge แล้ว · M2-B2 เสร็จ (spike จริงผ่าน 19/19 โดเมน `.internal` ใช้ได้) · M2-C1 (interface + Dexie + เทสต์สัญญา) merge แล้ว · M2-C2 เสร็จ (SupabaseRepository, ชุดทดสอบจริงผ่าน 21/21 · เจ้าของล็อกอินจริง ผูกข้อมูลเดิมแล้ว) · **M2-D1** เสร็จ (ตัวตรวจไฟล์ + `import_ledger` + `verifyImport`, ชุดทดสอบจริงผ่าน 27/27) · **M2-D2 กำลังทำ:** หน้าย้ายข้อมูล `MigrationWizard` + `DataSourceGate` (เลือกแหล่งข้อมูลหลังล็อกอิน) + หน้าต่างถามรหัสผ่านตอนล้างข้อมูลออนไลน์ (ดู docs/decisions/2026-11-09-m2-d2.md) · **เจ้าของต้องลองย้ายข้อมูลจริงเอง** แล้วยืนยันยอด · **ห้ามลบข้อมูลใน Dexie จนเจ้าของยืนยันว่านำเข้าครบและยอดตรง** → M2-D (นำเข้า JSON) → M2-E (PDPA) → M2-F (ทดสอบ 2 ผู้ใช้)

การตัดสินใจล่าสุดของเจ้าของ (8 พ.ย. 2569): JWT expiry ตั้งไม่ได้ (1 ชม.) → reset-password ลบ session ทั้งหมดเสมอ · session คง localStorage + มีปุ่ม "ออกจากระบบ" ในแถบเมนู · key ผู้ดูแลเก็บนอกโปรเจกต์เท่านั้น

**Backlog (ยังไม่ทำ):**
- **ลบทางเฉพาะกิจหลังเจ้าของยืนยันการย้ายข้อมูล (ก่อนเชิญผู้ใช้จริง, M2-F):** ปุ่ม "ดาวน์โหลดข้อมูลที่เก็บในเครื่องนี้" หน้าล็อกอิน + ขั้น ask-bind (ผู้ใช้อื่นยืนยันว่าข้อมูลเก่าที่ยังไม่มีเจ้าของเป็นของตน) ดู docs/decisions/2026-11-09-m2-d2.md
- นำเข้าจากไฟล์สำรองโดยผู้ใช้เลือกไฟล์เอง · นำเข้าแบบแบ่งชุดเมื่อเกิน 1,500 รายการ (วัดจริง 2,000 รายการ = 5.2 วินาที เพดานเวลา ~8 วินาที)
- ~~M2-G~~ **ทำแล้ว** (migration `20261108001100`): `bills.last_paid_month` เปลี่ยนได้เฉพาะผ่านจ่าย/ยกเลิก/นำเข้า · เพิ่มบิลที่ตั้งค่านี้ได้ต้องมีรายการจ่ายรองรับ · ดู docs/decisions/2026-11-09-m2-g.md
- **CSP** ตอน deploy (เจ้าของสั่งทำเป็นงานแยกหลัง M2) · ฟอนต์ Google ภายนอก (มีมาก่อน)
- ฟอร์มเพิ่มรายการที่เปิดค้างข้ามเที่ยงคืนยังใช้วันที่ตอนเปิด · `PayBillDialog` ข้ามสิ้นเดือนควรทดสอบด้วยมือ
- `maxLength` ในช่องกรอก (memo 2000, ชื่อ 200) ให้ตรงข้อจำกัดของ DB
- `SummaryCards` `catch {}` ไม่แยกชนิด error · `periodTotals`/`balance.ts` ใช้ `safeAdd` ให้เป็นแบบเดียวกัน
- ลด JWT expiry ตั้งไม่ได้ จึงพึ่งตรวจ session ใน `auth.sessions` ทุกคำขอ (`private.can_use_data()`)
