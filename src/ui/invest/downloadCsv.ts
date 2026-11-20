/** ส่งออกไฟล์ CSV ในเครื่อง (Blob + ลิงก์ดาวน์โหลด) ไม่ส่งข้อมูลออกนอกเครื่อง · วิธีเดียวกับปุ่ม Export ของ Report */
export function downloadCsv(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
