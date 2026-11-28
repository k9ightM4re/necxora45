import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Camera,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Share2,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { ApiV1Error, apiV1Request } from './apiClient';

export interface MerchantItem {
  id: string;
  ownerId?: string;
  name: string;
  domain: string;
  verified?: boolean;
  feedConfigured?: boolean;
}

export interface ProductItem {
  id: string;
  merchantId: string;
  merchantName: string;
  ownerId?: string;
  title: string;
  description: string;
  category: string;
  brand?: string;
  providerId?: string;
  sizes?: string[];
  colors?: string[];
  material?: string;
  fit?: string;
  occasion?: string;
  gender?: string;
  affiliateTag?: string;
  priceCents: number;
  currency: string;
  externalUrl: string;
  imageUrl?: string;
  tags?: string[];
  inStock: boolean;
  priceStale?: boolean;
  priceLastCheckedAtMs?: number;
  outboundClicks?: number;
}

export interface ProductCollection {
  id: string;
  title: string;
  description?: string;
  productIds: string[];
}

interface ConnectorStatusItem {
  id: string;
  name: string;
  kind: string;
  configured: boolean;
  missingEnvVars: string[];
  notes: string;
}

interface CommerceStatus {
  merchantFeedSync: {
    configured: boolean;
    reason: string;
  };
}

interface MarketplaceViewProps {
  onNavigate: (section: string, opts?: Record<string, any>) => void;
  initialProductId?: string;
  openCreate?: boolean;
}

const CATEGORIES = [
  'All',
  'Upperwear',
  'Lowerwear',
  'Footwear',
  'Outerwear',
  'Accessories',
  'Apparel',
  'Tech',
  'Home',
  'Wellness',
];

function formatPrice(cents: number, currency = 'USD'): string {
  const value = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function safeExternalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch {
    // ignore invalid URLs
  }
  return '#';
}

