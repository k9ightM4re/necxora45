import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Film,
  Layers,
  Plus,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { auth } from '../../js/firebase.js';
import { ApiV1Error, apiV1Request } from './apiClient';
import type { ProductItem } from './MarketplaceView';

interface StudioPhoto {
  id: string;
  label: string;
  mediaUrl: string;
  consentAccepted: boolean;
}

interface StudioOutfit {
  id: string;
  name: string;
  photoId?: string;
  productIds: string[];
  garmentCategory?: string;
  jobStatus: string;
  providerMessage?: string;
}

interface StyleProfile {
  preferredStyles: string[];
  favoriteColors: string[];
  preferredBrands: string[];
  topSize: string;
  bottomSize: string;
  footwearSize: string;
  fitPreference: 'slim' | 'regular' | 'relaxed' | 'oversized';
  priceMinCents: number;
  priceMaxCents: number;
  optionalHeightCm: number | null;
  stylistOptIn: boolean;
}

interface BodyProfile {
  consentAccepted: boolean;
  heightCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  inseamCm: number | null;
  shoulderCm: number | null;
  calibrationMode: 'manual' | 'uncalibrated_estimate';
  confidenceDisclaimer?: string;
  privateMediaIds?: string[];
}

interface RunwayJob {
  id: string;
  name: string;
  runwayStyle: string;
  environment: string;
  photoId: string;
  productIds: string[];
  jobStatus: string;
  providerMessage?: string;
}

interface WorkflowJob {
  id: string;
  jobType: string;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAtMs: number;
  steps?: Array<{ toolName: string; status: string; note?: string }>;
}

interface StudioStatus {
  virtualTryOn: { configured: boolean; reason: string };
  videoRunway?: { configured: boolean; reason: string };
  bodyEstimation?: { configured: boolean; reason: string };
  weatherContext?: { configured: boolean; reason: string };
}

interface StylistBundle {
  title: string;
  occasion: string;
  items: ProductItem[];
  totalCents: number;
  score: number;
  reasons: string[];
}

interface NexoraStudioViewProps {
  onNavigate: (section: string, opts?: Record<string, any>) => void;
}

type StudioTab = 'tryon' | 'stylist' | 'style-profile' | 'body-profile' | 'runway' | 'workflows';

const OCCASIONS = ['Casual', 'Formal', 'Streetwear', 'Party', 'Traditional', 'Minimal', 'Sporty', 'Seasonal'] as const;

const PrivateStudioImage: React.FC<{ src: string; alt: string; className?: string }> = ({ src, alt, className }) => {
  const [resolvedUrl, setResolvedUrl] = useState<string>(() => (src.startsWith('/api/media/private/') ? '' : src));

  useEffect(() => {
    if (!src.startsWith('/api/media/private/')) {
      setResolvedUrl(src);
      return;
    }
    let active = true;
    let objectUrl = '';
    const loadPrivate = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'same-origin',
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      } catch {
        // leave blank on failure
      }
    };
    void loadPrivate();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!resolvedUrl) {
    return <div className={`${className || ''} flex items-center justify-center bg-[#2A0A0D]/20 text-[11px] text-[var(--nx-text-secondary)]`}>Private</div>;
  }
  return <img src={resolvedUrl} alt={alt} className={className} />;
};

