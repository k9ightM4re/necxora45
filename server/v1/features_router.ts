import fs from 'fs';
import path from 'path';
import { Router, type Response } from 'express';
import {
  NEXORA_FEATURE_REGISTRY,
  type EvaluatedFeatureEntry,
  type FeatureAvailability,
  type FeatureImplementationStatus,
} from '../../shared/featureRegistry.ts';
import {
  getAdapterConfigStatus,
  sendApiError,
  sendApiOk,
  type AuthedRequest,
  type VerifiedUser,
} from './context.ts';

export interface FeaturesRouterDeps {
  requireVerifiedBearer: (req: AuthedRequest, res: Response) => Promise<VerifiedUser | null>;
  isAdminUserServer: (user: any) => boolean;
}

interface VerificationFileSummary {
  generatedAt?: string;
  passed?: boolean;
  totalTests?: number;
  failedTests?: number;
  resultsByTestFile?: Record<string, { passed: boolean; total: number; failed: number }>;
}

function readLatestVerificationSummary(): VerificationFileSummary | null {
  try {
    const filePath = path.resolve(process.cwd(), 'reports', 'feature-verification.json');
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as VerificationFileSummary;
  } catch {
    return null;
  }
}

export function evaluateFeatureRegistry(isAdmin: boolean): {
  features: EvaluatedFeatureEntry[];
  verificationSummary: VerificationFileSummary | null;
  adapterStatus: ReturnType<typeof getAdapterConfigStatus> & { redis: { configured: boolean; reason: string } };
} {
  const baseAdapters = getAdapterConfigStatus();
  const redisConfigured = Boolean(process.env.REDIS_URL?.trim());
  const adapterStatus = {
    ...baseAdapters,
    redis: {
      configured: redisConfigured,
      reason: redisConfigured ? 'Redis URL configured.' : 'REDIS_URL not configured; single-node WebSocket active.',
    },
  };
  const verificationSummary = readLatestVerificationSummary();

  const evaluated: EvaluatedFeatureEntry[] = NEXORA_FEATURE_REGISTRY.map((entry) => {
    let providerConfigured = true;
    if (entry.providerConfig.required && entry.providerConfig.adapterKey !== 'none') {
      const key = entry.providerConfig.adapterKey;
      providerConfigured = Boolean((adapterStatus as Record<string, { configured?: boolean }>)[key]?.configured);
    }

    let effectiveAvailability: FeatureAvailability = entry.availability;
    let effectiveStatus: FeatureImplementationStatus = entry.implementationStatus;

    if (entry.adminOnly && !isAdmin) {
      effectiveAvailability = 'RESTRICTED_BY_PERMISSIONS';
    } else if (entry.providerConfig.required && !providerConfigured) {
      effectiveAvailability = 'REQUIRES_CONFIGURATION';
      effectiveStatus = 'BLOCKED_EXTERNAL_DEPENDENCY';
    } else if (entry.providerConfig.required && providerConfigured) {
      effectiveAvailability = entry.adminOnly ? 'RESTRICTED_BY_PERMISSIONS' : 'ENABLED';
      effectiveStatus = 'IMPLEMENTED_AND_VERIFIED';
    }

    let testResult: EvaluatedFeatureEntry['testResult'] = undefined;
    if (verificationSummary?.resultsByTestFile && entry.testFiles.length > 0) {
      const matched = entry.testFiles
        .map((tf) => verificationSummary.resultsByTestFile?.[tf])
        .filter(Boolean);
      if (matched.length > 0) {
        const allPassed = matched.every((m) => m!.passed);
        testResult = {
          passed: allPassed,
          lastRunAt: verificationSummary.generatedAt,
          detail: `${matched.reduce((acc, m) => acc + (m?.total || 0), 0)} checks`,
        };
      }
    }

    return {
      ...entry,
      providerConfigured,
      effectiveAvailability,
      effectiveStatus,
      ...(testResult ? { testResult } : {}),
    };
  });

  return {
    features: evaluated,
    verificationSummary,
    adapterStatus,
  };
}

export function createFeaturesV1Router(deps: FeaturesRouterDeps): Router {
  const router = Router();

  router.get('/features/registry', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    const isAdmin = deps.isAdminUserServer(user);
    const { features, adapterStatus } = evaluateFeatureRegistry(isAdmin);

    // Non-admins do not see internal admin health diagnostic cards as runnable tools
    const visibleFeatures = isAdmin ? features : features.filter((f) => !f.adminOnly);

    sendApiOk(req, res, {
      isAdmin,
      features: visibleFeatures,
      adapterStatus,
    });
  });

  router.get('/admin/feature-health', async (req: AuthedRequest, res: Response) => {
    const user = await deps.requireVerifiedBearer(req, res);
    if (!user) return;
    if (!deps.isAdminUserServer(user)) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Verified administrator privileges required for Feature Health diagnostics.');
      return;
    }

    const { features, verificationSummary, adapterStatus } = evaluateFeatureRegistry(true);
    const summary = {
      totalRegistered: features.length,
      verifiedCount: features.filter((f) => f.effectiveStatus === 'IMPLEMENTED_AND_VERIFIED').length,
      incompleteCount: features.filter((f) =>
        ['NOT_STARTED', 'FRONTEND_ONLY', 'BACKEND_ONLY', 'DATABASE_ONLY', 'PARTIALLY_IMPLEMENTED'].includes(
          f.effectiveStatus
        )
      ).length,
      frontendOnlyCount: features.filter((f) => f.effectiveStatus === 'FRONTEND_ONLY').length,
      backendOnlyCount: features.filter((f) => f.effectiveStatus === 'BACKEND_ONLY').length,
      blockedExternalCount: features.filter((f) => f.effectiveStatus === 'BLOCKED_EXTERNAL_DEPENDENCY').length,
      unverifiedCount: features.filter((f) => f.effectiveStatus === 'IMPLEMENTED_NOT_VERIFIED').length,
      failedTestsCount: verificationSummary?.failedTests ?? 0,
    };

    sendApiOk(req, res, {
      summary,
      features,
      verificationSummary,
      adapterStatus,
    });
  });

  return router;
}
