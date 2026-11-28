import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  FileCode,
  Lock,
  Search,
  Server,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import type { EvaluatedFeatureEntry, LayerStatus } from '../../shared/featureRegistry';
import { ApiV1Error, apiV1Request } from './apiClient';

interface FeatureHealthSummary {
  totalRegistered: number;
  verifiedCount: number;
  incompleteCount: number;
  frontendOnlyCount: number;
  backendOnlyCount: number;
  blockedExternalCount: number;
  unverifiedCount: number;
  failedTestsCount: number;
}

interface AdminFeatureHealthPayload {
  summary: FeatureHealthSummary;
  features: EvaluatedFeatureEntry[];
  verificationSummary: {
    generatedAt?: string;
    passed?: boolean;
    totalTests?: number;
    failedTests?: number;
  } | null;
}

interface AdminFeatureHealthViewProps {
  onNavigate: (section: string, opts?: Record<string, string>) => void;
}

type HealthFilter = 'all' | 'complete' | 'incomplete' | 'blocked' | 'unverified';

function renderLayerCell(status: LayerStatus) {
  switch (status) {
    case 'OK':
      return <span className="rounded bg-emerald-600/15 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-400">OK</span>;
    case 'PARTIAL':
      return <span className="rounded bg-[#B45309]/15 px-1.5 py-0.5 font-mono text-[11px] text-[#B45309] dark:text-[#FBBF24]">PARTIAL</span>;
    case 'BLOCKED':
      return <span className="rounded bg-[#B45309]/20 px-1.5 py-0.5 font-mono text-[11px] text-[#B45309] dark:text-[#FBBF24]">BLOCKED</span>;
    case 'MISSING':
      return <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[11px] text-red-700 dark:text-red-400">MISSING</span>;
    case 'N/A':
    default:
      return <span className="font-mono text-[11px] text-[var(--nx-text-secondary)]">N/A</span>;
  }
}

