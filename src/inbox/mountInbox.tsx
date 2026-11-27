import '../index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NexoraInboxApp } from './NexoraInboxApp';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
    },
  },
});

function mountNexoraInbox() {
  const container = document.getElementById('nx-inbox-react-root');
  if (!container) return;
  if (container.getAttribute('data-nx-mounted') === 'true') return;
  container.setAttribute('data-nx-mounted', 'true');

  createRoot(container).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <NexoraInboxApp />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountNexoraInbox, { once: true });
} else {
  mountNexoraInbox();
}
