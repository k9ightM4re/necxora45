import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ExternalLink,
  Search,
  ShoppingBag,
  Sparkles,
  Upload,
} from 'lucide-react';
import { apiV1Request } from './apiClient';
import type { ProductItem } from './MarketplaceView';
import { CAMERA_HANDOFF_STORAGE_KEY } from './NexoraCameraView';

interface VisualSearchStatus {
  externalVisualSearch: {
    configured: boolean;
    fallback?: string;
    reason?: string;
  };
  geminiVisionFallbackConfigured: boolean;
}

interface DetectedGarmentItem {
  slot: string;
  label: string;
  category: string;
  color?: string;
  material?: string;
  style?: string;
  confidence?: number;
}

interface VisualMatch {
  product: ProductItem;
  similarityScore: number;
  matchTier?: 'exact' | 'similar';
  matchReasons?: string[];
  matchedSlot?: string;
}

interface VisualSearchViewProps {
  onNavigate: (section: string, opts?: Record<string, string>) => void;
}

export const VisualSearchView: React.FC<VisualSearchViewProps> = ({ onNavigate }) => {
  const [status, setStatus] = useState<VisualSearchStatus | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [queryHint, setQueryHint] = useState('');
  const [category, setCategory] = useState('');
  const [colorHint, setColorHint] = useState('');

  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adapterMessage, setAdapterMessage] = useState<string | null>(null);
  const [extractedKeywords, setExtractedKeywords] = useState<string[]>([]);
  const [detectedItems, setDetectedItems] = useState<DetectedGarmentItem[]>([]);
  const [exactMatches, setExactMatches] = useState<VisualMatch[]>([]);
  const [visuallySimilar, setVisuallySimilar] = useState<VisualMatch[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    void apiV1Request<VisualSearchStatus>('/visual-search/status')
      .then((res) =>
        setStatus({
          externalVisualSearch: res.externalVisualSearch,
          geminiVisionFallbackConfigured: res.geminiVisionFallbackConfigured,
        })
      )
      .catch(() => {});

    try {
      const handoff = sessionStorage.getItem(CAMERA_HANDOFF_STORAGE_KEY);
      if (handoff) {
        setImageDataUrl(handoff);
        sessionStorage.removeItem(CAMERA_HANDOFF_STORAGE_KEY);
      }
    } catch {
      // ignore storage unavailability
    }
  }, []);

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3_500_000) {
      setError('Image must be 3.5 MB or smaller for visual search.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSearching(true);
    try {
      const res = await apiV1Request<{
        externalProviderConfigured: boolean;
        matchSource: string;
        adapterMessage: string;
        extractedKeywords: string[];
        detectedItems?: DetectedGarmentItem[];
        exactMatches?: VisualMatch[];
        visuallySimilar?: VisualMatch[];
        matches: VisualMatch[];
      }>('/visual-search', {
        method: 'POST',
        body: JSON.stringify({
          imageDataUrl,
          queryHint: queryHint.trim(),
          category: category.trim(),
          colorHint: colorHint.trim(),
        }),
      });
      setAdapterMessage(res.adapterMessage);
      setExtractedKeywords(res.extractedKeywords || []);
      setDetectedItems(res.detectedItems || []);
      setExactMatches(res.exactMatches || []);
      setVisuallySimilar(
        res.visuallySimilar && res.visuallySimilar.length > 0
          ? res.visuallySimilar
          : (res.matches || []).filter((m) => m.matchTier !== 'exact')
      );
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Visual search request failed.');
    } finally {
      setSearching(false);
    }
  };

  const renderMatchCard = (entry: VisualMatch) => {
    const { product, similarityScore, matchReasons, matchedSlot } = entry;
    const href = /^https?:\/\//i.test(product.externalUrl) ? product.externalUrl : '#';
    return (
      <article
        key={product.id}
        className="flex flex-col justify-between overflow-hidden rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)]"
      >
        <div>
          <div className="relative h-40 w-full bg-[var(--nx-card-soft)]">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.title} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-[var(--nx-text-secondary)]">
                <ShoppingBag className="mr-1.5 h-4 w-4" />
                <span>{product.category}</span>
              </div>
            )}
            <span className="absolute right-2 top-2 rounded bg-[#2A0A0D]/90 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-[#FFF0DC]">
              Score {similarityScore}
            </span>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[#790B13] dark:text-[#F2B8B5]">{product.merchantName}</span>
              {matchedSlot && (
                <span className="rounded bg-[#B45309]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[#B45309] dark:text-amber-300">
                  {matchedSlot}
                </span>
              )}
            </div>
            <h3 className="mt-1 text-sm font-semibold text-[var(--nx-text)]">{product.title}</h3>
            <p className="mt-0.5 text-xs text-[var(--nx-text-secondary)]">
              {product.brand ? `${product.brand} · ` : ''}
              {product.category}
            </p>
            {Array.isArray(matchReasons) && matchReasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {matchReasons.slice(0, 3).map((r) => (
                  <span
                    key={r}
                    className="rounded border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--nx-border)] px-4 py-2.5">
          <span className="text-sm font-bold tabular-nums text-[var(--nx-text)]">
            ${(Number(product.priceCents || 0) / 100).toFixed(2)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('marketplace', { productId: product.id })}
              className="rounded-lg border border-[var(--nx-border)] px-2.5 py-1 text-xs font-medium text-[var(--nx-text)] hover:border-[#790B13]"
            >
              Details
            </button>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-[#790B13] px-2.5 py-1 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]"
            >
              <span>Shop</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#790B13] dark:text-[#F2B8B5]">
            <Camera className="h-4 w-4" />
            <span>Visual fashion search</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-[var(--nx-text)]">
            Multi-garment detection &amp; catalog matching
          </h1>
          <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
            Upload an outfit photo or capture via Nexora Camera to extract Upperwear, Lowerwear, Footwear, Outerwear, and Accessories slots.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigate('camera')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13]"
          >
            <Camera className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F2B8B5]" />
            <span>Capture look</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('marketplace')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13]"
          >
            <ShoppingBag className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F2B8B5]" />
            <span>Browse Shop</span>
          </button>
        </div>
      </div>

      {status && (
        <div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-4 py-3 text-sm">
          <div className="flex items-center gap-2.5">
            {status.externalVisualSearch.configured ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#B45309] dark:text-amber-300" />
            )}
            <span className="font-semibold text-[var(--nx-text)]">
              External Visual Index:{' '}
              {status.externalVisualSearch.configured ? 'Configured' : 'Requires Configuration'}
            </span>
          </div>
          <p className="mt-1 pl-6 text-xs text-[var(--nx-text-secondary)]">
            {status.externalVisualSearch.configured
              ? 'External web visual product index active.'
              : 'Matching runs against real Nexora Exchange listings' +
                (status.geminiVisionFallbackConfigured
                  ? ' powered by Gemini structured fashion slot & attribute extraction.'
                  : ' using attribute & keyword scoring.')}
          </p>
        </div>
      )}

      <form
        onSubmit={handleSearch}
        className="grid gap-5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5 md:grid-cols-2"
      >
        <div className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--nx-text-secondary)]">
            Reference Outfit or Garment Photo
          </label>
          <label className="flex h-56 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3 text-center hover:border-[#790B13]">
            {imageDataUrl ? (
              <img src={imageDataUrl} alt="Visual search preview" className="h-full w-full rounded-lg object-contain" />
            ) : (
              <>
                <Upload className="h-7 w-7 text-[#790B13] dark:text-[#F2B8B5]" />
                <span className="mt-2 text-sm font-medium text-[var(--nx-text)]">Select an image to analyze</span>
                <span className="mt-1 text-xs text-[var(--nx-text-secondary)]">PNG, JPG, or WEBP up to 3.5 MB</span>
              </>
            )}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImagePick} className="hidden" />
          </label>
          {imageDataUrl && (
            <button
              type="button"
              onClick={() => setImageDataUrl('')}
              className="text-xs text-[var(--nx-text-secondary)] underline"
            >
              Clear selected image
            </button>
          )}
        </div>

        <div className="flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">
                Keywords or Style Intent
              </label>
              <input
                type="text"
                placeholder="e.g. structured wool blazer, white leather sneakers"
                value={queryHint}
                onChange={(e) => setQueryHint(e.target.value)}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Category Slot</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                >
                  <option value="">All Garment Slots</option>
                  <option value="Upperwear">Upperwear</option>
                  <option value="Lowerwear">Lowerwear</option>
                  <option value="Footwear">Footwear</option>
                  <option value="Outerwear">Outerwear</option>
                  <option value="Accessories">Accessories</option>
                  <option value="Apparel">Apparel</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Color / Fabric</label>
                <input
                  type="text"
                  placeholder="e.g. charcoal, linen"
                  value={colorHint}
                  onChange={(e) => setColorHint(e.target.value)}
                  className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                />
              </div>
            </div>
          </div>

          {error && <div className="rounded-lg border border-red-600/35 bg-red-600/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>}

          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#790B13] px-4 py-2.5 text-sm font-semibold text-[#FFF0DC] hover:bg-[#5C0810] disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            <span>{searching ? 'Analyzing outfit & matching...' : 'Analyze & find matching products'}</span>
          </button>
        </div>
      </form>

      {hasSearched && (
        <div className="space-y-6">
          {adapterMessage && (
            <div className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-4 py-2.5 text-xs text-[var(--nx-text-secondary)]">
              <span>{adapterMessage}</span>
              {extractedKeywords.length > 0 && (
                <span className="ml-2 text-[var(--nx-text)]">Tokens: {extractedKeywords.join(', ')}</span>
              )}
            </div>
          )}

          {detectedItems.length > 0 && (
            <section className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text)]">
                <Sparkles className="h-4 w-4 text-[#B45309] dark:text-amber-300" />
                <span>Detected garment slots ({detectedItems.length})</span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {detectedItems.map((item, idx) => (
                  <div
                    key={`${item.slot}-${idx}`}
                    className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold tracking-wide text-[#790B13] dark:text-[#F2B8B5]">{item.slot}</span>
                      {typeof item.confidence === 'number' && (
                        <span className="font-mono text-[11px] tabular-nums text-[var(--nx-text-secondary)]">
                          {Math.round(item.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-medium text-[var(--nx-text)]">{item.label}</div>
                    <div className="mt-1 text-[11px] text-[var(--nx-text-secondary)]">
                      {[item.color, item.material, item.style].filter(Boolean).join(' · ') || item.category}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {exactMatches.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-[var(--nx-text)]">
                Exact Matches ({exactMatches.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{exactMatches.map(renderMatchCard)}</div>
            </section>
          )}

          {visuallySimilar.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-[var(--nx-text)]">
                Visually Similar Pieces ({visuallySimilar.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visuallySimilar.map(renderMatchCard)}</div>
            </section>
          )}

          {exactMatches.length === 0 && visuallySimilar.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-6 text-center text-sm text-[var(--nx-text-secondary)]">
              No active Nexora Exchange items matched those visual attributes yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
