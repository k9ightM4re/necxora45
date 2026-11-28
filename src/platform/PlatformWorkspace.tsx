import React, { Component, useCallback, useEffect, useState } from 'react';
import { Camera, Search, ShoppingBag, Sparkles } from 'lucide-react';
import { AdminFeatureHealthView } from './AdminFeatureHealthView';
import { FeaturesDiscoveryView } from './FeaturesDiscoveryView';
import { MarketplaceView } from './MarketplaceView';
import { NexoraCameraView } from './NexoraCameraView';
import { NexoraStudioView } from './NexoraStudioView';
import { VisualSearchView } from './VisualSearchView';

export type PlatformSection =
  | 'marketplace'
  | 'visual-search'
  | 'studio'
  | 'camera'
  | 'features'
  | 'admin-feature-health';

const VALID_PLATFORM_SECTIONS = new Set<PlatformSection>([
  'marketplace',
  'visual-search',
  'studio',
  'camera',
  'features',
  'admin-feature-health',
]);

const EXCHANGE_HUB_TABS: Array<{ id: PlatformSection; label: string; icon: React.ReactNode }> = [
  { id: 'marketplace', label: 'Exchange Catalog', icon: <ShoppingBag className="h-3.5 w-3.5" /> },
  { id: 'visual-search', label: 'Visual Search', icon: <Search className="h-3.5 w-3.5" /> },
  { id: 'studio', label: 'AI Style Studio', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: 'camera', label: 'Nexora Camera', icon: <Camera className="h-3.5 w-3.5" /> },
];

function resolveSectionFromHash(): PlatformSection | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '');
  if (raw === 'exchange') return 'marketplace';
  return VALID_PLATFORM_SECTIONS.has(raw as PlatformSection) ? (raw as PlatformSection) : null;
}

class PlatformErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg rounded-xl border border-red-500/40 bg-[var(--nx-card-bg)] p-6 text-sm text-[var(--nx-text)]">
          <div className="font-semibold text-red-400">Workspace view encountered an error</div>
          <p className="mt-1 text-xs text-[var(--nx-text-secondary)]">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-lg bg-[#3868CE] px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const PlatformWorkspace: React.FC = () => {
  const [section, setSection] = useState<PlatformSection | null>(() => resolveSectionFromHash());
  const [navOpts, setNavOpts] = useState<Record<string, any>>({});

  useEffect(() => {
    const onSectionChange = (ev: Event) => {
      const detail = (ev as CustomEvent<{ section?: string; opts?: Record<string, any> }>).detail;
      const detailSection = detail?.section as PlatformSection | undefined;
      if (detailSection && VALID_PLATFORM_SECTIONS.has(detailSection)) {
        setSection(detailSection);
        setNavOpts(detail?.opts || {});
      } else if (detailSection) {
        setSection(null);
      }
    };

    const onHashChange = () => {
      const next = resolveSectionFromHash();
      if (next) setSection(next);
    };

    window.addEventListener('nexora:section-change', onSectionChange);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('nexora:section-change', onSectionChange);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const handleNavigate = useCallback((nextSection: string, opts?: Record<string, any>) => {
    const navFn = (window as unknown as { NEXORA_SOCIAL_NAV?: (s: string, o?: Record<string, any>) => void })
      .NEXORA_SOCIAL_NAV;
    if (typeof navFn === 'function') {
      navFn(nextSection, opts);
      return;
    }
    if (VALID_PLATFORM_SECTIONS.has(nextSection as PlatformSection)) {
      window.location.hash = `#${nextSection}`;
      setSection(nextSection as PlatformSection);
      setNavOpts(opts || {});
    }
  }, []);

  if (!section) return null;

  const isExchangeEcosystemTab =
    section === 'marketplace' || section === 'visual-search' || section === 'studio' || section === 'camera';

  return (
    <PlatformErrorBoundary>
      {isExchangeEcosystemTab && (
        <div className="mx-auto mb-5 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {EXCHANGE_HUB_TABS.map((tab) => {
              const active = section === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleNavigate(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-[#3868CE] text-white'
                      : 'text-[var(--nx-text-secondary)] hover:bg-[var(--nx-card-soft)] hover:text-[var(--nx-text)]'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <span className="text-[11px] font-medium text-[var(--nx-text-secondary)]">
            Unified Social Identity · External Merchant Checkout Only
          </span>
        </div>
      )}

      {section === 'marketplace' && (
        <MarketplaceView
          onNavigate={handleNavigate}
          initialProductId={typeof navOpts.productId === 'string' ? navOpts.productId : undefined}
          openCreate={Boolean(navOpts.openCreate)}
        />
      )}
      {section === 'visual-search' && <VisualSearchView onNavigate={handleNavigate} />}
      {section === 'studio' && <NexoraStudioView onNavigate={handleNavigate} />}
      {section === 'camera' && <NexoraCameraView onNavigate={handleNavigate} />}
      {section === 'features' && <FeaturesDiscoveryView onNavigate={handleNavigate} />}
      {section === 'admin-feature-health' && <AdminFeatureHealthView onNavigate={handleNavigate} />}
    </PlatformErrorBoundary>
  );
};