export const AdminFeatureHealthView: React.FC<AdminFeatureHealthViewProps> = ({ onNavigate }) => {
  const [payload, setPayload] = useState<AdminFeatureHealthPayload | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HealthFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<EvaluatedFeatureEntry | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiV1Request<AdminFeatureHealthPayload>('/admin/feature-health')
      .then((res) => {
        if (!active) return;
        setPayload({
          summary: res.summary,
          features: res.features || [],
          verificationSummary: res.verificationSummary || null,
        });
        setForbidden(false);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiV1Error && (err.status === 403 || err.status === 401)) {
          setForbidden(true);
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load feature diagnostics.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredFeatures = useMemo(() => {
    const list = payload?.features || [];
    const q = search.trim().toLowerCase();
    return list.filter((f) => {
      if (filter === 'complete' && f.effectiveStatus !== 'IMPLEMENTED_AND_VERIFIED') return false;
      if (
        filter === 'incomplete' &&
        !['NOT_STARTED', 'FRONTEND_ONLY', 'BACKEND_ONLY', 'DATABASE_ONLY', 'PARTIALLY_IMPLEMENTED'].includes(
          f.effectiveStatus
        )
      ) {
        return false;
      }
      if (filter === 'blocked' && f.effectiveStatus !== 'BLOCKED_EXTERNAL_DEPENDENCY') return false;
      if (filter === 'unverified' && f.effectiveStatus !== 'IMPLEMENTED_NOT_VERIFIED') return false;
      if (!q) return true;
      return `${f.id} ${f.name} ${f.moduleGroup} ${f.apiEndpoint}`.toLowerCase().includes(q);
    });
  }, [payload, filter, search]);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-8 text-center">
        <Lock className="mx-auto h-9 w-9 text-[#B45309] dark:text-[#FBBF24]" />
        <h1 className="mt-3 font-['Playfair_Display',serif] text-xl font-bold text-[var(--nx-text)]">Access Restricted</h1>
        <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
          Admin Feature Health diagnostics require verified administrator privileges enforced by the backend.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('features')}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-[#790B13] px-4 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Features</span>
        </button>
      </div>
    );
  }

  const summary = payload?.summary;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#790B13] dark:text-[#F7E1D3]">
            <Shield className="h-4 w-4" />
            <span>Admin Engineering Diagnostics</span>
          </div>
          <h1 className="mt-1 font-['Playfair_Display',serif] text-2xl font-bold tracking-tight text-[var(--nx-text)]">
            Feature Health &amp; Verification Matrix
          </h1>
          <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
            Live verification breakdown across frontend, backend, database, API, GUI activation, external adapters, and automated tests.
            {payload?.verificationSummary?.generatedAt
              ? ` Last report: ${new Date(payload.verificationSummary.generatedAt).toLocaleString()}`
              : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('features')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Feature Directory</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="h-64 animate-pulse rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)]" />
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { label: 'Total', value: summary.totalRegistered, tone: 'text-[var(--nx-text)]' },
                { label: 'Verified', value: summary.verifiedCount, tone: 'text-emerald-700 dark:text-emerald-400' },
                { label: 'Incomplete', value: summary.incompleteCount, tone: 'text-[#B45309] dark:text-[#FBBF24]' },
                { label: 'Frontend-Only', value: summary.frontendOnlyCount, tone: 'text-[#B45309] dark:text-[#FBBF24]' },
                { label: 'Backend-Only', value: summary.backendOnlyCount, tone: 'text-[#B45309] dark:text-[#FBBF24]' },
                { label: 'Blocked', value: summary.blockedExternalCount, tone: 'text-[#B45309] dark:text-[#FBBF24]' },
                { label: 'Unverified', value: summary.unverifiedCount, tone: 'text-[#790B13] dark:text-[#F7E1D3]' },
                { label: 'Failed Checks', value: summary.failedTestsCount, tone: summary.failedTestsCount > 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400' },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-3"
                >
                  <div className="text-[11px] font-medium text-[var(--nx-text-secondary)]">{kpi.label}</div>
                  <div className={`mt-1 font-mono text-xl font-bold ${kpi.tone}`}>{kpi.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Filter & Search Bar */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--nx-text-secondary)]" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search feature ID, module, or endpoint..."
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] py-1.5 pl-9 pr-3 text-sm text-[var(--nx-text)]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', 'All'],
                  ['complete', 'Complete'],
                  ['incomplete', 'Incomplete'],
                  ['blocked', 'Blocked'],
                  ['unverified', 'Unverified'],
                ] as Array<[HealthFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    filter === key
                      ? 'bg-[#790B13] text-[#FFF0DC]'
                      : 'border border-[var(--nx-border)] bg-[var(--nx-card-soft)] text-[var(--nx-text-secondary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Diagnostics Table */}
            <div className={`${selected ? 'lg:col-span-2' : 'lg:col-span-3'} overflow-x-auto rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)]`}>
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--nx-border)] bg-[var(--nx-card-soft)] text-[11px] uppercase tracking-wider text-[var(--nx-text-secondary)]">
                    <th className="px-3 py-2.5">Feature</th>
                    <th className="px-2 py-2.5">Frontend</th>
                    <th className="px-2 py-2.5">Backend</th>
                    <th className="px-2 py-2.5">Database</th>
                    <th className="px-2 py-2.5">API</th>
                    <th className="px-2 py-2.5">GUI</th>
                    <th className="px-2 py-2.5">Tests</th>
                    <th className="px-3 py-2.5">Overall Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--nx-border)]">
                  {filteredFeatures.map((feat) => {
                    const isSelected = selected?.id === feat.id;
                    return (
                      <tr
                        key={feat.id}
                        onClick={() => setSelected(feat)}
                        className={`cursor-pointer transition hover:bg-[var(--nx-card-soft)] ${
                          isSelected ? 'bg-[#790B13]/10' : ''
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-[var(--nx-text)]">{feat.name}</div>
                          <div className="font-mono text-[11px] text-[var(--nx-text-secondary)]">{feat.id}</div>
                        </td>
                        <td className="px-2 py-2.5">{renderLayerCell(feat.layers.frontend)}</td>
                        <td className="px-2 py-2.5">{renderLayerCell(feat.layers.backend)}</td>
                        <td className="px-2 py-2.5">{renderLayerCell(feat.layers.database)}</td>
                        <td className="px-2 py-2.5">{renderLayerCell(feat.layers.api)}</td>
                        <td className="px-2 py-2.5">{renderLayerCell(feat.layers.gui)}</td>
                        <td className="px-2 py-2.5">{renderLayerCell(feat.layers.tests)}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] ${
                              feat.effectiveStatus === 'IMPLEMENTED_AND_VERIFIED'
                                ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                                : feat.effectiveStatus === 'BLOCKED_EXTERNAL_DEPENDENCY'
                                ? 'bg-[#B45309]/15 text-[#B45309] dark:text-[#FBBF24]'
                                : 'bg-[#790B13]/12 text-[#790B13] dark:bg-[#790B13]/30 dark:text-[#F7E1D3]'
                            }`}
                          >
                            {feat.effectiveStatus === 'IMPLEMENTED_AND_VERIFIED' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            <span>{feat.effectiveStatus}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Detail Drawer */}
            {selected && (
              <aside className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-[#790B13] dark:text-[#F7E1D3]">{selected.id}</div>
                    <h2 className="text-base font-bold text-[var(--nx-text)]">{selected.name}</h2>
                    <div className="text-xs text-[var(--nx-text-secondary)]">{selected.moduleGroup}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Close detail drawer"
                    className="rounded p-1 text-[var(--nx-text-secondary)] hover:text-[var(--nx-text)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-2.5">
                    <div className="flex items-center gap-1.5 font-semibold text-[var(--nx-text)]">
                      <FileCode className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F7E1D3]" />
                      <span>Frontend &amp; GUI</span>
                    </div>
                    <div className="mt-1 text-[var(--nx-text-secondary)]">{selected.frontendComponent}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--nx-text-secondary)]">Nav: {selected.navLocation}</div>
                  </div>

                  <div className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-2.5">
                    <div className="flex items-center gap-1.5 font-semibold text-[var(--nx-text)]">
                      <Server className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F7E1D3]" />
                      <span>Backend &amp; API</span>
                    </div>
                    <div className="mt-1 text-[var(--nx-text-secondary)]">{selected.backendService}</div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--nx-text)]">{selected.apiEndpoint}</div>
                  </div>

                  <div className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-2.5">
                    <div className="flex items-center gap-1.5 font-semibold text-[var(--nx-text)]">
                      <Database className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F7E1D3]" />
                      <span>Database &amp; Auth</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--nx-text-secondary)]">{selected.databaseCollection}</div>
                    <div className="mt-1 text-[var(--nx-text-secondary)]">{selected.authorization}</div>
                  </div>

                  <div className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-2.5">
                    <div className="flex items-center gap-1.5 font-semibold text-[var(--nx-text)]">
                      <Terminal className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F7E1D3]" />
                      <span>Files &amp; Verification</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--nx-text-secondary)]">
                      Files: {selected.files.join(', ')}
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--nx-text-secondary)]">
                      Tests: {selected.testFiles.join(', ') || 'None'}
                    </div>
                    {selected.testResult && (
                      <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                        {selected.testResult.passed ? 'Passing' : 'Failing'} ({selected.testResult.detail})
                      </div>
                    )}
                  </div>

                  {(selected.missingLayers.length > 0 || selected.providerConfig.missingEnvVars.length > 0) && (
                    <div className="rounded-lg border border-[#B45309]/40 bg-[#B45309]/10 p-2.5 text-[#B45309] dark:text-[#FBBF24]">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <Activity className="h-3.5 w-3.5" />
                        <span>Blockers / External Configuration</span>
                      </div>
                      {selected.missingLayers.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[11px]">
                          {selected.missingLayers.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      )}
                      {selected.providerConfig.missingEnvVars.length > 0 && (
                        <div className="mt-1 font-mono text-[11px]">
                          Env vars: {selected.providerConfig.missingEnvVars.join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {selected.navSection && (
                  <button
                    type="button"
                    onClick={() => onNavigate(selected.navSection, selected.navMeta)}
                    className="w-full rounded-lg bg-[#790B13] px-3 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]"
                  >
                    Open Feature Surface
                  </button>
                )}
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
};
