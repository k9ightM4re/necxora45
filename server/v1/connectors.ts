export type ConnectorProviderId = 'nexora' | 'myntra' | 'amazon' | 'flipkart' | 'ajio';

export interface MarketplaceConnectorStatus {
  id: ConnectorProviderId;
  name: string;
  mode: 'internal_catalog' | 'external_api';
  configured: boolean;
  availability: 'ENABLED' | 'REQUIRES_CONFIGURATION';
  missingEnvVars: string[];
  capabilities: string[];
  notes: string;
}

export interface MarketplaceConnector {
  readonly id: ConnectorProviderId;
  readonly name: string;
  getStatus: () => MarketplaceConnectorStatus;
  searchCatalog: (params: {
    query?: string;
    category?: string;
    brand?: string;
    maxPriceCents?: number;
  }) => Promise<{ configured: boolean; items: Record<string, any>[]; reason?: string }>;
}

const NEXORA_CONNECTOR: MarketplaceConnector = {
  id: 'nexora',
  name: 'Nexora Exchange Catalog',
  getStatus: () => ({
    id: 'nexora',
    name: 'Nexora Exchange Catalog',
    mode: 'internal_catalog',
    configured: true,
    availability: 'ENABLED',
    missingEnvVars: [],
    capabilities: ['catalog_browse', 'fashion_filters', 'product_detail', 'merchant_dm'],
    notes: 'Active merchant-submitted catalog backed by Firestore.',
  }),
  searchCatalog: async () => ({
    configured: true,
    items: [],
  }),
};

function makeExternalConnector(def: {
  id: Exclude<ConnectorProviderId, 'nexora'>;
  name: string;
  envVars: string[];
  capabilities: string[];
  notes: string;
}): MarketplaceConnector {
  return {
    id: def.id,
    name: def.name,
    getStatus: () => {
      const missingEnvVars = def.envVars.filter((k) => !String(process.env[k] || '').trim());
      const configured = missingEnvVars.length === 0;
      return {
        id: def.id,
        name: def.name,
        mode: 'external_api',
        configured,
        availability: configured ? 'ENABLED' : 'REQUIRES_CONFIGURATION',
        missingEnvVars,
        capabilities: def.capabilities,
        notes: configured
          ? `${def.name} official API adapter configured.`
          : `${def.name} requires official API or affiliate credentials (${missingEnvVars.join(', ')}). Scraping is never used.`,
      };
    },
    searchCatalog: async () => {
      const missingEnvVars = def.envVars.filter((k) => !String(process.env[k] || '').trim());
      if (missingEnvVars.length > 0) {
        return {
          configured: false,
          items: [],
          reason: `${def.name} connector requires configuration (${missingEnvVars.join(', ')}).`,
        };
      }
      return {
        configured: true,
        items: [],
      };
    },
  };
}

export const MARKETPLACE_CONNECTORS: Record<ConnectorProviderId, MarketplaceConnector> = {
  nexora: NEXORA_CONNECTOR,
  myntra: makeExternalConnector({
    id: 'myntra',
    name: 'Myntra Partner Catalog',
    envVars: ['MYNTRA_API_KEY', 'MYNTRA_AFFILIATE_ID'],
    capabilities: ['fashion_feed', 'affiliate_deeplink'],
    notes: 'Official Myntra affiliate/partner feed integration.',
  }),
  amazon: makeExternalConnector({
    id: 'amazon',
    name: 'Amazon PA-API',
    envVars: ['AMAZON_PAAPI_ACCESS_KEY', 'AMAZON_PAAPI_SECRET_KEY', 'AMAZON_PARTNER_TAG'],
    capabilities: ['product_search', 'affiliate_deeplink', 'price_freshness'],
    notes: 'Official Amazon Product Advertising API 5.0.',
  }),
  flipkart: makeExternalConnector({
    id: 'flipkart',
    name: 'Flipkart Affiliate API',
    envVars: ['FLIPKART_AFFILIATE_ID', 'FLIPKART_AFFILIATE_TOKEN'],
    capabilities: ['fashion_feed', 'affiliate_deeplink'],
    notes: 'Official Flipkart Affiliate Product Feed API.',
  }),
  ajio: makeExternalConnector({
    id: 'ajio',
    name: 'AJIO Partner Catalog',
    envVars: ['AJIO_PARTNER_API_KEY'],
    capabilities: ['fashion_feed', 'affiliate_deeplink'],
    notes: 'Official AJIO partner integration.',
  }),
};

export function listConnectorStatuses(): MarketplaceConnectorStatus[] {
  return Object.values(MARKETPLACE_CONNECTORS).map((c) => c.getStatus());
}

export function validateOutboundOfferUrl(
  rawUrl: string,
  affiliateTag = ''
): { valid: boolean; targetUrl: string; reason?: string } {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, targetUrl: '', reason: 'Only HTTP/HTTPS merchant URLs are supported.' };
    }
    if (affiliateTag && !parsed.searchParams.has('ref')) {
      parsed.searchParams.set('ref', affiliateTag.slice(0, 64));
    }
    return { valid: true, targetUrl: parsed.toString() };
  } catch {
    return { valid: false, targetUrl: '', reason: 'Invalid merchant external URL.' };
  }
}

const outboundClickMetrics = new Map<string, { clicks: number; lastClickAtMs: number }>();

export function recordOutboundClickMetric(productId: string): { clicks: number; lastClickAtMs: number } {
  const prev = outboundClickMetrics.get(productId) || { clicks: 0, lastClickAtMs: 0 };
  const next = { clicks: prev.clicks + 1, lastClickAtMs: Date.now() };
  outboundClickMetrics.set(productId, next);
  return next;
}

export function getOutboundClickMetric(productId: string): { clicks: number; lastClickAtMs: number } {
  return outboundClickMetrics.get(productId) || { clicks: 0, lastClickAtMs: 0 };
}
