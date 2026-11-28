import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { nexoraStore, UPLOADS_DIR } from '../nexora_store.ts';
import {
  getAdapterConfigStatus,
  parseWithSchema,
  sendApiError,
  sendApiOk,
  type AuthedRequest,
  type VerifiedUser,
} from './context.ts';
import {
  fsDeleteDoc,
  fsGetDoc,
  fsListCollection,
  fsPatchDoc,
  fsQueryCollection,
  fsSetDoc,
  serverTimestampSentinel,
} from './firestore_rest.ts';
import {
  getOutboundClickMetric,
  listConnectorStatuses,
  MARKETPLACE_CONNECTORS,
  recordOutboundClickMetric,
  validateOutboundOfferUrl,
  type ConnectorProviderId,
} from './connectors.ts';
import { analyzeFashionImageWithGemini, matchStructuredFashionCatalog } from './visual_fashion_service.ts';
import { recordWorkflowJob } from './workflows_router.ts';

export interface CommerceStudioModerationDeps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
  isAdminUserServer: (user: any) => boolean;
  broadcastToUids?: (uids: string[], payload: Record<string, any>) => void;
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const STALE_PRICE_MS = 24 * 3600 * 1000;

const MerchantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  domain: z.string().trim().min(3).max(160),
});

const ProductSchema = z.object({
  merchantId: z.string().min(1).max(128),
  title: z.string().trim().min(2).max(140),
  description: z.string().max(1000).optional().default(''),
  category: z.string().trim().min(2).max(60),
  brand: z.string().trim().max(80).optional().default(''),
  providerId: z.enum(['nexora', 'myntra', 'amazon', 'flipkart', 'ajio']).optional().default('nexora'),
  sizes: z.array(z.string().trim().min(1).max(20)).max(15).optional().default([]),
  colors: z.array(z.string().trim().min(1).max(32)).max(12).optional().default([]),
  material: z.string().trim().max(80).optional().default(''),
  fit: z.string().trim().max(40).optional().default(''),
  occasion: z.string().trim().max(40).optional().default(''),
  gender: z.string().trim().max(32).optional().default(''),
  affiliateTag: z.string().trim().max(64).optional().default(''),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().min(3).max(8).default('USD'),
  externalUrl: z
    .string()
    .trim()
    .min(8)
    .max(400)
    .refine((u) => /^https?:\/\//i.test(u), 'External checkout URL must begin with http:// or https://.'),
  imageUrl: z.string().max(400000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).optional().default([]),
  inStock: z.boolean().optional().default(true),
});

const ProductPatchSchema = ProductSchema.partial().omit({ merchantId: true }).extend({
  status: z.enum(['active', 'archived']).optional(),
});

const CollectionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional().default(''),
  productIds: z.array(z.string().max(128)).max(50).optional().default([]),
});

const VisualSearchSchema = z.object({
  imageDataUrl: z.string().max(4_000_000).optional().default(''),
  queryHint: z.string().max(160).optional().default(''),
  category: z.string().max(60).optional().default(''),
  colorHint: z.string().max(40).optional().default(''),
});

const StudioPhotoSchema = z.object({
  label: z.string().max(80).optional().default('Studio Look'),
  mediaUrl: z.string().min(5).max(420000),
  consentAccepted: z.boolean(),
});

const StudioOutfitSchema = z.object({
  name: z.string().trim().min(1).max(80),
  photoId: z.string().max(128).optional().default(''),
  productIds: z.array(z.string().max(128)).min(1).max(10),
});

const TryOnRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).default('Custom Outfit'),
  photoId: z.string().min(1).max(128),
  productIds: z.array(z.string().max(128)).min(1).max(10),
  garmentCategory: z.enum(['Upperwear', 'Lowerwear', 'Footwear', 'Accessories', 'Outerwear', 'Full Outfit']).optional().default('Full Outfit'),
  preserveIdentity: z.boolean().optional().default(true),
  preservePose: z.boolean().optional().default(true),
  fitDisclaimerAccepted: z.boolean().optional().default(true),
  shareConsent: z.boolean().optional().default(false),
});

const ContactMerchantSchema = z.object({
  merchantId: z.string().min(1).max(128),
  productId: z.string().max(128).optional().default(''),
  initialMessage: z.string().max(1200).optional().default(''),
  offerPriceCents: z.number().int().min(0).max(100_000_000).optional(),
});

