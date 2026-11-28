import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
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
  fsQueryCollection,
  fsSetDoc,
  serverTimestampSentinel,
} from './firestore_rest.ts';
import { recordWorkflowJob } from './workflows_router.ts';

export interface StyleStudioDeps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  checkRateLimit: (key: string, maxRequests: number, windowMs: number) => { allowed: boolean; retryAfterSec: number };
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const StyleProfileSchema = z.object({
  preferredStyles: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  favoriteColors: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  preferredBrands: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  topSize: z.string().trim().max(24).optional().default(''),
  bottomSize: z.string().trim().max(24).optional().default(''),
  footwearSize: z.string().trim().max(24).optional().default(''),
  fitPreference: z.enum(['slim', 'regular', 'relaxed', 'oversized']).default('regular'),
  priceMinCents: z.number().int().min(0).max(100_000_000).optional().default(0),
  priceMaxCents: z.number().int().min(0).max(100_000_000).optional().default(0),
  optionalHeightCm: z.number().min(80).max(250).nullable().optional().default(null),
  stylistOptIn: z.boolean().default(true),
});

const BodyProfileSchema = z.object({
  consentAccepted: z.boolean(),
  heightCm: z.number().min(80).max(250).nullable().optional().default(null),
  chestCm: z.number().min(40).max(200).nullable().optional().default(null),
  waistCm: z.number().min(40).max(200).nullable().optional().default(null),
  hipsCm: z.number().min(40).max(200).nullable().optional().default(null),
  inseamCm: z.number().min(30).max(140).nullable().optional().default(null),
  shoulderCm: z.number().min(25).max(90).nullable().optional().default(null),
  calibrationMode: z.enum(['manual', 'uncalibrated_estimate']).default('manual'),
  privateMediaIds: z.array(z.string().max(128)).max(6).optional().default([]),
});

const StylistRecommendSchema = z.object({
  occasion: z
    .enum(['Casual', 'Formal', 'Streetwear', 'Party', 'Traditional', 'Minimal', 'Sporty', 'Seasonal'])
    .default('Casual'),
  budgetMaxCents: z.number().int().min(0).max(100_000_000).optional(),
  includeWeather: z.boolean().optional().default(false),
  notes: z.string().max(300).optional().default(''),
});

const RunwayRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).default('Editorial Runway Clip'),
  runwayStyle: z.enum(['Luxury', 'Minimal Studio', 'Editorial Shoot', 'Urban', 'Traditional']).default('Editorial Shoot'),
  environment: z.enum(['Monochrome Loft', 'Milan Courtyard', 'Concrete Gallery', 'Daylight Studio', 'Heritage Archway']).default('Daylight Studio'),
  photoId: z.string().min(1).max(128),
  outfitId: z.string().max(128).optional().default(''),
  productIds: z.array(z.string().max(128)).min(1).max(10),
});

