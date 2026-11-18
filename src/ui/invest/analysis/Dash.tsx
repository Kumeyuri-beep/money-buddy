/** ค่าที่ยังไม่มีข้อมูล: ตาเห็น "—" และโปรแกรมอ่านหน้าจออ่านเป็นข้อความ (ห้ามเลขปลอม) */
export function Dash({ why }: { why?: string }) {
  return (
    <>
      <span aria-hidden="true" title={why}>—</span>
      <span className="sr-only">{why ?? 'No data yet'}</span>
    </>
  );
}