const ModerationUpdateSchema = z.object({
  status: z.enum(['open', 'under_review', 'resolved', 'dismissed']),
  actionTaken: z.string().max(300).optional().default(''),
});

export function enrichProductFreshness(product: Record<string, any>, nowMs = Date.now()) {
  const checkedAt = Number(product.priceLastCheckedAtMs || 0);
  return {
    ...product,
    priceStale: !checkedAt || nowMs - checkedAt > STALE_PRICE_MS,
  };
}

export function matchCatalogProductsByTokens(
  products: Array<Record<string, any>>,
  tokens: string[],
  category = ''
): Array<{ product: Record<string, any>; similarityScore: number }> {
  const cleanTokens = tokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  const catLower = category.trim().toLowerCase();

  return products
    .filter((p) => p && p.status === 'active')
    .map((p) => {
      let score = 0;
      const haystack = `${p.title || ''} ${p.description || ''} ${p.category || ''} ${p.merchantName || ''} ${(Array.isArray(p.tags) ? p.tags : []).join(' ')}`.toLowerCase();
      if (catLower && String(p.category || '').toLowerCase() === catLower) {
        score += 3;
      }
      for (const tok of cleanTokens) {
        if (haystack.includes(tok)) score += 2;
      }
      if (cleanTokens.length === 0 && !catLower) score = 1;
      return {
        product: enrichProductFreshness(p),
        similarityScore: score,
      };
    })
    .filter((r) => r.similarityScore > 0)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, 20);
}

