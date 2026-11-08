import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AuthGate } from './ui/AuthGate';
import { ErrorBoundary } from './ui/ErrorBoundary';
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