export const NexoraStudioView: React.FC<NexoraStudioViewProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('tryon');
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [photos, setPhotos] = useState<StudioPhoto[]>([]);
  const [outfits, setOutfits] = useState<StudioOutfit[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [runwayJobs, setRunwayJobs] = useState<RunwayJob[]>([]);
  const [workflowJobs, setWorkflowJobs] = useState<WorkflowJob[]>([]);
  const [loading, setLoading] = useState(true);

  const [notice, setNotice] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Lookbook upload & try-on
  const [photoLabel, setPhotoLabel] = useState('');
  const [photoMediaUrl, setPhotoMediaUrl] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [outfitName, setOutfitName] = useState('');
  const [selectedPhotoId, setSelectedPhotoId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [garmentCategory, setGarmentCategory] = useState<'upperwear' | 'lowerwear' | 'full_outfit' | 'outerwear' | 'accessories'>('full_outfit');
  const [preserveIdentity, setPreserveIdentity] = useState(true);
  const [preservePose, setPreservePose] = useState(true);
  const [fitDisclaimerAck, setFitDisclaimerAck] = useState(false);

  // 6.1 Style Profile
  const [spStyles, setSpStyles] = useState('minimalist, tailored');
  const [spColors, setSpColors] = useState('charcoal, ivory, navy');
  const [spBrands, setSpBrands] = useState('');
  const [spTopSize, setSpTopSize] = useState('M');
  const [spBottomSize, setSpBottomSize] = useState('32');
  const [spFootwearSize, setSpFootwearSize] = useState('42');
  const [spFit, setSpFit] = useState<'slim' | 'regular' | 'relaxed' | 'oversized'>('regular');
  const [spBudgetMax, setSpBudgetMax] = useState('400');
  const [spHeightCm, setSpHeightCm] = useState('');
  const [spOptIn, setSpOptIn] = useState(true);

  // 6.2 Body Profile
  const [bpConsent, setBpConsent] = useState(false);
  const [bpHeight, setBpHeight] = useState('');
  const [bpChest, setBpChest] = useState('');
  const [bpWaist, setBpWaist] = useState('');
  const [bpHips, setBpHips] = useState('');
  const [bpInseam, setBpInseam] = useState('');
  const [bpShoulder, setBpShoulder] = useState('');
  const [bpDisclaimer, setBpDisclaimer] = useState('');

  // 6.3 Stylist
  const [occasion, setOccasion] = useState<(typeof OCCASIONS)[number]>('Casual');
  const [stylistBudget, setStylistBudget] = useState('');
  const [stylistWeather, setStylistWeather] = useState(false);
  const [stylistNotes, setStylistNotes] = useState('');
  const [stylistSummary, setStylistSummary] = useState('');
  const [stylistBundles, setStylistBundles] = useState<StylistBundle[]>([]);

  // 6.5 Runway
  const [runwayName, setRunwayName] = useState('Editorial Look Walk');
  const [runwayStyle, setRunwayStyle] = useState('Editorial Shoot');
  const [runwayEnv, setRunwayEnv] = useState('Daylight Studio');

  const loadStudio = useCallback(async () => {
    setLoading(true);
    try {
      const [st, ph, ot, pr, sp, bp, rn, wf] = await Promise.all([
        apiV1Request<StudioStatus>('/studio/status'),
        apiV1Request<{ photos: StudioPhoto[] }>('/studio/photos'),
        apiV1Request<{ outfits: StudioOutfit[] }>('/studio/outfits'),
        apiV1Request<{ products: ProductItem[] }>('/products'),
        apiV1Request<{ styleProfile: StyleProfile | null }>('/studio/style-profile').catch(() => ({ styleProfile: null })),
        apiV1Request<{ bodyProfile: BodyProfile | null }>('/studio/body-profile').catch(() => ({ bodyProfile: null })),
        apiV1Request<{ runwayJobs: RunwayJob[] }>('/studio/runway').catch(() => ({ runwayJobs: [] })),
        apiV1Request<{ jobs: WorkflowJob[] }>('/workflows/jobs').catch(() => ({ jobs: [] })),
      ]);

      setStatus(st);
      setPhotos(ph.photos || []);
      setOutfits(ot.outfits || []);
      setProducts(pr.products || []);
      setRunwayJobs(rn.runwayJobs || []);
      setWorkflowJobs(wf.jobs || []);
      if (!selectedPhotoId && (ph.photos || []).length > 0) {
        setSelectedPhotoId(ph.photos[0].id);
      }
      if (sp.styleProfile) {
        const p = sp.styleProfile;
        setSpStyles((p.preferredStyles || []).join(', '));
        setSpColors((p.favoriteColors || []).join(', '));
        setSpBrands((p.preferredBrands || []).join(', '));
        setSpTopSize(p.topSize || '');
        setSpBottomSize(p.bottomSize || '');
        setSpFootwearSize(p.footwearSize || '');
        setSpFit(p.fitPreference || 'regular');
        setSpBudgetMax(p.priceMaxCents ? String(Math.round(p.priceMaxCents / 100)) : '');
        setSpHeightCm(p.optionalHeightCm ? String(p.optionalHeightCm) : '');
        setSpOptIn(p.stylistOptIn !== false);
      }
      if (bp.bodyProfile) {
        const b = bp.bodyProfile;
        setBpConsent(Boolean(b.consentAccepted));
        setBpHeight(b.heightCm ? String(b.heightCm) : '');
        setBpChest(b.chestCm ? String(b.chestCm) : '');
        setBpWaist(b.waistCm ? String(b.waistCm) : '');
        setBpHips(b.hipsCm ? String(b.hipsCm) : '');
        setBpInseam(b.inseamCm ? String(b.inseamCm) : '');
        setBpShoulder(b.shoulderCm ? String(b.shoulderCm) : '');
        setBpDisclaimer(b.confidenceDisclaimer || '');
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to load AI Style Studio.' });
    } finally {
      setLoading(false);
    }
  }, [selectedPhotoId]);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3_500_000) {
      setNotice({ tone: 'error', text: 'Studio images must be under 3.5 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') return;
      try {
        setBusy(true);
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/media/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            name: file.name || 'studio-look.jpg',
            kind: 'studio',
            visibility: 'private',
            dataUrl: reader.result,
          }),
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.media?.url) {
          setPhotoMediaUrl(String(json.media.url));
          setNotice({ tone: 'info', text: 'Uploaded privately to secured Studio storage. Confirm consent and save.' });
        } else {
          setPhotoMediaUrl(reader.result);
        }
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentAccepted) {
      setNotice({ tone: 'error', text: 'Explicit consent is required before saving a private photo.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiV1Request<{ photo: StudioPhoto }>('/studio/photos', {
        method: 'POST',
        body: JSON.stringify({
          label: photoLabel.trim() || 'Studio Look',
          mediaUrl: photoMediaUrl.trim(),
          consentAccepted: true,
        }),
      });
      setPhotos((prev) => [res.photo, ...prev]);
      setSelectedPhotoId(res.photo.id);
      setPhotoLabel('');
      setPhotoMediaUrl('');
      setConsentAccepted(false);
      setNotice({ tone: 'info', text: 'Private consented Studio photo saved.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to save photo.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      await apiV1Request(`/studio/photos/${photoId}`, { method: 'DELETE' });
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      if (selectedPhotoId === photoId) setSelectedPhotoId('');
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to delete photo.' });
    }
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId].slice(0, 10)
    );
  };

  const handleSaveOutfitDraft = async () => {
    if (!outfitName.trim() || selectedProductIds.length === 0) {
      setNotice({ tone: 'error', text: 'Enter an outfit name and select at least one Exchange item.' });
      return;
    }
    setBusy(true);
    try {
      const res = await apiV1Request<{ outfit: StudioOutfit }>('/studio/outfits', {
        method: 'POST',
        body: JSON.stringify({
          name: outfitName.trim(),
          photoId: selectedPhotoId || '',
          productIds: selectedProductIds,
        }),
      });
      setOutfits((prev) => [res.outfit, ...prev]);
      setOutfitName('');
      setSelectedProductIds([]);
      setNotice({ tone: 'info', text: `Outfit draft "${res.outfit.name}" saved.` });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to save outfit.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitTryOn = async () => {
    if (!selectedPhotoId || selectedProductIds.length === 0) {
      setNotice({ tone: 'error', text: 'Select a consented private photo and at least one Exchange item.' });
      return;
    }
    if (!fitDisclaimerAck) {
      setNotice({ tone: 'warn', text: 'Acknowledge the visual-preview fit disclaimer before submitting Virtual Try-On.' });
      return;
    }
    setBusy(true);
    try {
      const res = await apiV1Request<{ outfit: StudioOutfit }>('/studio/try-on', {
        method: 'POST',
        body: JSON.stringify({
          name: outfitName.trim() || 'Virtual Try-On Look',
          photoId: selectedPhotoId,
          productIds: selectedProductIds,
          garmentCategory,
          preserveIdentity,
          preservePose,
          shareConsent: false,
        }),
      });
      setOutfits((prev) => [res.outfit, ...prev]);
      setNotice({ tone: 'info', text: 'Virtual Try-On job queued with configured provider.' });
    } catch (err) {
      if (err instanceof ApiV1Error && err.status === 503) {
        setNotice({ tone: 'warn', text: err.message });
        void loadStudio();
      } else {
        setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Virtual Try-On failed.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStyleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiV1Request('/studio/style-profile', {
        method: 'PUT',
        body: JSON.stringify({
          preferredStyles: spStyles.split(',').map((s) => s.trim()).filter(Boolean),
          favoriteColors: spColors.split(',').map((s) => s.trim()).filter(Boolean),
          preferredBrands: spBrands.split(',').map((s) => s.trim()).filter(Boolean),
          topSize: spTopSize.trim(),
          bottomSize: spBottomSize.trim(),
          footwearSize: spFootwearSize.trim(),
          fitPreference: spFit,
          priceMaxCents: spBudgetMax ? Math.round(Number.parseFloat(spBudgetMax) * 100) : 0,
          optionalHeightCm: spHeightCm ? Number.parseFloat(spHeightCm) : null,
          stylistOptIn: spOptIn,
        }),
      });
      setNotice({ tone: 'info', text: 'Personal Style Profile saved.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to save style profile.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBodyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bpConsent) {
      setNotice({ tone: 'error', text: 'Explicit consent is required to save a private body profile.' });
      return;
    }
    setBusy(true);
    try {
      const res = await apiV1Request<{ bodyProfile: BodyProfile }>('/studio/body-profile', {
        method: 'PUT',
        body: JSON.stringify({
          consentAccepted: true,
          heightCm: bpHeight ? Number.parseFloat(bpHeight) : null,
          chestCm: bpChest ? Number.parseFloat(bpChest) : null,
          waistCm: bpWaist ? Number.parseFloat(bpWaist) : null,
          hipsCm: bpHips ? Number.parseFloat(bpHips) : null,
          inseamCm: bpInseam ? Number.parseFloat(bpInseam) : null,
          shoulderCm: bpShoulder ? Number.parseFloat(bpShoulder) : null,
          calibrationMode: 'manual',
        }),
      });
      setBpDisclaimer(res.bodyProfile?.confidenceDisclaimer || '');
      setNotice({ tone: 'info', text: 'Private body measurements saved securely.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to save body profile.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBodyProfile = async () => {
    setBusy(true);
    try {
      await apiV1Request('/studio/body-profile', { method: 'DELETE' });
      setBpHeight('');
      setBpChest('');
      setBpWaist('');
      setBpHips('');
      setBpInseam('');
      setBpShoulder('');
      setBpConsent(false);
      setBpDisclaimer('');
      setNotice({ tone: 'info', text: 'Private body profile and linked files permanently deleted.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to delete body profile.' });
    } finally {
      setBusy(false);
    }
  };

  const handleEstimateBody = async () => {
    setBusy(true);
    try {
      await apiV1Request('/studio/body-profile/estimate', { method: 'POST' });
    } catch (err) {
      setNotice({
        tone: err instanceof ApiV1Error && err.status === 503 ? 'warn' : 'error',
        text: err instanceof Error ? err.message : 'Body estimation unavailable.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRunStylist = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiV1Request<{
        stylistSummary: string;
        outfits: StylistBundle[];
        weatherContext?: { configured: boolean; note: string } | null;
      }>('/studio/stylist/recommend', {
        method: 'POST',
        body: JSON.stringify({
          occasion,
          budgetMaxCents: stylistBudget ? Math.round(Number.parseFloat(stylistBudget) * 100) : undefined,
          includeWeather: stylistWeather,
          notes: stylistNotes.trim(),
        }),
      });
      setStylistSummary(
        res.weatherContext && !res.weatherContext.configured
          ? `${res.stylistSummary} (Weather API unconfigured: ${res.weatherContext.note})`
          : res.stylistSummary
      );
      setStylistBundles(res.outfits || []);
      void loadStudio();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Stylist recommendation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRunway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPhotoId || selectedProductIds.length === 0) {
      setNotice({ tone: 'error', text: 'Select a private Studio photo and at least one Exchange item first.' });
      return;
    }
    setBusy(true);
    try {
      await apiV1Request('/studio/runway', {
        method: 'POST',
        body: JSON.stringify({
          name: runwayName.trim() || 'Editorial Runway Clip',
          runwayStyle,
          environment: runwayEnv,
          photoId: selectedPhotoId,
          productIds: selectedProductIds,
        }),
      });
      setNotice({ tone: 'info', text: 'AI Runway job queued cleanly.' });
      void loadStudio();
    } catch (err) {
      setNotice({
        tone: err instanceof ApiV1Error && err.status === 503 ? 'warn' : 'error',
        text: err instanceof Error ? err.message : 'AI Runway request failed.',
      });
      void loadStudio();
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: StudioTab; label: string; icon: React.ReactNode }> = [
    { id: 'tryon', label: 'Lookbook & Try-On', icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: 'stylist', label: 'AI Personal Stylist', icon: <Wand2 className="h-3.5 w-3.5" /> },
    { id: 'style-profile', label: 'Style Profile', icon: <UserCheck className="h-3.5 w-3.5" /> },
    { id: 'body-profile', label: 'Private Body Profile', icon: <Ruler className="h-3.5 w-3.5" /> },
    { id: 'runway', label: 'AI Runway', icon: <Film className="h-3.5 w-3.5" /> },
    { id: 'workflows', label: `Workflows (${workflowJobs.length})`, icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#B45309] dark:text-amber-300">
            <Sparkles className="h-4 w-4" />
            <span>AI Style Studio · Private consented workspace</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-[var(--nx-text)]">
            Personal stylist, try-on, body measurements &amp; runway
          </h1>
          <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
            Private studio photos and body profiles are stored owner-only with instant deletion. Outfit styling is grounded strictly in real partner store listings.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigate('camera')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13]"
          >
            <Camera className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F2B8B5]" />
            <span>Nexora Camera</span>
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

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              activeTab === tab.id
                ? 'bg-[#790B13] text-[#FFF0DC]'
                : 'text-[var(--nx-text-secondary)] hover:bg-[var(--nx-card-soft)] hover:text-[var(--nx-text)]'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-sm ${
            notice.tone === 'error'
              ? 'border-red-600/35 bg-red-600/10 text-red-700 dark:text-red-300'
              : notice.tone === 'warn'
                ? 'border-[#B45309]/40 bg-[#B45309]/10 text-[#B45309] dark:text-amber-300'
                : 'border-[#790B13]/35 bg-[#F7E1D3]/70 text-[#790B13] dark:bg-[#790B13]/20 dark:text-[#FFF0DC]'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* TAB 1: LOOKBOOK & VIRTUAL TRY-ON */}
      {activeTab === 'tryon' && (
        <div className="space-y-6">
          {status && (
            <div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-4 py-3 text-sm">
              <div className="flex items-center gap-2.5">
                {status.virtualTryOn.configured ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[#B45309] dark:text-amber-300" />
                )}
                <span className="font-semibold text-[var(--nx-text)]">
                  Virtual Try-On provider:{' '}
                  {status.virtualTryOn.configured ? 'Configured' : 'Requires configuration'}
                </span>
              </div>
              <p className="mt-1 pl-6 text-xs text-[var(--nx-text-secondary)]">{status.virtualTryOn.reason}</p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5">
              <h2 className="text-base font-semibold text-[var(--nx-text)]">1. Private Consented Lookbook Photos</h2>
              <form onSubmit={handleUploadPhoto} className="space-y-3">
                <input
                  type="text"
                  placeholder="Photo label (e.g. Daylight Portrait)"
                  value={photoLabel}
                  onChange={(e) => setPhotoLabel(e.target.value)}
                  className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                />
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Private media URL or upload file ->"
                    value={photoMediaUrl}
                    onChange={(e) => setPhotoMediaUrl(e.target.value)}
                    className="min-w-[200px] flex-1 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                  />
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-xs font-medium text-[var(--nx-text)] hover:border-[#790B13]">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload private file</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhotoFile} className="hidden" />
                  </label>
                </div>
                <label className="flex items-start gap-2 text-xs text-[var(--nx-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I explicitly consent to private encrypted-transport storage of this photo for my account only.
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={busy || !photoMediaUrl}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#790B13] px-4 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810] disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Save private photo</span>
                </button>
              </form>

              {loading ? (
                <div className="h-24 animate-pulse rounded-lg bg-[var(--nx-card-soft)]" />
              ) : photos.length === 0 ? (
                <p className="text-xs text-[var(--nx-text-secondary)]">No private lookbook photos uploaded yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {photos.map((photo) => {
                    const selected = selectedPhotoId === photo.id;
                    return (
                      <div
                        key={photo.id}
                        onClick={() => setSelectedPhotoId(photo.id)}
                        className={`cursor-pointer overflow-hidden rounded-lg border transition ${
                          selected ? 'border-[#790B13] ring-1 ring-[#790B13]' : 'border-[var(--nx-border)]'
                        } bg-[var(--nx-card-soft)]`}
                      >
                        <PrivateStudioImage src={photo.mediaUrl} alt={photo.label} className="h-28 w-full object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-2 text-xs">
                          <span className="truncate font-medium text-[var(--nx-text)]">{photo.label}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeletePhoto(photo.id);
                            }}
                            aria-label={`Delete photo ${photo.label}`}
                            className="text-[var(--nx-text-secondary)] hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5">
              <h2 className="text-base font-semibold text-[var(--nx-text)]">2. Outfit Builder &amp; Enhanced Try-On</h2>
              <input
                type="text"
                placeholder="Outfit title (e.g. Tailored Autumn Look)"
                value={outfitName}
                onChange={(e) => setOutfitName(e.target.value)}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Garment Slot</label>
                  <select
                    value={garmentCategory}
                    onChange={(e) => setGarmentCategory(e.target.value as any)}
                    className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-xs text-[var(--nx-text)]"
                  >
                    <option value="full_outfit">Full Outfit</option>
                    <option value="upperwear">Upperwear</option>
                    <option value="lowerwear">Lowerwear</option>
                    <option value="outerwear">Outerwear</option>
                    <option value="accessories">Accessories</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end gap-1.5 text-xs text-[var(--nx-text-secondary)]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={preserveIdentity} onChange={(e) => setPreserveIdentity(e.target.checked)} />
                    <span>Preserve Facial Identity</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={preservePose} onChange={(e) => setPreservePose(e.target.checked)} />
                    <span>Preserve Original Pose</span>
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium text-[var(--nx-text-secondary)]">
                  Select Exchange Items ({selectedProductIds.length}/10 selected)
                </div>
                <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  {products.map((prod) => {
                    const checked = selectedProductIds.includes(prod.id);
                    return (
                      <label
                        key={prod.id}
                        className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                          checked
                            ? 'border-[#790B13] bg-[#F7E1D3]/60 text-[var(--nx-text)] dark:bg-[#790B13]/20'
                            : 'border-[var(--nx-border)] bg-[var(--nx-card-soft)] text-[var(--nx-text-secondary)]'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleProductSelection(prod.id)} />
                          <span className="font-medium text-[var(--nx-text)]">{prod.title}</span>
                          <span>({prod.merchantName})</span>
                        </span>
                        <span className="font-mono tabular-nums">${(Number(prod.priceCents || 0) / 100).toFixed(2)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-start gap-2 text-[11px] text-[var(--nx-text-secondary)]">
                <input
                  type="checkbox"
                  checked={fitDisclaimerAck}
                  onChange={(e) => setFitDisclaimerAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I understand Virtual Try-On produces a visual preview only and does not guarantee exact physical sizing.</span>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveOutfitDraft}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13] disabled:opacity-50"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Save outfit draft</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSubmitTryOn}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#790B13] px-3.5 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810] disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Submit virtual try-on</span>
                </button>
              </div>
            </section>
          </div>

          <section className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5">
            <h2 className="text-base font-semibold text-[var(--nx-text)]">Saved outfits &amp; try-on history</h2>
            {outfits.length === 0 ? (
              <p className="text-xs text-[var(--nx-text-secondary)]">No saved outfits yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {outfits.map((outfit) => (
                  <div
                    key={outfit.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--nx-text)]">{outfit.name}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                            outfit.jobStatus === 'queued'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : outfit.jobStatus === 'unconfigured'
                                ? 'bg-[#B45309]/15 text-[#B45309] dark:text-amber-300'
                                : 'bg-[#790B13]/12 text-[#790B13] dark:bg-[#790B13]/25 dark:text-[#FFF0DC]'
                          }`}
                        >
                          {outfit.jobStatus}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--nx-text-secondary)]">
                        {outfit.productIds?.length || 0} item(s)
                        {outfit.providerMessage ? ` · ${outfit.providerMessage}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void apiV1Request(`/studio/outfits/${outfit.id}`, { method: 'DELETE' }).then(() =>
                          setOutfits((p) => p.filter((x) => x.id !== outfit.id))
                        )
                      }
                      aria-label={`Delete outfit ${outfit.name}`}
                      className="text-[var(--nx-text-secondary)] hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: 6.3 AI PERSONAL STYLIST */}
      {activeTab === 'stylist' && (
        <div className="space-y-5">
          <form
            onSubmit={handleRunStylist}
            className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5"
          >
            <h2 className="text-base font-semibold text-[var(--nx-text)]">AI Personal Stylist</h2>
            <p className="text-xs text-[var(--nx-text-secondary)]">
              Builds complete coordinated outfits exclusively from verified active Exchange items matched to your Style Profile.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Occasion</label>
                <select
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value as any)}
                  className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                >
                  {OCCASIONS.map((occ) => (
                    <option key={occ} value={occ}>
                      {occ}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Max Budget (USD)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Optional ceiling"
                  value={stylistBudget}
                  onChange={(e) => setStylistBudget(e.target.value)}
                  className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Styling Notes</label>
                <input
                  type="text"
                  placeholder="e.g. breathable fabrics, monochrome"
                  value={stylistNotes}
                  onChange={(e) => setStylistNotes(e.target.value)}
                  className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
              <input type="checkbox" checked={stylistWeather} onChange={(e) => setStylistWeather(e.target.checked)} />
              <span>Include seasonal weather context (uses optional Weather adapter if configured)</span>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#790B13] px-4 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810] disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>{busy ? 'Styling...' : 'Generate outfit recommendations'}</span>
            </button>
          </form>

          {stylistSummary && (
            <div className="rounded-xl border border-[#790B13]/35 bg-[#F7E1D3]/60 px-4 py-3 text-sm text-[var(--nx-text)] dark:bg-[#790B13]/20">
              {stylistSummary}
            </div>
          )}

          {stylistBundles.length > 0 && (
            <div className="grid gap-4 md:grid-cols-3">
              {stylistBundles.map((bundle) => (
                <div key={bundle.title} className="flex flex-col justify-between rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <strong className="text-sm text-[var(--nx-text)]">{bundle.title}</strong>
                      <span className="font-mono text-xs font-bold tabular-nums text-[#790B13] dark:text-[#F2B8B5]">
                        ${(bundle.totalCents / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {bundle.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onNavigate('marketplace', { productId: item.id })}
                          className="flex w-full items-center justify-between rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-2 text-left text-xs hover:border-[#790B13]"
                        >
                          <span className="truncate font-medium text-[var(--nx-text)]">{item.title}</span>
                          <span className="ml-2 shrink-0 tabular-nums text-[var(--nx-text-secondary)]">
                            ${(Number(item.priceCents || 0) / 100).toFixed(2)}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="text-[11px] text-[var(--nx-text-secondary)]">{bundle.reasons.join(' · ')}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOutfitName(bundle.title);
                      setSelectedProductIds(bundle.items.map((i) => i.id));
                      setActiveTab('tryon');
                    }}
                    className="mt-4 rounded-xl border border-[var(--nx-border)] px-3 py-1.5 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13]"
                  >
                    Load into outfit builder
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: 6.1 STYLE PROFILE */}
      {activeTab === 'style-profile' && (
        <form
          onSubmit={handleSaveStyleProfile}
          className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--nx-text)]">Personal Style Profile</h2>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--nx-text)]">
              <input type="checkbox" checked={spOptIn} onChange={(e) => setSpOptIn(e.target.checked)} />
              <span>Enable Stylist Personalization</span>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Preferred Styles</label>
              <input
                type="text"
                value={spStyles}
                onChange={(e) => setSpStyles(e.target.value)}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Favorite Colors</label>
              <input
                type="text"
                value={spColors}
                onChange={(e) => setSpColors(e.target.value)}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Preferred Brands</label>
              <input
                type="text"
                value={spBrands}
                onChange={(e) => setSpBrands(e.target.value)}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">Fit Preference</label>
              <select
                value={spFit}
                onChange={(e) => setSpFit(e.target.value as any)}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              >
                <option value="slim">Slim</option>
                <option value="regular">Regular</option>
                <option value="relaxed">Relaxed</option>
                <option value="oversized">Oversized</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">Top Size</label>
                <input type="text" value={spTopSize} onChange={(e) => setSpTopSize(e.target.value)} className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-2 text-xs text-[var(--nx-text)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">Bottom Size</label>
                <input type="text" value={spBottomSize} onChange={(e) => setSpBottomSize(e.target.value)} className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-2 text-xs text-[var(--nx-text)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">Footwear</label>
                <input type="text" value={spFootwearSize} onChange={(e) => setSpFootwearSize(e.target.value)} className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-2 text-xs text-[var(--nx-text)]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">Max Budget USD</label>
                <input type="number" min="0" value={spBudgetMax} onChange={(e) => setSpBudgetMax(e.target.value)} className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-2 text-xs text-[var(--nx-text)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">Height cm (Opt)</label>
                <input type="number" min="80" max="250" value={spHeightCm} onChange={(e) => setSpHeightCm(e.target.value)} className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-2.5 py-2 text-xs text-[var(--nx-text)]" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="rounded-xl bg-[#790B13] px-4 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]">
              Save style profile
            </button>
            <button
              type="button"
              onClick={() =>
                void apiV1Request('/studio/style-profile', { method: 'DELETE' }).then(() =>
                  setNotice({ tone: 'info', text: 'Style Profile cleared.' })
                )
              }
              className="rounded-xl border border-[var(--nx-border)] px-3.5 py-2 text-xs text-red-700 dark:text-red-300"
            >
              Delete style profile
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: 6.2 PRIVATE BODY PROFILE */}
      {activeTab === 'body-profile' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-[#790B13]/35 bg-[#F7E1D3]/60 px-4 py-3 text-xs text-[var(--nx-text)] dark:bg-[#790B13]/20">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#790B13] dark:text-[#F2B8B5]" />
            <span>
              Strictly private &amp; owner-only. We never fabricate precision cm accuracy from uncalibrated photos.
              {bpDisclaimer ? ` Active disclaimer: ${bpDisclaimer}` : ''}
            </span>
          </div>

          <form
            onSubmit={handleSaveBodyProfile}
            className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Height (cm)', bpHeight, setBpHeight],
                ['Chest (cm)', bpChest, setBpChest],
                ['Waist (cm)', bpWaist, setBpWaist],
                ['Hips (cm)', bpHips, setBpHips],
                ['Inseam (cm)', bpInseam, setBpInseam],
                ['Shoulder (cm)', bpShoulder, setBpShoulder],
              ].map(([label, val, setter]: any) => (
                <div key={label}>
                  <label className="mb-1 block text-xs text-[var(--nx-text-secondary)]">{label}</label>
                  <input
                    type="number"
                    step="0.5"
                    value={val}
                    onChange={(e) => setter(e.target.value)}
                    className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
                  />
                </div>
              ))}
            </div>

            <label className="flex items-start gap-2 text-xs text-[var(--nx-text-secondary)]">
              <input type="checkbox" checked={bpConsent} onChange={(e) => setBpConsent(e.target.checked)} className="mt-0.5" />
              <span>I explicitly consent to storing my manual measurements privately on my Nexora account.</span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className="rounded-xl bg-[#790B13] px-4 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]">
                Save private measurements
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleEstimateBody}
                className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--nx-text)]"
              >
                Run calibrated estimator
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDeleteBodyProfile}
                className="rounded-xl border border-red-600/35 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                Delete body data &amp; media
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 5: 6.5 AI RUNWAY EXPERIENCE */}
      {activeTab === 'runway' && (
        <div className="space-y-5">
          {status?.videoRunway && (
            <div className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-4 py-3 text-xs">
              <strong className="text-[var(--nx-text)]">
                AI Video Runway adapter:{' '}
                {status.videoRunway.configured ? 'Connected' : 'Requires configuration'}
              </strong>
              <p className="mt-1 text-[var(--nx-text-secondary)]">{status.videoRunway.reason}</p>
            </div>
          )}

          <form
            onSubmit={handleCreateRunway}
            className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5"
          >
            <h2 className="text-base font-semibold text-[var(--nx-text)]">Create AI Runway scene</h2>
            <p className="text-xs text-[var(--nx-text-secondary)]">
              Uses your selected lookbook photo ({selectedPhotoId || 'none selected'}) and selected Shop items ({selectedProductIds.length}).
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="text"
                value={runwayName}
                onChange={(e) => setRunwayName(e.target.value)}
                placeholder="Runway title"
                className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              />
              <select
                value={runwayStyle}
                onChange={(e) => setRunwayStyle(e.target.value)}
                className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              >
                {['Luxury', 'Minimal Studio', 'Editorial Shoot', 'Urban', 'Traditional'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={runwayEnv}
                onChange={(e) => setRunwayEnv(e.target.value)}
                className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-sm text-[var(--nx-text)]"
              >
                {['Daylight Studio', 'Monochrome Loft', 'Milan Courtyard', 'Concrete Gallery', 'Heritage Archway'].map((env) => (
                  <option key={env} value={env}>{env}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl bg-[#790B13] px-4 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]">
              <Film className="h-3.5 w-3.5" />
              <span>Submit runway job</span>
            </button>
          </form>

          <div className="grid gap-3 md:grid-cols-2">
            {runwayJobs.map((rj) => (
              <div key={rj.id} className="flex items-start justify-between rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="text-sm text-[var(--nx-text)]">{rj.name}</strong>
                    <span className="rounded bg-[#B45309]/15 px-2 py-0.5 font-semibold text-[#B45309] dark:text-amber-300">{rj.jobStatus}</span>
                  </div>
                  <div className="mt-1 text-[var(--nx-text-secondary)]">
                    {rj.runwayStyle} · {rj.environment} · {rj.productIds.length} product(s)
                  </div>
                  {rj.providerMessage && <p className="mt-1 text-[11px] text-[var(--nx-text-secondary)]">{rj.providerMessage}</p>}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void apiV1Request(`/studio/runway/${rj.id}`, { method: 'DELETE' }).then(() =>
                      setRunwayJobs((p) => p.filter((x) => x.id !== rj.id))
                    )
                  }
                  className="text-[var(--nx-text-secondary)] hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: WORKFLOW AUDIT LOG */}
      {activeTab === 'workflows' && (
        <section className="space-y-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-5">
          <h2 className="text-base font-semibold text-[var(--nx-text)]">Internal workflow audit log</h2>
          {workflowJobs.length === 0 ? (
            <p className="text-xs text-[var(--nx-text-secondary)]">No workflow jobs recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {workflowJobs.map((job) => (
                <div key={job.id} className="rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-[var(--nx-text)]">{job.jobType}</span>
                      <span className="rounded bg-[#790B13]/12 px-2 py-0.5 text-[11px] font-semibold text-[#790B13] dark:bg-[#790B13]/25 dark:text-[#FFF0DC]">
                        {job.status}
                      </span>
                      {job.errorCode && (
                        <span className="rounded bg-[#B45309]/15 px-2 py-0.5 text-[11px] text-[#B45309] dark:text-amber-300">
                          {job.errorCode}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] tabular-nums text-[var(--nx-text-secondary)]">
                      {new Date(job.createdAtMs).toLocaleString()}
                    </span>
                  </div>
                  {Array.isArray(job.steps) && job.steps.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {job.steps.map((s, idx) => (
                        <span key={`${s.toolName}-${idx}`} className="rounded border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)]">
                          {s.toolName}: {s.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
