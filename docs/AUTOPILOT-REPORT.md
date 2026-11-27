# รายงานโหมดทำเอง (เริ่ม 27 พ.ย. 2569)

กติกา: `docs/AUTOPILOT.md` · อัปเดตทุกครั้งที่จบงานชิ้นหนึ่ง

## ทำเสร็จแล้ว
- **#280** ปุ่มลองนำเข้าข้อมูลลงทุนอีกครั้ง merge แล้ว (`07c795b`)
- **live-contract บน `main`** รอบซ้ำ 69/69 (รอบแรก 68/69 ดู HANDOFF §117)
- **สิทธิ์ผู้ช่วย** (`.claude/settings.local.json` นอก git) เพิ่มเฉพาะ allow: `git push origin auto/*`, `git push -u origin auto/*` (Bash และ PowerShell) · Supabase `list_tables`, `list_migrations`, `query_logs`, `get_advisors`
- ตรวจฐานข้อมูลจริง (อ่านอย่างเดียว): `assets.exchange` รับเฉพาะ `NYSE`, `NASDAQ`, `OTHER`

## ตัดสินใจเองไปแล้ว (พร้อมเหตุผล)
- สิทธิ์ Supabase ใส่แค่ 4 เครื่องมือ: เครื่องมือชื่อ `get_logs` ไม่มีแล้ว ใช้ `query_logs` แทน · ไม่ใส่เครื่องมืออ่านอื่นที่ไม่จำเป็น
- รัน live-contract ซ้ำ: log ของเครื่องและของ Supabase ช่วง 14:02–14:09 UTC ไม่มี 40001/40P01/deadlock (ตรงเงื่อนไขที่เจ้าของให้รันซ้ำ)

## รอเจ้าของ (เรียงตามความสำคัญ)
1. **กฎ allow ของ push กว้างกว่าที่ชื่อบอก:** `*` กินช่องว่างได้ เช่น `git push origin auto/x:main` หรือ `... --delete <branch>` จะไม่ถูกถามยืนยัน และกฎ deny ใน `settings.json` จับ `:main` ไม่ได้ · ยังมี branch protection บน GitHub กัน `main` · **แนะนำ:** เพิ่ม deny `Bash(git push *:*)`, `PowerShell(git push *:*)`, `Bash(git push * --delete*)` และฝั่ง PowerShell ของกฎ `--force`/`-f`/`main` (ผู้ช่วยไม่ได้เพิ่ม เพราะสั่งให้แก้เฉพาะ allow)
