import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AuthGate } from './ui/AuthGate';
import { ErrorBoundary } from './ui/ErrorBoundary';
// ฟอนต์ IBM Plex Sans Thai โหลดจากโดเมนเอง (แพ็กเกจ @fontsource) ไม่เรียก Google Fonts
// ใช้ไฟล์รวมต่อน้ำหนัก (400.css ฯลฯ) ที่มี unicode-range: เบราว์เซอร์ดาวน์โหลดเฉพาะชุดอักษรที่หน้าใช้จริง
// ห้ามใช้ thai-400.css/latin-400.css แยกชุด: ไม่มี unicode-range จึงทับกัน อักษรไทยจะตกไปฟอนต์ระบบ
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/500.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import '@fontsource/ibm-plex-sans-thai/700.css';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('ไม่พบ #root');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary root>
      <AuthGate>
        <App />
      </AuthGate>
    </ErrorBoundary>
  </StrictMode>,
);