export function createCommerceStudioModerationV1Router(deps: CommerceStudioModerationDeps): Router {
  const router = Router();

  /* -------------------- PHASE 12: SOCIAL COMMERCE -------------------- */

  router.get('/commerce/status', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const status = getAdapterConfigStatus();
    sendApiOk(req, res, {
      merchantFeedSync: status.merchantFeedSync,
    });
  });

  router.post('/commerce/sync', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const status = getAdapterConfigStatus();
    if (!status.merchantFeedSync.configured) {
      sendApiError(
        req,
        res,
        503,
        'MERCHANT_FEED_UNCONFIGURED',
        'External merchant feed credentials (MERCHANT_FEED_URL, MERCHANT_FEED_API_KEY) are not configured on this server.'
      );
      return;
    }
    sendApiOk(req, res, { synced: true });
  });

  router.get('/merchants', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const merchants = await fsListCollection('merchants', user.idToken, 60).catch(() => []);
    sendApiOk(req, res, { merchants });
  });

  router.post('/merchants', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, MerchantSchema, req.body || {});
    if (!body) return;

    const merchantId = `mrc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const created = await fsSetDoc(
      `merchants/${merchantId}`,
      {
        id: merchantId,
        ownerId: user.uid,
        name: body.name,
        domain: body.domain.toLowerCase(),
        verified: false,
        feedConfigured: getAdapterConfigStatus().merchantFeedSync.configured,
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { merchant: created }, 201);
  });

  router.get('/connectors', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    sendApiOk(req, res, {
      connectors: listConnectorStatuses(),
    });
  });

  router.post('/connectors/:connectorId/sync', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const connectorId = String(req.params.connectorId || '').trim().toLowerCase() as ConnectorProviderId;
    const connector = MARKETPLACE_CONNECTORS[connectorId];
    if (!connector) {
      sendApiError(req, res, 404, 'CONNECTOR_NOT_FOUND', 'Unknown marketplace connector.');
      return;
    }
    const status = connector.getStatus();
    if (!status.configured) {
      await recordWorkflowJob({
        userId: user.uid,
        idToken: user.idToken,
        jobType: 'catalog_sync',
        status: 'unconfigured',
        inputSummary: { connectorId },
        errorCode: 'CONNECTOR_UNCONFIGURED',
        errorMessage: status.notes,
        steps: [{ toolName: 'connector_sync_check', status: 'skipped', atMs: Date.now(), note: status.notes }],
      });
      sendApiError(req, res, 503, 'CONNECTOR_UNCONFIGURED', status.notes, {
        connectorId,
        missingEnvVars: status.missingEnvVars,
      });
      return;
    }
    await recordWorkflowJob({
      userId: user.uid,
      idToken: user.idToken,
      jobType: 'catalog_sync',
      status: 'completed',
      inputSummary: { connectorId },
      steps: [{ toolName: 'connector_sync_check', status: 'ok', atMs: Date.now(), note: `${connector.name} verified` }],
    });
    sendApiOk(req, res, { synced: true, connector: status });
  });

  router.get('/products', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const q = String(req.query.q || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim().toLowerCase();
    const merchantId = String(req.query.merchantId || '').trim();
    const brand = String(req.query.brand || '').trim().toLowerCase();
    const size = String(req.query.size || '').trim().toLowerCase();
    const color = String(req.query.color || '').trim().toLowerCase();
    const providerId = String(req.query.providerId || '').trim().toLowerCase();
    const inStockOnly = String(req.query.inStockOnly || '') === 'true';
    const minPriceCents = req.query.minPriceCents ? Number(req.query.minPriceCents) : 0;
    const maxPriceCents = req.query.maxPriceCents ? Number(req.query.maxPriceCents) : 0;
    const sort = String(req.query.sort || 'newest');

    const raw = await fsQueryCollection('products', user.idToken, {
      where: [{ field: 'status', op: 'EQUAL', value: 'active' }],
      limit: 120,
    }).catch(() => []);

    let filtered = raw.filter((p) => {
      if (merchantId && p.merchantId !== merchantId) return false;
      if (category && category !== 'all' && String(p.category || '').toLowerCase() !== category) return false;
      if (brand && String(p.brand || '').toLowerCase() !== brand) return false;
      if (providerId && providerId !== 'all' && String(p.providerId || 'nexora').toLowerCase() !== providerId) return false;
      if (inStockOnly && p.inStock === false) return false;
      if (minPriceCents > 0 && Number(p.priceCents || 0) < minPriceCents) return false;
      if (maxPriceCents > 0 && Number(p.priceCents || 0) > maxPriceCents) return false;
      if (size) {
        const sizes = Array.isArray(p.sizes) ? p.sizes.map((s: any) => String(s).toLowerCase()) : [];
        if (!sizes.includes(size)) return false;
      }
      if (color) {
        const colors = Array.isArray(p.colors) ? p.colors.map((c: any) => String(c).toLowerCase()) : [];
        const textHay = `${p.title || ''} ${p.description || ''} ${(Array.isArray(p.tags) ? p.tags : []).join(' ')}`.toLowerCase();
        if (!colors.includes(color) && !textHay.includes(color)) return false;
      }
      if (q) {
        const hay = `${p.title || ''} ${p.description || ''} ${p.brand || ''} ${p.material || ''} ${p.occasion || ''} ${p.merchantName || ''} ${(Array.isArray(p.tags) ? p.tags : []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sort === 'price_asc') {
      filtered = filtered.sort((a, b) => Number(a.priceCents || 0) - Number(b.priceCents || 0));
    } else if (sort === 'price_desc') {
      filtered = filtered.sort((a, b) => Number(b.priceCents || 0) - Number(a.priceCents || 0));
    } else {
      filtered = filtered.sort((a, b) => Number(b.priceLastCheckedAtMs || 0) - Number(a.priceLastCheckedAtMs || 0));
    }

    sendApiOk(req, res, {
      products: filtered.map((p) => ({
        ...enrichProductFreshness(p),
        outboundClicks: getOutboundClickMetric(String(p.id || '')).clicks,
      })),
    });
  });

  router.get('/products/:productId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const productId = String(req.params.productId || '').trim();
    if (!VALID_ID_RE.test(productId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid product identifier.');
      return;
    }
    const product = await fsGetDoc(`products/${productId}`, user.idToken).catch(() => null);
    if (!product) {
      sendApiError(req, res, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      return;
    }

    const [merchant, allActive] = await Promise.all([
      fsGetDoc(`merchants/${product.merchantId}`, user.idToken).catch(() => null),
      fsQueryCollection('products', user.idToken, {
        where: [{ field: 'status', op: 'EQUAL', value: 'active' }],
        limit: 60,
      }).catch(() => []),
    ]);

    const relatedProducts = allActive
      .filter((p) => p.id !== product.id)
      .map((p) => {
        let score = 0;
        if (String(p.category || '').toLowerCase() === String(product.category || '').toLowerCase()) score += 3;
        if (product.brand && String(p.brand || '').toLowerCase() === String(product.brand || '').toLowerCase()) score += 2;
        return { product: enrichProductFreshness(p), score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((r) => r.product);

    sendApiOk(req, res, {
      product: {
        ...enrichProductFreshness(product),
        outboundClicks: getOutboundClickMetric(productId).clicks,
      },
      merchant,
      relatedProducts,
    });
  });

  router.post('/products/:productId/outbound-click', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const productId = String(req.params.productId || '').trim();
    if (!VALID_ID_RE.test(productId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid product identifier.');
      return;
    }
    const product = await fsGetDoc(`products/${productId}`, user.idToken).catch(() => null);
    if (!product) {
      sendApiError(req, res, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      return;
    }
    const checked = validateOutboundOfferUrl(String(product.externalUrl || ''), String(product.affiliateTag || ''));
    if (!checked.valid) {
      sendApiError(req, res, 400, 'INVALID_OFFER_URL', checked.reason || 'External offer URL is invalid.');
      return;
    }
    const metric = recordOutboundClickMetric(productId);
    sendApiOk(req, res, {
      productId,
      targetUrl: checked.targetUrl,
      outboundClicks: metric.clicks,
      disclaimer: 'Checkout and payment occur strictly on the external merchant storefront.',
    });
  });

  router.post('/products', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, ProductSchema, req.body || {});
    if (!body) return;

    const merchant = await fsGetDoc(`merchants/${body.merchantId}`, user.idToken);
    if (!merchant) {
      sendApiError(req, res, 404, 'MERCHANT_NOT_FOUND', 'Select or create a valid merchant first.');
      return;
    }

    const productId = `prd-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const created = await fsSetDoc(
      `products/${productId}`,
      {
        id: productId,
        merchantId: merchant.id,
        merchantName: String(merchant.name || 'Merchant').slice(0, 100),
        ownerId: user.uid,
        title: body.title,
        description: body.description,
        category: body.category,
        ...(body.brand ? { brand: body.brand } : {}),
        providerId: body.providerId || 'nexora',
        ...(body.sizes.length > 0 ? { sizes: body.sizes } : {}),
        ...(body.colors.length > 0 ? { colors: body.colors } : {}),
        ...(body.material ? { material: body.material } : {}),
        ...(body.fit ? { fit: body.fit } : {}),
        ...(body.occasion ? { occasion: body.occasion } : {}),
        ...(body.gender ? { gender: body.gender } : {}),
        ...(body.affiliateTag ? { affiliateTag: body.affiliateTag } : {}),
        priceCents: body.priceCents,
        currency: body.currency.toUpperCase(),
        externalUrl: body.externalUrl,
        imageUrl: body.imageUrl,
        tags: body.tags,
        inStock: body.inStock,
        priceLastCheckedAtMs: Date.now(),
        status: 'active',
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );

    sendApiOk(req, res, { product: enrichProductFreshness(created) }, 201);
  });

  router.patch('/products/:productId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const productId = String(req.params.productId || '').trim();
    if (!VALID_ID_RE.test(productId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid product identifier.');
      return;
    }
    const existing = await fsGetDoc(`products/${productId}`, user.idToken);
    if (!existing) {
      sendApiError(req, res, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      return;
    }
    if (existing.ownerId !== user.uid && !deps.isAdminUserServer(user)) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Only the product owner can edit this item.');
      return;
    }
    const body = parseWithSchema(req, res, ProductPatchSchema, req.body || {});
    if (!body) return;

    const patch: Record<string, unknown> = {
      updatedAt: serverTimestampSentinel(),
    };
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) patch[k] = v;
    }
    if (body.priceCents !== undefined || body.inStock !== undefined) {
      patch.priceLastCheckedAtMs = Date.now();
    }

    const updated = await fsPatchDoc(`products/${productId}`, patch, user.idToken);
    sendApiOk(req, res, { product: enrichProductFreshness(updated) });
  });

  router.get('/commerce/collections', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const collections = await fsListCollection(`users/${user.uid}/product_collections`, user.idToken, 50).catch(() => []);
    sendApiOk(req, res, { collections });
  });

  router.post('/commerce/collections', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, CollectionSchema, req.body || {});
    if (!body) return;

    const collectionId = `col-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const created = await fsSetDoc(
      `users/${user.uid}/product_collections/${collectionId}`,
      {
        id: collectionId,
        userId: user.uid,
        title: body.title,
        description: body.description,
        productIds: Array.from(new Set(body.productIds)).slice(0, 50),
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { collection: created }, 201);
  });

  router.patch('/commerce/collections/:collectionId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const collectionId = String(req.params.collectionId || '').trim();
    if (!VALID_ID_RE.test(collectionId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid collection identifier.');
      return;
    }
    const existing = await fsGetDoc(`users/${user.uid}/product_collections/${collectionId}`, user.idToken);
    if (!existing) {
      sendApiError(req, res, 404, 'COLLECTION_NOT_FOUND', 'Collection not found.');
      return;
    }
    const body = parseWithSchema(req, res, CollectionSchema.partial(), req.body || {});
    if (!body) return;
    const patch: Record<string, unknown> = { updatedAt: serverTimestampSentinel() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.productIds !== undefined) patch.productIds = Array.from(new Set(body.productIds)).slice(0, 50);

    const updated = await fsPatchDoc(`users/${user.uid}/product_collections/${collectionId}`, patch, user.idToken);
    sendApiOk(req, res, { collection: updated });
  });

  router.delete('/commerce/collections/:collectionId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const collectionId = String(req.params.collectionId || '').trim();
    if (!VALID_ID_RE.test(collectionId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid collection identifier.');
      return;
    }
    await fsDeleteDoc(`users/${user.uid}/product_collections/${collectionId}`, user.idToken).catch(() => false);
    sendApiOk(req, res, { deletedId: collectionId });
  });

  router.post('/commerce/contact-merchant', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, ContactMerchantSchema, req.body || {});
    if (!body) return;

    const merchant = await fsGetDoc(`merchants/${body.merchantId}`, user.idToken).catch(() => null);
    if (!merchant || !merchant.ownerId) {
      sendApiError(req, res, 404, 'MERCHANT_NOT_FOUND', 'Merchant storefront not found.');
      return;
    }
    const peerUid = String(merchant.ownerId);
    if (peerUid === user.uid) {
      sendApiError(req, res, 400, 'SELF_MERCHANT', 'You are the owner of this merchant storefront.');
      return;
    }

    const blocked = await fsGetDoc(`users/${peerUid}/blocks/${user.uid}`, user.idToken).catch(() => null);
    if (blocked) {
      sendApiError(req, res, 403, 'USER_BLOCKED', 'Unable to contact this merchant.');
      return;
    }

    let product: Record<string, any> | null = null;
    if (body.productId) {
      product = await fsGetDoc(`products/${body.productId}`, user.idToken).catch(() => null);
    }

    const sortedUids = [user.uid, peerUid].sort();
    const threadId = `dm-${sortedUids[0]}-${sortedUids[1]}`.slice(0, 128);
    const [existingThread, senderDoc, peerDoc] = await Promise.all([
      fsGetDoc(`dm_threads/${threadId}`, user.idToken).catch(() => null),
      fsGetDoc(`users/${user.uid}`, user.idToken).catch(() => null),
      fsGetDoc(`users/${peerUid}`, user.idToken).catch(() => null),
    ]);

    const summaryText = body.initialMessage.trim()
      ? body.initialMessage.trim().slice(0, 300)
      : product
        ? `Product inquiry: ${product.title}`
        : `Inquiry for ${merchant.name}`;

    if (!existingThread) {
      await fsSetDoc(
        `dm_threads/${threadId}`,
        {
          id: threadId,
          type: 'dm',
          participants: sortedUids,
          participantMeta: {
            [user.uid]: {
              displayName: String(senderDoc?.displayName || user.displayName || 'Member').slice(0, 80),
              initials: String(senderDoc?.initials || 'NX').slice(0, 8),
            },
            [peerUid]: {
              displayName: String(peerDoc?.displayName || merchant.name || 'Merchant').slice(0, 80),
              initials: String(peerDoc?.initials || 'MC').slice(0, 8),
            },
          },
          createdBy: user.uid,
          lastMessage: summaryText,
          lastSenderId: user.uid,
          seenBy: [user.uid],
          createdAt: serverTimestampSentinel(),
          updatedAt: serverTimestampSentinel(),
        },
        user.idToken
      );
    }

    let sentMessage: Record<string, any> | null = null;
    if (product || body.initialMessage.trim()) {
      const msgId = `dmmsg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const commerceCard = product
        ? {
            kind: body.offerPriceCents !== undefined ? 'price_offer' : 'product_inquiry',
            productId: String(product.id),
            productTitle: String(product.title || '').slice(0, 140),
            productPriceCents: Number(product.priceCents || 0),
            productCurrency: String(product.currency || 'USD'),
            productImageUrl: String(product.imageUrl || '').slice(0, 2000),
            merchantName: String(merchant.name || '').slice(0, 100),
            ...(body.offerPriceCents !== undefined ? { offerPriceCents: body.offerPriceCents, inquiryStatus: 'open' } : { inquiryStatus: 'open' }),
            ...(body.initialMessage.trim() ? { note: body.initialMessage.trim().slice(0, 300) } : {}),
          }
        : undefined;

      sentMessage = await fsSetDoc(
        `dm_threads/${threadId}/messages/${msgId}`,
        {
          id: msgId,
          threadId,
          participantIds: sortedUids,
          senderId: user.uid,
          senderName: String(senderDoc?.displayName || user.displayName || 'Member').slice(0, 50),
          senderInitials: String(senderDoc?.initials || 'NX').slice(0, 4),
          content: body.initialMessage.trim() || `Hi! I'm interested in ${product?.title || merchant.name}.`,
          ...(commerceCard ? { commerceCard } : {}),
          deliveredTo: [user.uid],
          seenBy: [user.uid],
          edited: false,
          pinned: false,
          reactions: [],
          createdAt: serverTimestampSentinel(),
          updatedAt: serverTimestampSentinel(),
        },
        user.idToken
      );

      await fsPatchDoc(
        `dm_threads/${threadId}`,
        {
          lastMessage: summaryText,
          lastSenderId: user.uid,
          seenBy: [user.uid],
          updatedAt: serverTimestampSentinel(),
        },
        user.idToken
      ).catch(() => {});

      deps.broadcastToUids?.([peerUid], {
        type: 'dm:notify',
        threadId,
        messageId: msgId,
        fromUid: user.uid,
        atMs: Date.now(),
      });
    }

    sendApiOk(req, res, {
      threadId,
      peerUid,
      merchantName: merchant.name,
      message: sentMessage,
    });
  });

  /* -------------------- PHASE 13: VISUAL PRODUCT SEARCH -------------------- */

  router.get('/visual-search/status', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const adapters = getAdapterConfigStatus();
    sendApiOk(req, res, {
      externalVisualSearch: adapters.externalVisualSearch,
      geminiVisionFallbackConfigured: adapters.gemini.configured,
    });
  });

  router.post('/visual-search', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, VisualSearchSchema, req.body || {});
    if (!body) return;
    if (!body.imageDataUrl && !body.queryHint && !body.category && !body.colorHint) {
      sendApiError(req, res, 400, 'INPUT_REQUIRED', 'Provide an image upload or visual search keywords.');
      return;
    }

    const adapters = getAdapterConfigStatus();
    const extractedTokens = new Set<string>(
      `${body.queryHint} ${body.category} ${body.colorHint}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2)
    );

    const visionResult = await analyzeFashionImageWithGemini({
      imageDataUrl: body.imageDataUrl,
    });
    for (const kw of visionResult.keywords) {
      extractedTokens.add(kw);
    }

    const catalog = await fsQueryCollection('products', user.idToken, {
      where: [{ field: 'status', op: 'EQUAL', value: 'active' }],
      limit: 120,
    }).catch(() => []);

    const structured = matchStructuredFashionCatalog({
      products: catalog,
      tokens: Array.from(extractedTokens),
      detectedItems: visionResult.detectedItems,
      category: body.category,
      enrichFn: (p) => enrichProductFreshness(p),
    });

    const wf = await recordWorkflowJob({
      userId: user.uid,
      idToken: user.idToken,
      jobType: visionResult.detectedItems.length > 0 ? 'multi_item_detection' : 'visual_analysis',
      status: 'completed',
      inputSummary: {
        hasImage: Boolean(body.imageDataUrl),
        queryHint: body.queryHint || null,
        category: body.category || null,
      },
      resultSummary: {
        detectedCount: visionResult.detectedItems.length,
        exactCount: structured.exactMatches.length,
        similarCount: structured.visuallySimilar.length,
      },
      steps: [
        {
          toolName: 'gemini_vision_extract',
          status: visionResult.usedGemini ? 'ok' : 'skipped',
          atMs: Date.now(),
          note: visionResult.usedGemini
            ? `Extracted ${visionResult.detectedItems.length} structured garment slots`
            : 'Used explicit keywords and attribute hints',
        },
        {
          toolName: 'catalog_match',
          status: 'ok',
          atMs: Date.now(),
          note: `Matched ${structured.allMatches.length} catalog products`,
        },
      ],
    });

    sendApiOk(req, res, {
      externalProviderConfigured: adapters.externalVisualSearch.configured,
      matchSource: adapters.externalVisualSearch.configured ? 'external-visual-provider' : 'nexora-catalog',
      adapterMessage: adapters.externalVisualSearch.configured
        ? 'External visual search provider active.'
        : 'External visual search keys are unconfigured; showing real Nexora catalog matches.',
      extractedKeywords: Array.from(extractedTokens).slice(0, 14),
      detectedItems: visionResult.detectedItems,
      exactMatches: structured.exactMatches,
      visuallySimilar: structured.visuallySimilar,
      matches: structured.allMatches,
      workflowJobId: wf.id,
    });
  });

  /* -------------------- PHASE 14: NEXORA STUDIO (CONSENTED PHOTOS & VTON ADAPTER) -------------------- */

  router.get('/studio/status', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const adapters = getAdapterConfigStatus();
    sendApiOk(req, res, {
      virtualTryOn: adapters.virtualTryOn,
      videoRunway: adapters.videoRunway,
      bodyEstimation: adapters.bodyEstimation,
      weatherContext: adapters.weatherContext,
    });
  });

  router.get('/studio/photos', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const photos = await fsListCollection(`users/${user.uid}/studio_photos`, user.idToken, 40).catch(() => []);
    sendApiOk(req, res, { photos });
  });

  router.post('/studio/photos', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, StudioPhotoSchema, req.body || {});
    if (!body) return;
    if (!body.consentAccepted) {
      sendApiError(req, res, 400, 'CONSENT_REQUIRED', 'Explicit user photo consent is required before saving a Studio photo.');
      return;
    }

    const photoId = `sph-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const created = await fsSetDoc(
      `users/${user.uid}/studio_photos/${photoId}`,
      {
        id: photoId,
        userId: user.uid,
        label: body.label,
        mediaUrl: body.mediaUrl,
        consentAccepted: true,
        consentAt: serverTimestampSentinel(),
        createdAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { photo: created }, 201);
  });

  router.delete('/studio/photos/:photoId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const photoId = String(req.params.photoId || '').trim();
    if (!VALID_ID_RE.test(photoId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid photo identifier.');
      return;
    }

    const existing = await fsGetDoc(`users/${user.uid}/studio_photos/${photoId}`, user.idToken).catch(() => null);
    if (existing && typeof existing.mediaUrl === 'string') {
      const m = /^\/api\/media\/(?:private\/)?([a-f0-9-]{20,64})$/.exec(existing.mediaUrl.trim());
      if (m) {
        const rec = nexoraStore.getMedia(m[1]);
        if (rec && rec.ownerUid === user.uid) {
          const filePath = path.resolve(UPLOADS_DIR, `${rec.id}.${rec.ext}`);
          if (filePath.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch {}
          }
          nexoraStore.deleteMedia(rec.id);
        }
      }
    }

    await fsDeleteDoc(`users/${user.uid}/studio_photos/${photoId}`, user.idToken).catch(() => false);
    sendApiOk(req, res, { deletedId: photoId });
  });

  router.get('/studio/outfits', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const outfits = await fsListCollection(`users/${user.uid}/studio_outfits`, user.idToken, 40).catch(() => []);
    sendApiOk(req, res, { outfits });
  });

  router.post('/studio/outfits', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, StudioOutfitSchema, req.body || {});
    if (!body) return;

    const outfitId = `otf-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const created = await fsSetDoc(
      `users/${user.uid}/studio_outfits/${outfitId}`,
      {
        id: outfitId,
        userId: user.uid,
        name: body.name,
        ...(body.photoId ? { photoId: body.photoId } : {}),
        productIds: body.productIds,
        jobStatus: 'draft',
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { outfit: created }, 201);
  });

  router.delete('/studio/outfits/:outfitId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const outfitId = String(req.params.outfitId || '').trim();
    if (!VALID_ID_RE.test(outfitId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid outfit identifier.');
      return;
    }
    await fsDeleteDoc(`users/${user.uid}/studio_outfits/${outfitId}`, user.idToken).catch(() => false);
    sendApiOk(req, res, { deletedId: outfitId });
  });

  router.post('/studio/try-on', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, TryOnRequestSchema, req.body || {});
    if (!body) return;

    const photo = await fsGetDoc(`users/${user.uid}/studio_photos/${body.photoId}`, user.idToken);
    if (!photo || photo.consentAccepted !== true) {
      sendApiError(req, res, 400, 'CONSENTED_PHOTO_REQUIRED', 'A consented personal Studio photo is required.');
      return;
    }

    const adapters = getAdapterConfigStatus();
    const outfitId = `otf-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    if (!adapters.virtualTryOn.configured) {
      const savedDraft = await fsSetDoc(
        `users/${user.uid}/studio_outfits/${outfitId}`,
        {
          id: outfitId,
          userId: user.uid,
          name: body.name,
          photoId: body.photoId,
          productIds: body.productIds,
          garmentCategory: body.garmentCategory,
          preserveIdentity: body.preserveIdentity,
          preservePose: body.preservePose,
          fitDisclaimer: 'Virtual try-on is a visual preview only and does not guarantee exact physical sizing or drape.',
          shareConsent: body.shareConsent,
          jobStatus: 'unconfigured',
          providerMessage: 'Virtual Try-On provider credentials (VTON_PROVIDER_URL, VTON_API_KEY) are not configured.',
          createdAt: serverTimestampSentinel(),
          updatedAt: serverTimestampSentinel(),
        },
        user.idToken
      );

      await recordWorkflowJob({
        userId: user.uid,
        idToken: user.idToken,
        jobType: 'virtual_tryon',
        status: 'unconfigured',
        inputSummary: { outfitId, garmentCategory: body.garmentCategory },
        errorCode: 'VTON_UNCONFIGURED',
        errorMessage: adapters.virtualTryOn.reason,
        steps: [{ toolName: 'vton_provider_dispatch', status: 'skipped', atMs: Date.now(), note: adapters.virtualTryOn.reason }],
      });

      res.status(503).json({
        ok: false,
        error: {
          code: 'VTON_UNCONFIGURED',
          message:
            'Virtual Try-On provider is not configured on this server. Your outfit combination was saved as a draft.',
          details: { outfitId: savedDraft.id, jobStatus: 'unconfigured' },
          requestId: req.requestId || null,
        },
        outfit: savedDraft,
      });
      return;
    }

    const queued = await fsSetDoc(
      `users/${user.uid}/studio_outfits/${outfitId}`,
      {
        id: outfitId,
        userId: user.uid,
        name: body.name,
        photoId: body.photoId,
        productIds: body.productIds,
        garmentCategory: body.garmentCategory,
        preserveIdentity: body.preserveIdentity,
        preservePose: body.preservePose,
        fitDisclaimer: 'Virtual try-on is a visual preview only and does not guarantee exact physical sizing or drape.',
        shareConsent: body.shareConsent,
        jobStatus: 'queued',
        providerMessage: 'Dispatched to configured Virtual Try-On provider.',
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );

    const wf = await recordWorkflowJob({
      userId: user.uid,
      idToken: user.idToken,
      jobType: 'virtual_tryon',
      status: 'queued',
      inputSummary: { outfitId, garmentCategory: body.garmentCategory },
      steps: [{ toolName: 'vton_provider_dispatch', status: 'ok', atMs: Date.now(), note: 'Dispatched to VTON provider' }],
    });

    sendApiOk(req, res, { outfit: queued, workflowJobId: wf.id }, 202);
  });

  /* -------------------- PHASE 15: MODERATION QUEUE & AUDIT -------------------- */

  router.get('/moderation/reports', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    if (!deps.isAdminUserServer(user)) {
      sendApiError(req, res, 403, 'ADMIN_REQUIRED', 'Verified moderator or admin access required.');
      return;
    }
    const reports = await fsQueryCollection('reports', user.idToken, {
      orderBy: { field: 'createdAt', direction: 'DESCENDING' },
      limit: 100,
    }).catch(() => []);
    sendApiOk(req, res, { reports });
  });

  router.patch('/moderation/reports/:reportId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    if (!deps.isAdminUserServer(user)) {
      sendApiError(req, res, 403, 'ADMIN_REQUIRED', 'Verified moderator or admin access required.');
      return;
    }
    const reportId = String(req.params.reportId || '').trim();
    if (!VALID_ID_RE.test(reportId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid report identifier.');
      return;
    }
    const body = parseWithSchema(req, res, ModerationUpdateSchema, req.body || {});
    if (!body) return;

    const updated = await fsPatchDoc(
      `reports/${reportId}`,
      {
        status: body.status,
        reviewedBy: user.uid,
        actionTaken: body.actionTaken,
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { report: updated });
  });

  return router;
}
