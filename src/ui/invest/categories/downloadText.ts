/** ส่งออกไฟล์ข้อความในเครื่อง (Blob + ลิงก์ดาวน์โหลด) ไม่ส่งข้อมูลออกนอกเครื่อง · ใช้กับ JSON ของหน้า Categories (CSV ใช้ downloadCsv เดิม) */
export function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
