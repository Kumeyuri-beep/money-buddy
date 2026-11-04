import { useEffect, useRef, useState } from 'react';

/** ลากไฟล์เข้าหน้าต่างหรือไม่ (ไม่นับการลากข้อความ/ลิงก์) */
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * รับรูปสลิปจากการวาง (Ctrl+V) และการลากมาวางทั้งหน้าต่าง
 * การเลือกไฟล์จากปุ่มอยู่ที่ Header ตัวเลือกทั้งสามส่งไฟล์มาที่ onFile ที่เดียวกัน
 * การวางข้อความธรรมดา (ไม่มีไฟล์) ปล่อยให้ทำงานตามปกติ ไม่แตะ
 */
export function useSlipIntake(enabled: boolean, onFile: (file: File) => void): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  // เก็บ onFile ล่าสุดไว้ใน ref จะได้ไม่ต้องผูก/ถอด listener ใหม่ทุกครั้งที่หน้าจอ render
  const handler = useRef(onFile);
  useEffect(() => {
    handler.current = onFile;
  });

  useEffect(() => {
    if (!enabled) {
      setDragging(false);
      return;
    }
    let depth = 0; // dragenter/dragleave ยิงซ้อนตามองค์ประกอบลูก จึงนับความลึก

    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files[0];
      if (!file) return;
      e.preventDefault();
      handler.current(file);
    };
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // ไม่ preventDefault เบราว์เซอร์จะเปิดรูปแทนที่หน้าแอป
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) handler.current(file);
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [enabled]);

  return { dragging: enabled && dragging };
}
