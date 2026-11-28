import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Ban,
  Bell,
  Camera,
  Compass,
  Edit3,
  Heart,
  Home,
  Image,
  Lock,
  MapPin,
  MessageSquare,
  Radio,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  User,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import type { DiscoveryCategory, EvaluatedFeatureEntry, FeatureAvailability } from '../../shared/featureRegistry';
import { apiV1Request } from './apiClient';

interface FeaturesDiscoveryViewProps {
  onNavigate: (section: string, opts?: Record<string, string>) => void;
}

const DISCOVERY_CATEGORIES: Array<'All' | DiscoveryCategory> = [
  'All',
  'Social',
  'Communication',
  'Discovery',
  'Communities',
  'Media',
  'Commerce',
  'Personalization',
];

function renderFeatureIcon(iconKey: string) {
  const cls = 'h-4 w-4 text-[#790B13] dark:text-[#F7E1D3]';
  switch (iconKey) {
    case 'home':
      return <Home className={cls} />;
    case 'compass':
      return <Compass className={cls} />;
    case 'chat':
      return <MessageSquare className={cls} />;
    case 'video':
      return <Video className={cls} />;
    case 'radio':
      return <Radio className={cls} />;
    case 'users':
      return <Users className={cls} />;
    case 'userPlus':
      return <UserPlus className={cls} />;
    case 'user':
      return <User className={cls} />;
    case 'camera':
      return <Camera className={cls} />;
    case 'image':
      return <Image className={cls} />;
    case 'reels':
      return <Video className={cls} />;
    case 'mapPin':
      return <MapPin className={cls} />;
    case 'bell':
      return <Bell className={cls} />;
    case 'shoppingBag':
      return <ShoppingBag className={cls} />;
    case 'sparkles':
      return <Sparkles className="h-4 w-4 text-[#B45309] dark:text-[#FBBF24]" />;
    case 'shield':
      return <Shield className={cls} />;
    case 'lock':
      return <Lock className={cls} />;
    case 'heart':
      return <Heart className={cls} />;
    case 'edit':
      return <Edit3 className={cls} />;
    case 'ban':
      return <Ban className={cls} />;
    default:
      return <Compass className={cls} />;
  }
}

function getAvailabilityBadge(availability: FeatureAvailability): { label: string; className: string } {
  switch (availability) {
    case 'ENABLED':
      return {
        label: 'Enabled',
        className: 'border-emerald-600/30 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400',
      };
    case 'REQUIRES_CONFIGURATION':
      return {
        label: 'Requires Config',
        className: 'border-[#B45309]/40 bg-[#B45309]/15 text-[#B45309] dark:text-[#FBBF24]',
      };
    case 'RESTRICTED_BY_PERMISSIONS':
      return {
        label: 'Restricted',
        className: 'border-[#790B13]/40 bg-[#790B13]/15 text-[#790B13] dark:text-[#F7E1D3]',
      };
    case 'COMING_SOON':
      return {
        label: 'Coming Soon',
        className: 'border-[var(--nx-border)] bg-[var(--nx-card-soft)] text-[var(--nx-text-secondary)]',
      };
    case 'DISABLED':
    default:
      return {
        label: 'Disabled',
        className: 'border-red-500/30 bg-red-500/15 text-red-400',
      };
  }
}

export const FeaturesDiscoveryView: React.FC<FeaturesDiscoveryViewProps> = ({ onNavigate }) => {
  const [features, setFeatures] = useState<EvaluatedFeatureEntry[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'All' | DiscoveryCategory>('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiV1Request<{ isAdmin: boolean; features: EvaluatedFeatureEntry[] }>('/features/registry')
      .then((res) => {
        if (!active) return;
        setIsAdmin(Boolean(res.isAdmin));
        setFeatures(res.features || []);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load feature directory.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return features.filter((f) => {
      if (selectedCategory !== 'All' && f.category !== selectedCategory) return false;
      if (!q) return true;
      return `${f.name} ${f.description} ${f.category} ${f.moduleGroup}`.toLowerCase().includes(q);
    });
  }, [features, selectedCategory, search]);

  const grouped = useMemo(() => {
    const map = new Map<DiscoveryCategory, EvaluatedFeatureEntry[]>();
    for (const item of filtered) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#790B13] dark:text-[#F7E1D3]">
            <Compass className="h-4 w-4" />
            <span>Nexora Feature Directory</span>
          </div>
          <h1 className="mt-1 font-['Playfair_Display',serif] text-2xl font-bold tracking-tight text-[var(--nx-text)]">
            All Approved Platform Capabilities
          </h1>
          <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
            Live directory generated from the central Nexora feature registry. Open any enabled module directly or inspect configuration status.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => onNavigate('admin-feature-health')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#790B13] px-3.5 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]"
          >
            <Activity className="h-3.5 w-3.5" />
            <span>Open Admin Feature Health</span>
          </button>
        )}
      </div>

      {/* Search & Category Filter */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--nx-text-secondary)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter features by name or capability..."
            className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] py-1.5 pl-9 pr-3 text-sm text-[var(--nx-text)]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DISCOVERY_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                selectedCategory === cat
                  ? 'bg-[#790B13] text-[#FFF0DC]'
                  : 'border border-[var(--nx-border)] bg-[var(--nx-card-soft)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)]" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-8 text-center text-sm text-[var(--nx-text-secondary)]">
          No Nexora features matched your filter.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <section key={category} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--nx-text-secondary)]">
                  {category}
                </h2>
                <span className="text-xs text-[var(--nx-text-secondary)]">{items.length} module(s)</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((feature) => {
                  const badge = getAvailabilityBadge(feature.effectiveAvailability);
                  const canOpen = Boolean(feature.navSection) && feature.effectiveAvailability !== 'DISABLED';
                  return (
                    <article
                      key={feature.id}
                      className="flex flex-col justify-between rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)]">
                              {renderFeatureIcon(feature.iconKey)}
                            </span>
                            <div>
                              <h3 className="text-sm font-semibold text-[var(--nx-text)]">{feature.name}</h3>
                              <div className="text-[11px] text-[var(--nx-text-secondary)]">{feature.navLocation}</div>
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
                            {badge.label}
                          </span>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                          {feature.description}
                        </p>
                        {feature.effectiveAvailability === 'REQUIRES_CONFIGURATION' &&
                          feature.providerConfig.missingEnvVars.length > 0 && (
                            <div className="mt-3 rounded-lg border border-[#B45309]/30 bg-[#B45309]/10 px-2.5 py-1.5 text-[11px] text-[#B45309] dark:text-[#FBBF24]">
                              Missing env: {feature.providerConfig.missingEnvVars.join(', ')}
                            </div>
                          )}
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-[var(--nx-border)] pt-3">
                        <span className="font-mono text-[11px] text-[var(--nx-text-secondary)]">{feature.id}</span>
                        {canOpen && (
                          <button
                            type="button"
                            onClick={() => onNavigate(feature.navSection, feature.navMeta)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#790B13] px-3 py-1.5 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]"
                          >
                            <span>Open</span>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
