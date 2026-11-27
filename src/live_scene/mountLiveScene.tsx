import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveTeamScene } from './LiveTeamScene.tsx';

let mountedRoot: Root | null = null;

export function mountLiveTeamScene(container: HTMLElement | null): void {
  if (!container || mountedRoot) return;
  mountedRoot = createRoot(container);
  mountedRoot.render(
    <React.StrictMode>
      <LiveTeamScene />
    </React.StrictMode>
  );
}