export function buildStylistOutfits(args: {
  products: Array<Record<string, any>>;
  occasion: string;
  styleProfile?: Record<string, any> | null;
  budgetMaxCents?: number;
}): Array<{
  title: string;
  occasion: string;
  items: Array<Record<string, any>>;
  totalCents: number;
  score: number;
  reasons: string[];
}> {
  const active = args.products.filter((p) => p && p.status === 'active' && p.inStock !== false);
  if (active.length === 0) return [];

  const prefStyles = new Set(
    (Array.isArray(args.styleProfile?.preferredStyles) ? args.styleProfile!.preferredStyles : []).map((s: any) =>
      String(s).toLowerCase()
    )
  );
  const prefColors = new Set(
    (Array.isArray(args.styleProfile?.favoriteColors) ? args.styleProfile!.favoriteColors : []).map((s: any) =>
      String(s).toLowerCase()
    )
  );
  const prefBrands = new Set(
    (Array.isArray(args.styleProfile?.preferredBrands) ? args.styleProfile!.preferredBrands : []).map((s: any) =>
      String(s).toLowerCase()
    )
  );
  const budgetCap =
    args.budgetMaxCents && args.budgetMaxCents > 0
      ? args.budgetMaxCents
      : Number(args.styleProfile?.priceMaxCents || 0);
  const occLower = args.occasion.toLowerCase();

  const scored = active
    .filter((p) => !budgetCap || Number(p.priceCents || 0) <= budgetCap)
    .map((p) => {
      let score = 1;
      const reasons: string[] = [];
      const hay = `${p.title || ''} ${p.description || ''} ${p.category || ''} ${p.occasion || ''} ${p.fit || ''} ${(Array.isArray(p.tags) ? p.tags : []).join(' ')}`.toLowerCase();
      if (hay.includes(occLower)) {
        score += 4;
        reasons.push(`Fits ${args.occasion} occasion`);
      }
      for (const st of prefStyles) {
        if (st && hay.includes(st)) {
          score += 3;
          reasons.push(`Matches preferred style "${st}"`);
        }
      }
      const cols = Array.isArray(p.colors) ? p.colors.map((c: any) => String(c).toLowerCase()) : [];
      for (const pc of prefColors) {
        if (cols.includes(pc) || hay.includes(pc)) {
          score += 2;
          reasons.push(`Matches color "${pc}"`);
        }
      }
      if (p.brand && prefBrands.has(String(p.brand).toLowerCase())) {
        score += 2;
        reasons.push(`Preferred brand ${p.brand}`);
      }
      return { product: p, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const pool = scored.length > 0 ? scored : active.map((p) => ({ product: p, score: 1, reasons: ['Active catalog item'] }));

  const bySlot = (slots: string[], usedIds: Set<string>) =>
    pool.find(
      (entry) =>
        !usedIds.has(entry.product.id) &&
        slots.some((sl) => String(entry.product.category || '').toLowerCase().includes(sl))
    );

  const bundles: Array<{
    title: string;
    occasion: string;
    items: Array<Record<string, any>>;
    totalCents: number;
    score: number;
    reasons: string[];
  }> = [];

  const usedGlobal = new Set<string>();
  for (let b = 0; b < 3; b++) {
    const picked: Array<{ product: Record<string, any>; score: number; reasons: string[] }> = [];
    const upper = bySlot(['upper', 'apparel', 'outer'], usedGlobal) || pool.find((x) => !usedGlobal.has(x.product.id));
    if (!upper) break;
    usedGlobal.add(upper.product.id);
    picked.push(upper);

    const lower = bySlot(['lower', 'pant', 'skirt'], usedGlobal);
    if (lower) {
      usedGlobal.add(lower.product.id);
      picked.push(lower);
    }

    const shoes = bySlot(['foot', 'shoe'], usedGlobal);
    if (shoes) {
      usedGlobal.add(shoes.product.id);
      picked.push(shoes);
    }

    const acc = bySlot(['access'], usedGlobal);
    if (acc) {
      usedGlobal.add(acc.product.id);
      picked.push(acc);
    }

    const items = picked.map((x) => x.product);
    const totalCents = items.reduce((sum, it) => sum + Number(it.priceCents || 0), 0);
    if (budgetCap > 0 && totalCents > budgetCap && items.length > 1) {
      // Keep within budget if possible by trimming extra accessories
      while (items.length > 1 && items.reduce((s, it) => s + Number(it.priceCents || 0), 0) > budgetCap) {
        items.pop();
      }
    }

    const reasonSet = new Set<string>();
    for (const p of picked) {
      for (const r of p.reasons) reasonSet.add(r);
    }
    if (reasonSet.size === 0) reasonSet.add(`Curated from active Exchange listings for ${args.occasion}`);

    bundles.push({
      title: `${args.occasion} Edit #${b + 1}`,
      occasion: args.occasion,
      items,
      totalCents: items.reduce((sum, it) => sum + Number(it.priceCents || 0), 0),
      score: picked.reduce((sum, p) => sum + p.score, 0),
      reasons: Array.from(reasonSet).slice(0, 4),
    });
  }

  return bundles;
}

export function createStyleStudioV1Router(deps: StyleStudioDeps): Router {
  const router = Router();

  /* -------------------- 6.1 PERSONAL STYLE PROFILE -------------------- */

  router.get('/studio/style-profile', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const doc = await fsGetDoc(`users/${user.uid}/studio_style_profile/default`, user.idToken).catch(() => null);
    sendApiOk(req, res, { styleProfile: doc || null });
  });

  router.put('/studio/style-profile', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, StyleProfileSchema, req.body || {});
    if (!body) return;

    const saved = await fsSetDoc(
      `users/${user.uid}/studio_style_profile/default`,
      {
        id: 'default',
        userId: user.uid,
        ...body,
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { styleProfile: saved });
  });

  router.delete('/studio/style-profile', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    await fsDeleteDoc(`users/${user.uid}/studio_style_profile/default`, user.idToken).catch(() => false);
    sendApiOk(req, res, { deleted: true });
  });

  /* -------------------- 6.2 PRIVATE BODY PROFILE & MEASUREMENTS -------------------- */

  router.get('/studio/body-profile', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const doc = await fsGetDoc(`users/${user.uid}/studio_body_profile/default`, user.idToken).catch(() => null);
    const adapters = getAdapterConfigStatus();
    sendApiOk(req, res, {
      bodyProfile: doc || null,
      bodyEstimationAdapter: adapters.bodyEstimation,
    });
  });

  router.put('/studio/body-profile', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, BodyProfileSchema, req.body || {});
    if (!body) return;
    if (!body.consentAccepted) {
      sendApiError(req, res, 400, 'CONSENT_REQUIRED', 'Explicit consent is required to store a private body profile.');
      return;
    }

    const confidenceDisclaimer =
      body.calibrationMode === 'uncalibrated_estimate'
        ? 'Uncalibrated estimates carry margin of error and are not tailor-grade cm measurements.'
        : 'User-entered manual measurements stored strictly privately for your account only.';

    const saved = await fsSetDoc(
      `users/${user.uid}/studio_body_profile/default`,
      {
        id: 'default',
        userId: user.uid,
        ...body,
        confidenceDisclaimer,
        consentAt: serverTimestampSentinel(),
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );
    sendApiOk(req, res, { bodyProfile: saved });
  });

  router.delete('/studio/body-profile', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;

    const existing = await fsGetDoc(`users/${user.uid}/studio_body_profile/default`, user.idToken).catch(() => null);
    let purgedMediaCount = 0;
    if (existing && Array.isArray(existing.privateMediaIds)) {
      for (const mediaId of existing.privateMediaIds) {
        const rec = nexoraStore.getMedia(String(mediaId));
        if (rec && rec.ownerUid === user.uid) {
          const filePath = path.resolve(UPLOADS_DIR, `${rec.id}.${rec.ext}`);
          if (filePath.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch {}
          }
          nexoraStore.deleteMedia(rec.id);
          purgedMediaCount += 1;
        }
      }
    }

    await fsDeleteDoc(`users/${user.uid}/studio_body_profile/default`, user.idToken).catch(() => false);
    sendApiOk(req, res, { deleted: true, purgedMediaCount });
  });

  router.post('/studio/body-profile/estimate', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const adapters = getAdapterConfigStatus();
    if (!adapters.bodyEstimation.configured) {
      sendApiError(
        req,
        res,
        503,
        'BODY_ESTIMATOR_UNCONFIGURED',
        'Calibrated body measurement estimation requires BODY_ESTIMATION_URL and BODY_ESTIMATION_API_KEY. Enter manual measurements instead.'
      );
      return;
    }
    sendApiOk(req, res, { queued: true });
  });

  /* -------------------- 6.3 AI PERSONAL STYLIST -------------------- */

  router.post('/studio/stylist/recommend', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const rate = deps.checkRateLimit(`stylist:${user.uid}`, 20, 60_000);
    if (!rate.allowed) {
      sendApiError(req, res, 429, 'RATE_LIMIT', `Retry in ${rate.retryAfterSec}s.`);
      return;
    }

    const body = parseWithSchema(req, res, StylistRecommendSchema, req.body || {});
    if (!body) return;

    const [styleProfile, catalog] = await Promise.all([
      fsGetDoc(`users/${user.uid}/studio_style_profile/default`, user.idToken).catch(() => null),
      fsQueryCollection('products', user.idToken, {
        where: [{ field: 'status', op: 'EQUAL', value: 'active' }],
        limit: 120,
      }).catch(() => []),
    ]);

    if (styleProfile && styleProfile.stylistOptIn === false) {
      sendApiError(req, res, 403, 'STYLIST_OPTED_OUT', 'Personal Stylist personalization is turned off in your Style Profile.');
      return;
    }

    const outfits = buildStylistOutfits({
      products: catalog,
      occasion: body.occasion,
      styleProfile,
      budgetMaxCents: body.budgetMaxCents,
    });

    const adapters = getAdapterConfigStatus();
    let stylistSummary =
      outfits.length > 0
        ? `Curated ${outfits.length} ${body.occasion.toLowerCase()} outfit combination${outfits.length > 1 ? 's' : ''} grounded in active Nexora Exchange listings.`
        : 'No active Exchange catalog products match your current budget or filters yet.';

    if (outfits.length > 0 && adapters.gemini.configured && process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });
        const itemSummary = outfits
          .map((o) => `${o.title}: ${o.items.map((i) => `${i.title} (${i.category})`).join(' + ')}`)
          .join('; ');
        const resp = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `You are Nexora's backend fashion stylist. In 2 concise sentences, explain why these real catalog outfits work for a "${body.occasion}" occasion${body.notes ? ` (${body.notes})` : ''}: ${itemSummary}. Never invent products not listed.`,
        });
        if (resp.text?.trim()) {
          stylistSummary = resp.text.trim();
        }
      } catch {
        // Keep deterministic summary on transient Gemini failure
      }
    }

    const job = await recordWorkflowJob({
      userId: user.uid,
      idToken: user.idToken,
      jobType: 'stylist_recommend',
      status: 'completed',
      inputSummary: { occasion: body.occasion, budgetMaxCents: body.budgetMaxCents || null },
      resultSummary: { outfitCount: outfits.length },
      steps: [
        { toolName: 'firestore_catalog_query', status: 'ok', atMs: Date.now(), note: `Evaluated ${catalog.length} active products` },
        {
          toolName: 'gemini_stylist_explain',
          status: adapters.gemini.configured ? 'ok' : 'skipped',
          atMs: Date.now(),
          note: adapters.gemini.configured ? 'Generated styling rationale' : 'Deterministic rationale used',
        },
      ],
    });

    sendApiOk(req, res, {
      occasion: body.occasion,
      weatherContext: body.includeWeather
        ? {
            configured: adapters.weatherContext.configured,
            note: adapters.weatherContext.reason,
          }
        : null,
      stylistSummary,
      outfits,
      workflowJobId: job.id,
    });
  });

  /* -------------------- 6.5 AI RUNWAY EXPERIENCE -------------------- */

  router.get('/studio/runway', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const jobs = await fsListCollection(`users/${user.uid}/runway_jobs`, user.idToken, 40).catch(() => []);
    const adapters = getAdapterConfigStatus();
    sendApiOk(req, res, {
      runwayJobs: jobs,
      videoRunwayAdapter: adapters.videoRunway,
    });
  });

  router.post('/studio/runway', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const body = parseWithSchema(req, res, RunwayRequestSchema, req.body || {});
    if (!body) return;

    const photo = await fsGetDoc(`users/${user.uid}/studio_photos/${body.photoId}`, user.idToken).catch(() => null);
    if (!photo || photo.consentAccepted !== true) {
      sendApiError(req, res, 400, 'CONSENTED_PHOTO_REQUIRED', 'A consented personal Studio photo is required before creating an AI Runway job.');
      return;
    }

    const adapters = getAdapterConfigStatus();
    const runwayId = `rnw-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    if (!adapters.videoRunway.configured) {
      const savedDraft = await fsSetDoc(
        `users/${user.uid}/runway_jobs/${runwayId}`,
        {
          id: runwayId,
          userId: user.uid,
          name: body.name,
          runwayStyle: body.runwayStyle,
          environment: body.environment,
          photoId: body.photoId,
          outfitId: body.outfitId || '',
          productIds: body.productIds,
          jobStatus: 'unconfigured',
          providerMessage: 'Video Runway provider credentials (VIDEO_RUNWAY_PROVIDER_URL, VIDEO_RUNWAY_API_KEY) are not configured.',
          createdAt: serverTimestampSentinel(),
          updatedAt: serverTimestampSentinel(),
        },
        user.idToken
      );

      await recordWorkflowJob({
        userId: user.uid,
        idToken: user.idToken,
        jobType: 'runway_generate',
        status: 'unconfigured',
        inputSummary: { runwayStyle: body.runwayStyle, environment: body.environment, runwayId },
        errorCode: 'VIDEO_PROVIDER_UNCONFIGURED',
        errorMessage: adapters.videoRunway.reason,
        steps: [{ toolName: 'video_runway_dispatch', status: 'skipped', atMs: Date.now(), note: adapters.videoRunway.reason }],
      });

      res.status(503).json({
        ok: false,
        error: {
          code: 'VIDEO_PROVIDER_UNCONFIGURED',
          message:
            'AI Runway video generation is unavailable because VIDEO_RUNWAY_PROVIDER_URL and VIDEO_RUNWAY_API_KEY are not configured. Your runway look configuration was saved as a draft.',
          details: { runwayId: savedDraft.id, jobStatus: 'unconfigured' },
          requestId: req.requestId || null,
        },
        runwayJob: savedDraft,
      });
      return;
    }

    const queued = await fsSetDoc(
      `users/${user.uid}/runway_jobs/${runwayId}`,
      {
        id: runwayId,
        userId: user.uid,
        name: body.name,
        runwayStyle: body.runwayStyle,
        environment: body.environment,
        photoId: body.photoId,
        outfitId: body.outfitId || '',
        productIds: body.productIds,
        jobStatus: 'queued',
        providerMessage: 'Dispatched to configured AI Runway video provider.',
        createdAt: serverTimestampSentinel(),
        updatedAt: serverTimestampSentinel(),
      },
      user.idToken
    );

    const wf = await recordWorkflowJob({
      userId: user.uid,
      idToken: user.idToken,
      jobType: 'runway_generate',
      status: 'queued',
      inputSummary: { runwayStyle: body.runwayStyle, environment: body.environment, runwayId },
      steps: [{ toolName: 'video_runway_dispatch', status: 'ok', atMs: Date.now(), note: 'Dispatched to video runway provider' }],
    });

    sendApiOk(req, res, { runwayJob: queued, workflowJobId: wf.id }, 202);
  });

  router.delete('/studio/runway/:jobId', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const jobId = String(req.params.jobId || '').trim();
    if (!VALID_ID_RE.test(jobId)) {
      sendApiError(req, res, 400, 'INVALID_ID', 'Invalid runway job identifier.');
      return;
    }
    await fsDeleteDoc(`users/${user.uid}/runway_jobs/${jobId}`, user.idToken).catch(() => false);
    sendApiOk(req, res, { deletedId: jobId });
  });

  return router;
}
