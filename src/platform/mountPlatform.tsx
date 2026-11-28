import '../index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlatformWorkspace } from './PlatformWorkspace';

function mountNexoraPlatform() {
  const container = document.getElementById('nx-platform-react-root');
  if (!container) return;
  if (container.getAttribute('data-nx-mounted') === 'true') return;
  container.setAttribute('data-nx-mounted', 'true');

  createRoot(container).render(
    <React.StrictMode>
      <PlatformWorkspace />
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountNexoraPlatform, { once: true });
} else {
  mountNexoraPlatform();
}
