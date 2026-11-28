import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Topography from '../components/Topography';
import LaserFlow from '../components/LaserFlow';
import Radar from '../components/Radar';
import { CommunityShowcase } from './CommunityShowcase';

function readTheme(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function readRadarDiscoverable(): boolean {
  const card = document.getElementById('nx-radar-card');
  return !card || !card.classList.contains('is-invisible');
}

const LandingTopography: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);

  useEffect(() => {
    const sync = () => setTheme(readTheme());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    window.addEventListener('nexora:theme-change', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('nexora:theme-change', sync);
    };
  }, []);

  const isLight = theme === 'light';

  return (
    <Topography
      lightMode={isLight}
      color={isLight ? '#8E0E19' : '#E11D48'}
      lineCount={26}
      lineWidth={isLight ? 1.55 : 1.65}
      elevation={1.26}
      foreground={isLight ? 0.25 : 0.3}
      tilt={30}
      speed={0.48}
      direction="forward"
      glow={isLight ? 1.0 : 1.55}
      depthOfField={0.32}
      fog={isLight ? 0.24 : 0.2}
      brightness={isLight ? 1.38 : 1.75}
      opacity={isLight ? 0.46 : 0.82}
      hoverEffect="lift"
      clickEffect="pulse"
    />
  );
};

const NearbyRadarCanvas: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);
  const [discoverable, setDiscoverable] = useState<boolean>(readRadarDiscoverable);

  useEffect(() => {
    const syncTheme = () => setTheme(readTheme());
    const syncVisibility = () => setDiscoverable(readRadarDiscoverable());

    const themeObs = new MutationObserver(syncTheme);
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    const card = document.getElementById('nx-radar-card');
    let cardObs: MutationObserver | null = null;
    if (card) {
      cardObs = new MutationObserver(syncVisibility);
      cardObs.observe(card, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    const onRadarMode = (event: Event) => {
      const detail = (event as CustomEvent<{ discoverable?: boolean }>).detail;
      if (typeof detail?.discoverable === 'boolean') {
        setDiscoverable(detail.discoverable);
      } else {
        syncVisibility();
      }
    };

    window.addEventListener('nexora:theme-change', syncTheme);
    window.addEventListener('nexora:radar-mode', onRadarMode);

    return () => {
      themeObs.disconnect();
      cardObs?.disconnect();
      window.removeEventListener('nexora:theme-change', syncTheme);
      window.removeEventListener('nexora:radar-mode', onRadarMode);
    };
  }, []);

  const isLight = theme === 'light';

  return (
    <Radar
      color={isLight ? '#790B13' : '#FFB3AE'}
      backgroundColor="transparent"
      mode="sweep"
      speed={discoverable ? 0.9 : 0}
      trail={discoverable ? 0.42 : 0.08}
      scale={0.86}
      ringCount={4}
      spokeCount={8}
      ticks={true}
      targets={discoverable ? 6 : 0}
      clutter={discoverable ? 0.28 : 0}
      glow={discoverable ? (isLight ? 0.7 : 1.35) : 0.12}
      brightness={discoverable ? (isLight ? 1.05 : 1.35) : 0.65}
      gridOpacity={discoverable ? (isLight ? 1.15 : 1.05) : 0.35}
      lineWidth={1.1}
      mouseInteraction={discoverable}
      intro={true}
      grain={0.025}
      fade={0.12}
      opacity={discoverable ? 1 : 0.48}
      lightMode={isLight}
      paused={!discoverable}
    />
  );
};

const SchoolsLaserOverlay: React.FC = () => {
  const surfaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    surfaceRef.current = document.querySelector<HTMLElement>('.nx-schools-diagram-card');
  }, []);

  return (
    <LaserFlow
      surfaceRef={surfaceRef}
      beamPosition={0.73}
      color="#ffb3ae"
      intensity={1.35}
      beamWidth={1.35}
      flare={1.45}
      spread={1.35}
      spill={0.95}
      fog={0.2}
      dust={1.3}
      streaks={1.4}
      dots={0.9}
      pulse={1.4}
      speed={1.25}
      theme="dark"
    />
  );
};

function mountNode(id: string, element: React.ReactNode) {
  const el = document.getElementById(id);
  if (!el || el.getAttribute('data-nx-mounted') === 'true') return;
  el.setAttribute('data-nx-mounted', 'true');
  createRoot(el).render(<React.StrictMode>{element}</React.StrictMode>);
}

function mountLandingEffects() {
  mountNode('nx-bg-topography-root', <LandingTopography />);
  mountNode('nx-community-carousel-root', <CommunityShowcase />);
  mountNode('nx-radar-webgl-root', <NearbyRadarCanvas />);
  mountNode('nx-schools-laser-root', <SchoolsLaserOverlay />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountLandingEffects, { once: true });
} else {
  mountLandingEffects();
}