export const MarketplaceView: React.FC<MarketplaceViewProps> = ({
  onNavigate,
  initialProductId,
  openCreate = false,
}) => {
  const [status, setStatus] = useState<CommerceStatus | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatusItem[]>([]);
  const [merchants, setMerchants] = useState<MerchantItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [collections, setCollections] = useState<ProductCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);

  // Filters
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [brandFilter, setBrandFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');

  // Panels
  const [showCollections, setShowCollections] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);
  const [showCreateMerchant, setShowCreateMerchant] = useState(false);
  const [showCreateProduct, setShowCreateProduct] = useState(openCreate);

  // Product Detail Modal
  const [detailProduct, setDetailProduct] = useState<ProductItem | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<ProductItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [offerDollars, setOfferDollars] = useState('');

  // Merchant Creation
  const [merchantName, setMerchantName] = useState('');
  const [merchantDomain, setMerchantDomain] = useState('');

  // Product Creation
  const [pMerchantId, setPMerchantId] = useState('');
  const [pTitle, setPTitle] = useState('');
  const [pBrand, setPBrand] = useState('');
  const [pCategory, setPCategory] = useState('Upperwear');
  const [pPriceDollars, setPPriceDollars] = useState('48.00');
  const [pExternalUrl, setPExternalUrl] = useState('https://');
  const [pImageUrl, setPImageUrl] = useState('');
  const [pDescription, setPDescription] = useState('');
  const [pSizes, setPSizes] = useState('S, M, L');
  const [pColors, setPColors] = useState('');
  const [pMaterial, setPMaterial] = useState('');
  const [pOccasion, setPOccasion] = useState('Casual');
  const [pTags, setPTags] = useState('');

  // Collections
  const [collectionTitle, setCollectionTitle] = useState('');
  const [collectionDesc, setCollectionDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (openCreate) setShowCreateProduct(true);
  }, [openCreate]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (category !== 'All') params.set('category', category);
      if (brandFilter.trim()) params.set('brand', brandFilter.trim());
      if (sizeFilter.trim()) params.set('size', sizeFilter.trim());
      if (colorFilter.trim()) params.set('color', colorFilter.trim());
      if (inStockOnly) params.set('inStockOnly', 'true');
      params.set('sort', sort);

      const [st, cn, mRes, pRes, cRes] = await Promise.all([
        apiV1Request<CommerceStatus>('/commerce/status'),
        apiV1Request<{ connectors: ConnectorStatusItem[] }>('/connectors').catch(() => ({ connectors: [] })),
        apiV1Request<{ merchants: MerchantItem[] }>('/merchants'),
        apiV1Request<{ products: ProductItem[] }>(`/products?${params.toString()}`),
        apiV1Request<{ collections: ProductCollection[] }>('/commerce/collections'),
      ]);
      setStatus({ merchantFeedSync: st.merchantFeedSync });
      setConnectors(cn.connectors || []);
      setMerchants(mRes.merchants || []);
      setProducts(pRes.products || []);
      setCollections(cRes.collections || []);
      if (!pMerchantId && (mRes.merchants || []).length > 0) {
        setPMerchantId(mRes.merchants[0].id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load Nexora Exchange catalog.';
      setBanner({ tone: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  }, [query, category, brandFilter, sizeFilter, colorFilter, inStockOnly, sort, pMerchantId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openProductDetail = useCallback(async (productId: string) => {
    setDetailLoading(true);
    setInquiryMessage('');
    setOfferDollars('');
    try {
      const res = await apiV1Request<{
        product: ProductItem;
        relatedProducts: ProductItem[];
      }>(`/products/${encodeURIComponent(productId)}`);
      setDetailProduct(res.product);
      setRelatedProducts(res.relatedProducts || []);
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Could not load product details.' });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialProductId) {
      void openProductDetail(initialProductId);
    }
  }, [initialProductId, openProductDetail]);

  const handleTestSync = async (connectorId?: string) => {
    setBanner(null);
    try {
      if (connectorId) {
        await apiV1Request(`/connectors/${encodeURIComponent(connectorId)}/sync`, { method: 'POST' });
        setBanner({ tone: 'info', text: `Connector "${connectorId}" verified cleanly.` });
      } else {
        await apiV1Request('/commerce/sync', { method: 'POST' });
        setBanner({ tone: 'info', text: 'Merchant feed sync completed.' });
      }
      void loadAll();
    } catch (err) {
      if (err instanceof ApiV1Error && err.status === 503) {
        setBanner({ tone: 'warn', text: err.message });
      } else {
        setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Sync failed.' });
      }
    }
  };

  const handleCreateMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await apiV1Request<{ merchant: MerchantItem }>('/merchants', {
        method: 'POST',
        body: JSON.stringify({ name: merchantName.trim(), domain: merchantDomain.trim() }),
      });
      setMerchants((prev) => [res.merchant, ...prev]);
      setPMerchantId(res.merchant.id);
      setMerchantName('');
      setMerchantDomain('');
      setShowCreateMerchant(false);
      setBanner({ tone: 'info', text: `Merchant storefront "${res.merchant.name}" created.` });
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to create merchant.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    try {
      const cents = Math.max(0, Math.round(Number.parseFloat(pPriceDollars || '0') * 100));
      const tags = pTags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 15);
      const sizes = pSizes.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 16);
      const colors = pColors.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 12);
      const res = await apiV1Request<{ product: ProductItem }>('/products', {
        method: 'POST',
        body: JSON.stringify({
          merchantId: pMerchantId,
          title: pTitle.trim(),
          brand: pBrand.trim(),
          description: pDescription.trim(),
          category: pCategory,
          sizes,
          colors,
          material: pMaterial.trim(),
          occasion: pOccasion.trim(),
          priceCents: cents,
          currency: 'USD',
          externalUrl: pExternalUrl.trim(),
          imageUrl: pImageUrl.trim(),
          tags,
          inStock: true,
        }),
      });
      setProducts((prev) => [res.product, ...prev]);
      setPTitle('');
      setPBrand('');
      setPDescription('');
      setPTags('');
      setPColors('');
      setPMaterial('');
      setPImageUrl('');
      setPExternalUrl('https://');
      setShowCreateProduct(false);
      setBanner({ tone: 'info', text: `Published "${res.product.title}" to Nexora Exchange.` });
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to publish product.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectionTitle.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiV1Request<{ collection: ProductCollection }>('/commerce/collections', {
        method: 'POST',
        body: JSON.stringify({
          title: collectionTitle.trim(),
          description: collectionDesc.trim(),
          productIds: [],
        }),
      });
      setCollections((prev) => [res.collection, ...prev]);
      setCollectionTitle('');
      setCollectionDesc('');
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to save collection.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleProductInDefaultCollection = async (productId: string) => {
    try {
      const target = collections[0];
      if (!target) {
        const created = await apiV1Request<{ collection: ProductCollection }>('/commerce/collections', {
          method: 'POST',
          body: JSON.stringify({ title: 'Saved Finds', description: 'Saved Exchange listings', productIds: [productId] }),
        });
        setCollections([created.collection]);
        setBanner({ tone: 'info', text: 'Saved item to "Saved Finds" collection.' });
        return;
      }
      const exists = target.productIds.includes(productId);
      const nextIds = exists
        ? target.productIds.filter((id) => id !== productId)
        : [...target.productIds, productId];
      const updated = await apiV1Request<{ collection: ProductCollection }>(`/commerce/collections/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ productIds: nextIds }),
      });
      setCollections((prev) => prev.map((c) => (c.id === target.id ? updated.collection : c)));
      setBanner({
        tone: 'info',
        text: exists ? `Removed from "${target.title}".` : `Saved to "${target.title}".`,
      });
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to update collection.' });
    }
  };

  const handleDeleteCollection = async (collectionId: string) => {
    try {
      await apiV1Request(`/commerce/collections/${collectionId}`, { method: 'DELETE' });
      setCollections((prev) => prev.filter((c) => c.id !== collectionId));
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to delete collection.' });
    }
  };

  const handleVisitMerchant = async (product: ProductItem) => {
    const fallback = safeExternalUrl(product.externalUrl);
    try {
      const res = await apiV1Request<{ targetUrl: string; outboundClicks: number }>(
        `/products/${encodeURIComponent(product.id)}/outbound-click`,
        { method: 'POST' }
      );
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, outboundClicks: res.outboundClicks } : p))
      );
      if (detailProduct?.id === product.id) {
        setDetailProduct((d) => (d ? { ...d, outboundClicks: res.outboundClicks } : d));
      }
      window.open(res.targetUrl || fallback, '_blank', 'noopener,noreferrer');
    } catch {
      if (fallback !== '#') window.open(fallback, '_blank', 'noopener,noreferrer');
    }
  };

  const handleContactMerchant = async () => {
    if (!detailProduct) return;
    setSubmitting(true);
    try {
      const parsedOffer = offerDollars.trim() ? Math.round(Number.parseFloat(offerDollars) * 100) : undefined;
      const res = await apiV1Request<{ threadId: string; merchantName: string }>('/commerce/contact-merchant', {
        method: 'POST',
        body: JSON.stringify({
          merchantId: detailProduct.merchantId,
          productId: detailProduct.id,
          initialMessage:
            inquiryMessage.trim() ||
            `Hi! Checking availability & sizing for "${detailProduct.title}".`,
          ...(parsedOffer && parsedOffer > 0 ? { offerPriceCents: parsedOffer } : {}),
        }),
      });
      setDetailProduct(null);
      setBanner({ tone: 'info', text: `Opened conversation with ${res.merchantName} in Inbox.` });
      const bridge = (window as unknown as { NEXORA_APP_BRIDGE?: { selectDm?: (id: string) => void } }).NEXORA_APP_BRIDGE;
      bridge?.selectDm?.(res.threadId);
      onNavigate('messages', { threadId: res.threadId });
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to message merchant.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleShareProductToFeed = async (product: ProductItem) => {
    setSubmitting(true);
    try {
      await apiV1Request('/posts', {
        method: 'POST',
        body: JSON.stringify({
          content: `Spotted on Nexora Exchange: ${product.title} by ${product.merchantName} (${formatPrice(product.priceCents, product.currency)})`,
          visibility: 'public',
          productIds: [product.id],
          media: product.imageUrl ? [{ type: 'image', url: product.imageUrl, name: product.title }] : [],
        }),
      });
      setBanner({ tone: 'info', text: `Shared "${product.title}" with product tag to your Home feed!` });
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to share product to feed.' });
    } finally {
      setSubmitting(false);
    }
  };

  const savedSet = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collections) {
      for (const pid of c.productIds || []) ids.add(pid);
    }
    return ids;
  }, [collections]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#4777DF]">
            <ShoppingBag className="h-4 w-4" />
            <span>Nexora Exchange · Integrated Social Commerce</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--nx-text)]">
            Discover Fashion &amp; Creator Storefronts
          </h1>
          <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
            Browse curated Exchange items, filter by size &amp; style, contact merchants directly in Inbox, or test looks in AI Style Studio. Checkout completes on merchant websites.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('visual-search')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#4777DF]"
          >
            <Camera className="h-3.5 w-3.5 text-[#4777DF]" />
            <span>Visual Search</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('studio')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#C49A52]"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#C49A52]" />
            <span>Style Studio</span>
          </button>
          <button
            type="button"
            onClick={() => setShowConnectors((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)]"
          >
            <PlugZap className="h-3.5 w-3.5 text-[#C49A52]" />
            <span>Connectors ({connectors.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCollections((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)]"
          >
            <Bookmark className="h-3.5 w-3.5 text-[#4777DF]" />
            <span>Collections ({collections.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateMerchant((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)]"
          >
            <Store className="h-3.5 w-3.5" />
            <span>Add Merchant</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateProduct((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3868CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4777DF]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Publish Listing</span>
          </button>
        </div>
      </div>

      {/* Explicit Adapter Configuration Banner */}
      {status && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            {status.merchantFeedSync.configured ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#C49A52]" />
            )}
            <div>
              <span className="font-semibold text-[var(--nx-text)]">
                Merchant Feed Sync:{' '}
                {status.merchantFeedSync.configured ? 'Connected' : 'Requires Configuration'}
              </span>
              <span className="ml-2 text-xs text-[var(--nx-text-secondary)]">
                {status.merchantFeedSync.configured
                  ? 'Automated catalog sync enabled.'
                  : `${status.merchantFeedSync.reason} Verified merchants and manual catalog publishing are active.`}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleTestSync()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-1.5 text-xs font-medium text-[var(--nx-text)] hover:border-[#4777DF]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync Feed</span>
          </button>
        </div>
      )}

      {banner && (
        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm ${
            banner.tone === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-400'
              : banner.tone === 'warn'
                ? 'border-[#C49A52]/40 bg-[#C49A52]/10 text-[#C49A52]'
                : 'border-[#4777DF]/40 bg-[#4777DF]/10 text-[#4777DF]'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss alert">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Marketplace Connectors Drawer */}
      {showConnectors && (
        <div className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--nx-text)]">
              Marketplace Feed Connectors (Official APIs Only — Zero Scraping)
            </h2>
            <button type="button" onClick={() => setShowConnectors(false)} className="text-xs text-[var(--nx-text-secondary)]">
              Close
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {connectors.map((c) => (
              <div
                key={c.id}
                className="flex flex-col justify-between rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3 text-xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[var(--nx-text)]">{c.name}</strong>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                        c.configured
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-[#C49A52]/15 text-[#C49A52]'
                      }`}
                    >
                      {c.configured ? 'CONNECTED' : 'REQUIRES_CONFIGURATION'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--nx-text-secondary)]">{c.notes}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTestSync(c.id)}
                  className="mt-3 inline-flex w-fit items-center gap-1 rounded border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--nx-text)] hover:border-[#4777DF]"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Test Sync</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Merchant Creation Form */}
      {showCreateMerchant && (
        <form
          onSubmit={handleCreateMerchant}
          className="grid gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4 md:grid-cols-3"
        >
          <input
            type="text"
            required
            placeholder="Merchant name (e.g. Atelier Studio)"
            value={merchantName}
            onChange={(e) => setMerchantName(e.target.value)}
            className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
          />
          <input
            type="text"
            required
            placeholder="Domain (e.g. atelierstudio.example)"
            value={merchantDomain}
            onChange={(e) => setMerchantDomain(e.target.value)}
            className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#3868CE] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4777DF] disabled:opacity-50"
            >
              Create Merchant
            </button>
            <button
              type="button"
              onClick={() => setShowCreateMerchant(false)}
              className="rounded-lg border border-[var(--nx-border)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Product Creation Form */}
      {showCreateProduct && (
        <form
          onSubmit={handleCreateProduct}
          className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--nx-text)]">Publish Fashion or Commerce Listing</h2>
            {merchants.length === 0 && (
              <span className="text-xs text-[#C49A52]">Create a merchant first before publishing.</span>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <select
              required
              value={pMerchantId}
              onChange={(e) => setPMerchantId(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            >
              <option value="">Select Merchant...</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.domain})
                </option>
              ))}
            </select>
            <input
              type="text"
              required
              placeholder="Product title"
              value={pTitle}
              onChange={(e) => setPTitle(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <input
              type="text"
              placeholder="Brand (e.g. Atelier Nord)"
              value={pBrand}
              onChange={(e) => setPBrand(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <select
              value={pCategory}
              onChange={(e) => setPCategory(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            >
              {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="Price USD"
              value={pPriceDollars}
              onChange={(e) => setPPriceDollars(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <input
              type="url"
              required
              placeholder="https://merchant.example/item"
              value={pExternalUrl}
              onChange={(e) => setPExternalUrl(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <input
              type="text"
              placeholder="Sizes (e.g. S, M, L)"
              value={pSizes}
              onChange={(e) => setPSizes(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <input
              type="text"
              placeholder="Colors (e.g. Charcoal, Ivory)"
              value={pColors}
              onChange={(e) => setPColors(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <input
              type="text"
              placeholder="Material / Fabric (e.g. Wool)"
              value={pMaterial}
              onChange={(e) => setPMaterial(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              type="text"
              placeholder="Image URL (optional)"
              value={pImageUrl}
              onChange={(e) => setPImageUrl(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <input
              type="text"
              placeholder="Occasion (e.g. Casual, Formal)"
              value={pOccasion}
              onChange={(e) => setPOccasion(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
            <input
              type="text"
              placeholder="Tags (comma-separated)"
              value={pTags}
              onChange={(e) => setPTags(e.target.value)}
              className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
            />
          </div>
          <input
            type="text"
            placeholder="Short product description"
            value={pDescription}
            onChange={(e) => setPDescription(e.target.value)}
            className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateProduct(false)}
              className="rounded-lg border border-[var(--nx-border)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !pMerchantId}
              className="rounded-lg bg-[#3868CE] px-4 py-2 text-xs font-semibold text-white hover:bg-[#4777DF] disabled:opacity-50"
            >
              Publish Product
            </button>
          </div>
        </form>
      )}

      {/* Saved Collections Drawer */}
      {showCollections && (
        <div className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--nx-text)]">Saved Exchange Collections</h2>
            <button type="button" onClick={() => setShowCollections(false)} className="text-xs text-[var(--nx-text-secondary)]">
              Close
            </button>
          </div>
          <form onSubmit={handleCreateCollection} className="flex flex-wrap gap-2">
            <input
              type="text"
              required
              placeholder="New collection title..."
              value={collectionTitle}
              onChange={(e) => setCollectionTitle(e.target.value)}
              className="min-w-[200px] flex-1 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-1.5 text-sm text-[var(--nx-text)]"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={collectionDesc}
              onChange={(e) => setCollectionDesc(e.target.value)}
              className="min-w-[200px] flex-1 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-1.5 text-sm text-[var(--nx-text)]"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#3868CE] px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              Create Collection
            </button>
          </form>
          {collections.length === 0 ? (
            <p className="text-xs text-[var(--nx-text-secondary)]">No saved collections yet. Save any item below to start one.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {collections.map((col) => (
                <div
                  key={col.id}
                  className="flex items-center justify-between rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--nx-text)]">{col.title}</div>
                    <div className="text-xs text-[var(--nx-text-secondary)]">
                      {col.productIds?.length || 0} item(s){col.description ? ` · ${col.description}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteCollection(col.id)}
                    aria-label={`Delete collection ${col.title}`}
                    className="rounded p-1 text-[var(--nx-text-secondary)] hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Faceted Filters Bar */}
      <div className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--nx-text-secondary)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items, brands, fabric, merchants..."
              className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] py-1.5 pl-9 pr-3 text-sm text-[var(--nx-text)]"
            />
          </div>
          <input
            type="text"
            placeholder="Brand"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="w-28 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-1.5 text-xs text-[var(--nx-text)]"
          />
          <input
            type="text"
            placeholder="Size (M, 42)"
            value={sizeFilter}
            onChange={(e) => setSizeFilter(e.target.value)}
            className="w-28 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-1.5 text-xs text-[var(--nx-text)]"
          />
          <input
            type="text"
            placeholder="Color"
            value={colorFilter}
            onChange={(e) => setColorFilter(e.target.value)}
            className="w-28 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-1.5 text-xs text-[var(--nx-text)]"
          />
          <label className="flex items-center gap-1.5 text-xs text-[var(--nx-text-secondary)]">
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
            <span>In Stock</span>
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'newest' | 'price_asc' | 'price_desc')}
            aria-label="Sort products"
            className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-1.5 text-xs text-[var(--nx-text)]"
          >
            <option value="newest">Newest Checked</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                category === cat
                  ? 'bg-[#3868CE] text-white'
                  : 'border border-[var(--nx-border)] bg-[var(--nx-card-soft)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-64 animate-pulse rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)]" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-8 text-center">
          <ShoppingBag className="mx-auto h-8 w-8 text-[var(--nx-text-secondary)]" />
          <h2 className="mt-3 text-base font-semibold text-[var(--nx-text)]">No Exchange listings match your filter</h2>
          <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
            Adjust your filters or publish a merchant and fashion listing above.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const isSaved = savedSet.has(product.id);
            return (
              <article
                key={product.id}
                className="flex flex-col justify-between overflow-hidden rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)]"
              >
                <div className="cursor-pointer" onClick={() => void openProductDetail(product.id)}>
                  <div className="relative h-44 w-full bg-[var(--nx-card-soft)]">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-[var(--nx-text-secondary)]">
                        <ShoppingBag className="mr-1.5 h-4 w-4" />
                        <span>{product.category}</span>
                      </div>
                    )}
                    {product.priceStale && (
                      <span className="absolute right-2 top-2 rounded-md border border-[#C49A52]/50 bg-[#101318]/85 px-2 py-0.5 text-[11px] font-medium text-[#C49A52]">
                        Price &gt;24h old
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium text-[#4777DF]">
                          {product.brand ? `${product.brand} · ` : ''}
                          {product.merchantName}
                        </div>
                        <h3 className="mt-0.5 text-sm font-semibold text-[var(--nx-text)]">{product.title}</h3>
                      </div>
                      <div className="text-sm font-bold text-[var(--nx-text)]">
                        {formatPrice(product.priceCents, product.currency)}
                      </div>
                    </div>
                    {product.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-[var(--nx-text-secondary)]">{product.description}</p>
                    )}
                    {Array.isArray(product.sizes) && product.sizes.length > 0 && (
                      <div className="mt-2 text-[11px] text-[var(--nx-text-secondary)]">
                        Sizes: {product.sizes.join(', ')}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-[var(--nx-border)] px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => handleToggleProductInDefaultCollection(product.id)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      isSaved
                        ? 'bg-[#4777DF]/15 text-[#4777DF]'
                        : 'border border-[var(--nx-border)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text)]'
                    }`}
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    <span>{isSaved ? 'Saved' : 'Save'}</span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void openProductDetail(product.id)}
                      className="rounded-lg border border-[var(--nx-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--nx-text)] hover:border-[#4777DF]"
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleVisitMerchant(product)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#3868CE] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4777DF]"
                    >
                      <span>Shop</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Rich Product Detail & Merchant Inquiry Modal */}
      {(detailProduct || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Product details"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--nx-border)] pb-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#4777DF]">
                  {detailProduct?.merchantName || 'Merchant'} · {detailProduct?.category || ''}
                </div>
                <h2 className="mt-1 text-xl font-bold text-[var(--nx-text)]">
                  {detailLoading ? 'Loading item...' : detailProduct?.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDetailProduct(null)}
                aria-label="Close product detail"
                className="rounded-lg border border-[var(--nx-border)] p-1.5 text-[var(--nx-text-secondary)] hover:text-[var(--nx-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailProduct && (
              <div className="mt-5 space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="overflow-hidden rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-soft)]">
                    {detailProduct.imageUrl ? (
                      <img src={detailProduct.imageUrl} alt={detailProduct.title} className="h-64 w-full object-cover" />
                    ) : (
                      <div className="flex h-64 items-center justify-center text-sm text-[var(--nx-text-secondary)]">
                        No image provided
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="text-2xl font-bold text-[var(--nx-text)]">
                      {formatPrice(detailProduct.priceCents, detailProduct.currency)}
                    </div>
                    <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                      {detailProduct.description || 'Verified Exchange listing.'}
                    </p>
                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3 text-xs">
                      <div>
                        <span className="text-[var(--nx-text-secondary)]">Brand:</span>{' '}
                        <strong className="text-[var(--nx-text)]">{detailProduct.brand || detailProduct.merchantName}</strong>
                      </div>
                      <div>
                        <span className="text-[var(--nx-text-secondary)]">Stock:</span>{' '}
                        <strong className="text-[var(--nx-text)]">
                          {detailProduct.inStock ? 'Available' : 'Out of Stock'}
                        </strong>
                      </div>
                      {detailProduct.material && (
                        <div>
                          <span className="text-[var(--nx-text-secondary)]">Material:</span>{' '}
                          <strong className="text-[var(--nx-text)]">{detailProduct.material}</strong>
                        </div>
                      )}
                      {detailProduct.occasion && (
                        <div>
                          <span className="text-[var(--nx-text-secondary)]">Occasion:</span>{' '}
                          <strong className="text-[var(--nx-text)]">{detailProduct.occasion}</strong>
                        </div>
                      )}
                      {Array.isArray(detailProduct.sizes) && detailProduct.sizes.length > 0 && (
                        <div className="col-span-2">
                          <span className="text-[var(--nx-text-secondary)]">Sizes:</span>{' '}
                          <strong className="text-[var(--nx-text)]">{detailProduct.sizes.join(', ')}</strong>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleVisitMerchant(detailProduct)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#3868CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4777DF]"
                      >
                        <span>Visit Merchant Site</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleShareProductToFeed(detailProduct)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)]"
                      >
                        <Share2 className="h-3.5 w-3.5 text-[#4777DF]" />
                        <span>Share to Feed</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailProduct(null);
                          onNavigate('studio');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#C49A52]/40 bg-[#C49A52]/10 px-3 py-2 text-xs font-semibold text-[#C49A52]"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Style in Studio</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--nx-text-secondary)]">
                      Nexora does not process payments. Purchases complete strictly on the external merchant storefront.
                    </p>
                  </div>
                </div>

                {/* Contact Merchant / Make Price Offer in Human Inbox */}
                <div className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--nx-text)]">
                    <MessageSquare className="h-4 w-4 text-[#4777DF]" />
                    <span>Message Merchant Directly in Nexora Inbox</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      placeholder="Ask about fit, shipping, or availability..."
                      value={inquiryMessage}
                      onChange={(e) => setInquiryMessage(e.target.value)}
                      className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs text-[var(--nx-text)] sm:col-span-2"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Optional Offer USD"
                      value={offerDollars}
                      onChange={(e) => setOfferDollars(e.target.value)}
                      className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs text-[var(--nx-text)]"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleContactMerchant}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#3868CE] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#4777DF] disabled:opacity-50"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>{offerDollars ? 'Send Offer to Merchant' : 'Contact Merchant'}</span>
                  </button>
                </div>

                {relatedProducts.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--nx-text-secondary)]">
                      Related Exchange Pieces
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {relatedProducts.slice(0, 3).map((rp) => (
                        <button
                          key={rp.id}
                          type="button"
                          onClick={() => void openProductDetail(rp.id)}
                          className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-2.5 text-left text-xs hover:border-[#4777DF]"
                        >
                          <div className="truncate font-semibold text-[var(--nx-text)]">{rp.title}</div>
                          <div className="text-[11px] text-[var(--nx-text-secondary)]">
                            {rp.merchantName} · {formatPrice(rp.priceCents, rp.currency)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
