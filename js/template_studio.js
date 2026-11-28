import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase.js';
import { getActiveIdToken } from './session.js';
import { formatFriendlyError } from './notifications.js';
import { svgIcon } from './icons.js';
import { renderUserAvatarHtml } from './profile.js';
import {
  compressImageFile,
  estimateJsonByteSize,
  extractHashtags,
  formatCompactCount,
  formatRelativeTime,
} from './social_utils.js';
import {
  TEMPLATE_ASPECT_RATIOS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_FONT_FAMILIES,
  TEMPLATE_STICKERS,
  TEMPLATE_STYLES,
  cloneTemplateForUser,
  createBlankTemplateData,
  createHistoryStack,
  createNewLayer,
  deepCloneTemplateData,
  filterAndSortTemplates,
  normalizeTemplateData,
  resolveDimensionsForRatio,
} from './template_schema.js';
import { STARTER_TEMPLATES } from './template_library.js';
import {
  exportTemplateImageDataUrl,
  renderTemplateThumbnailDataUrl,
  renderTemplateToCanvas,
  triggerTemplateDownload,
} from './template_renderer.js';

const DRAFT_STORAGE_PREFIX = 'nexora_tpl_draft_v1:';
const STARTER_LIKES_PREFIX = 'nexora_tpl_starter_likes_v1:';
const STUDIO_PAGE_SIZE = 12;

export function createTemplateStudioModule(ctx) {
  const {
    state,
    profile,
    directoryMap,
    isAdmin = () => false,
    showToast,
    escapeHtml,
    navigateTo,
    openDirectMessageWithUser,
    requestSocialRender = () => {},
  } = ctx;

  let currentUser = null;
  let activeSubView = 'discover'; // discover | featured | categories | my | saved | recent | community | ai | editor
  let searchQuery = '';
  let filterCategory = 'All';
  let filterStyle = 'All';
  let filterRatio = 'All';
  let sortBy = 'trending';
  let pageLimit = STUDIO_PAGE_SIZE;

  // Firestore real-time state
  const publicTemplatesMap = new Map();
  const myTemplatesMap = new Map();
  const adminTemplatesMap = new Map();
  const myLikedIds = new Set();
  const mySavedDocs = new Map();
  const starterLikesSet = new Set();
  let recentUsages = [];
  let customCategories = [];
  let templateReports = [];
  let serverProviders = [];
  let firestoreProviderSettings = [];
  let platformGeminiConfigured = false;
  let providersLoading = false;

  // Subscriptions
  let unsubPublicTpls = null;
  let unsubMyTpls = null;
  let unsubMyLikes = null;
  let unsubMySaves = null;
  let unsubMyUsage = null;
  let unsubCategories = null;
  let unsubAiSettings = null;
  let unsubAdminTpls = null;
  let unsubReports = null;

  // AI Generator state
  const aiForm = {
    providerConfigId: 'platform',
    prompt: '',
    templateName: '',
    category: 'Social Media Posts',
    style: 'Modern',
    aspectRatio: '1:1',
    customWidth: 1080,
    customHeight: 1080,
    primaryColor: '#701CFF',
    secondaryColor: '#286BFF',
    accentColor: '#F43F5E',
    backgroundType: 'gradient',
    fontPreference: 'Plus Jakarta Sans',
    variationCount: 2,
    referenceImageDataUrl: '',
    generateImageAsset: false,
  };
  let aiGenerating = false;
  let aiError = '';
  let aiWarnings = [];
  let aiResults = [];

  // Visual Canvas Editor state
  let editorMeta = {
    id: '',
    isPersisted: false,
    title: 'Untitled NEXORA Design',
    description: '',
    category: 'Social Media Posts',
    style: 'Modern',
    tags: [],
    visibility: 'private',
    allowRemix: true,
    usagePermission: 'public_remix',
    aiGenerated: false,
    aiProvider: '',
    sourceTemplateId: '',
    isFeatured: false,
    likesCount: 0,
    savesCount: 0,
    usesCount: 0,
  };
  let editorData = createBlankTemplateData();
  let historyStack = createHistoryStack(editorData, 50);
  let selectedLayerId = editorData.layers[2]?.id || editorData.layers[0]?.id || '';
  let zoomMode = 'fit'; // 'fit' | '50' | '75' | '100'
  let autosaveState = 'saved'; // 'saved' | 'unsaved' | 'saving' | 'failed'
  let autosaveTimer = null;
  let inlineEditLayerId = '';
  let pendingPreviewTemplateId = '';

  // Modals managed cleanly inside Studio
  let activeModal = null; // null | { type: 'ai-setup' | 'preview' | 'save' | 'export' | 'publish-post' | 'publish-story' | 'share' | 'report', ... }
  let providerForm = createEmptyProviderForm();
  let providerTestResult = null;
  let providerTesting = false;
  let providerSaving = false;

  // Render queue for <canvas> preview thumbnails
  let thumbRenderToken = 0;

  function createEmptyProviderForm() {
    return {
      id: '',
      provider: 'gemini',
      label: 'My Gemini Key',
      apiKey: '',
      baseUrl: '',
      textModel: 'gemini-4-hydrogen',
      imageModel: 'gemini-3.1-flash-lite-image',
      isDefault: true,
    };
  }

  function tsMillis(ts, fallback = 0) {
    if (!ts) return fallback;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return Number(ts) || fallback;
  }

  async function getAuthHeaders() {
    const token = await getActiveIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  function loadStarterLikesFromLocal(uid) {
    starterLikesSet.clear();
    if (!uid) return;
    try {
      const raw = JSON.parse(localStorage.getItem(`${STARTER_LIKES_PREFIX}${uid}`) || '[]');
      if (Array.isArray(raw)) raw.forEach((id) => starterLikesSet.add(String(id)));
    } catch {}
  }

  function saveStarterLikesToLocal() {
    if (!currentUser) return;
    try {
      localStorage.setItem(`${STARTER_LIKES_PREFIX}${currentUser.uid}`, JSON.stringify(Array.from(starterLikesSet)));
    } catch {}
  }

  function getMergedCategoriesList() {
    const base = [...TEMPLATE_CATEGORIES];
    const seen = new Set(base.map((c) => c.toLowerCase()));
    for (const c of customCategories) {
      if (c && c.active !== false && c.name && !seen.has(c.name.toLowerCase())) {
        seen.add(c.name.toLowerCase());
        base.push(c.name);
      }
    }
    return base;
  }

  function getAllDiscoverableTemplates() {
    const merged = new Map();
    for (const st of STARTER_TEMPLATES) {
      merged.set(st.id, { ...st, isStarter: true });
    }
    for (const [id, tpl] of publicTemplatesMap.entries()) {
      merged.set(id, tpl);
    }
    return Array.from(merged.values());
  }

  function findTemplateById(id) {
    if (!id) return null;
    if (myTemplatesMap.has(id)) return myTemplatesMap.get(id);
    if (publicTemplatesMap.has(id)) return publicTemplatesMap.get(id);
    if (adminTemplatesMap.has(id)) return adminTemplatesMap.get(id);
    return STARTER_TEMPLATES.find((s) => s.id === id) || null;
  }

  function isTemplateLiked(tplId) {
    if (!tplId) return false;
    if (tplId.startsWith('starter-')) return starterLikesSet.has(tplId);
    return myLikedIds.has(tplId);
  }

  function isTemplateSaved(tplId) {
    if (!tplId) return false;
    return mySavedDocs.has(tplId);
  }

  function mapTemplateDoc(docSnap) {
    const d = docSnap.data() || {};
    return {
      id: docSnap.id,
      ...d,
      templateData: normalizeTemplateData(d.templateData),
      createdAtMs: tsMillis(d.createdAt, 0),
      updatedAtMs: tsMillis(d.updatedAt, 0),
    };
  }

  function getProvidersCombined() {
    const map = new Map();
    for (const p of firestoreProviderSettings) {
      if (p && p.id) map.set(p.id, p);
    }
    for (const p of serverProviders) {
      if (p && p.id) map.set(p.id, p);
    }
    return Array.from(map.values());
  }

  async function refreshServerProviders() {
    if (!currentUser) return;
    providersLoading = true;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/ai-providers', { headers });
      if (res.ok) {
        const data = await res.json();
        platformGeminiConfigured = Boolean(data.platformGeminiConfigured);
        serverProviders = Array.isArray(data.providers) ? data.providers : [];
        if (aiForm.providerConfigId === 'platform' && !platformGeminiConfigured && serverProviders.length > 0) {
          const def = serverProviders.find((p) => p.isDefault) || serverProviders[0];
          if (def?.id) aiForm.providerConfigId = def.id;
        }
      }
    } catch {
      // keep existing state cleanly
    } finally {
      providersLoading = false;
      requestSocialRender();
    }
  }

  function subscribeAll(fbUser) {
    cleanup();
    currentUser = fbUser;
    if (!fbUser) return;

    loadStarterLikesFromLocal(fbUser.uid);

    if (fbUser.isNexoraAccount) {
      void refreshServerProviders();
      requestSocialRender();
      return;
    }

    unsubPublicTpls = onSnapshot(
      query(
        collection(db, 'templates'),
        where('visibility', '==', 'public'),
        where('status', '==', 'active'),
        limit(150)
      ),
      (snap) => {
        publicTemplatesMap.clear();
        snap.forEach((d) => publicTemplatesMap.set(d.id, mapTemplateDoc(d)));
        if (pendingPreviewTemplateId) {
          const hit = findTemplateById(pendingPreviewTemplateId);
          if (hit) {
            pendingPreviewTemplateId = '';
            activeModal = { type: 'preview', template: hit };
          }
        }
        requestSocialRender();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'templates', { silent: true });
      }
    );

    unsubMyTpls = onSnapshot(
      query(collection(db, 'templates'), where('creatorId', '==', fbUser.uid), limit(100)),
      (snap) => {
        myTemplatesMap.clear();
        snap.forEach((d) => myTemplatesMap.set(d.id, mapTemplateDoc(d)));
        if (pendingPreviewTemplateId) {
          const hit = findTemplateById(pendingPreviewTemplateId);
          if (hit) {
            pendingPreviewTemplateId = '';
            activeModal = { type: 'preview', template: hit };
          }
        }
        requestSocialRender();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'templates', { silent: true });
      }
    );

    unsubMyLikes = onSnapshot(
      query(collection(db, 'template_likes'), where('userId', '==', fbUser.uid), limit(200)),
      (snap) => {
        myLikedIds.clear();
        snap.forEach((d) => {
          const tid = d.data()?.templateId;
          if (tid) myLikedIds.add(tid);
        });
        requestSocialRender();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'template_likes', { silent: true });
      }
    );

    unsubMySaves = onSnapshot(
      query(collection(db, 'template_saves'), where('userId', '==', fbUser.uid), limit(200)),
      (snap) => {
        mySavedDocs.clear();
        snap.forEach((d) => {
          const data = d.data() || {};
          if (data.templateId) mySavedDocs.set(data.templateId, { id: d.id, ...data, createdAtMs: tsMillis(data.createdAt, 0) });
        });
        requestSocialRender();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'template_saves', { silent: true });
      }
    );

    unsubMyUsage = onSnapshot(
      query(collection(db, 'template_usage'), where('userId', '==', fbUser.uid), limit(150)),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data(), createdAtMs: tsMillis(d.data()?.createdAt, 0) }));
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        recentUsages = list;
        requestSocialRender();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'template_usage', { silent: true });
      }
    );

    unsubCategories = onSnapshot(
      query(collection(db, 'template_categories'), where('sortOrder', '>=', 0), limit(60)),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
        customCategories = list;
        requestSocialRender();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'template_categories', { silent: true });
      }
    );

    unsubAiSettings = onSnapshot(
      query(collection(db, 'ai_provider_settings'), where('userId', '==', fbUser.uid), limit(30)),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        firestoreProviderSettings = list;
        requestSocialRender();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'ai_provider_settings', { silent: true });
      }
    );

    if (isAdmin()) {
      subscribeAdminModeration();
    }

    refreshServerProviders();
  }

  function subscribeAdminModeration() {
    if (!currentUser || !isAdmin()) return;
    if (!unsubAdminTpls) {
      unsubAdminTpls = onSnapshot(
        query(collection(db, 'templates'), where('status', 'in', ['active', 'hidden', 'removed']), limit(150)),
        (snap) => {
          adminTemplatesMap.clear();
          snap.forEach((d) => adminTemplatesMap.set(d.id, mapTemplateDoc(d)));
          requestSocialRender();
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'templates', { silent: true });
        }
      );
    }
    if (!unsubReports) {
      unsubReports = onSnapshot(
        query(collection(db, 'template_reports'), where('status', 'in', ['open', 'resolved', 'dismissed']), limit(100)),
        (snap) => {
          const list = [];
          snap.forEach((d) => list.push({ id: d.id, ...d.data(), createdAtMs: tsMillis(d.data()?.createdAt, 0) }));
          list.sort((a, b) => b.createdAtMs - a.createdAtMs);
          templateReports = list;
          requestSocialRender();
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'template_reports', { silent: true });
        }
      );
    }
  }

  function cleanup() {
    if (unsubPublicTpls) { unsubPublicTpls(); unsubPublicTpls = null; }
    if (unsubMyTpls) { unsubMyTpls(); unsubMyTpls = null; }
    if (unsubMyLikes) { unsubMyLikes(); unsubMyLikes = null; }
    if (unsubMySaves) { unsubMySaves(); unsubMySaves = null; }
    if (unsubMyUsage) { unsubMyUsage(); unsubMyUsage = null; }
    if (unsubCategories) { unsubCategories(); unsubCategories = null; }
    if (unsubAiSettings) { unsubAiSettings(); unsubAiSettings = null; }
    if (unsubAdminTpls) { unsubAdminTpls(); unsubAdminTpls = null; }
    if (unsubReports) { unsubReports(); unsubReports = null; }
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }

    publicTemplatesMap.clear();
    myTemplatesMap.clear();
    adminTemplatesMap.clear();
    myLikedIds.clear();
    mySavedDocs.clear();
    starterLikesSet.clear();
    recentUsages = [];
    customCategories = [];
    templateReports = [];
    serverProviders = [];
    firestoreProviderSettings = [];
    aiResults = [];
    aiError = '';
    aiWarnings = [];
    activeModal = null;
    currentUser = null;
  }

  /* ---------- FIRESTORE WRITES FOR TEMPLATES & ENGAGEMENT ---------- */

  function sanitizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of tags) {
      const clean = String(raw || '').trim().toLowerCase().replace(/^#/, '').slice(0, 32);
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
      if (out.length >= 10) break;
    }
    return out;
  }

  function buildTemplateCreateDoc(meta, data, previewUrl) {
    const normalized = normalizeTemplateData(data);
    return {
      id: meta.id,
      title: String(meta.title || 'Untitled Design').trim().slice(0, 120) || 'Untitled Design',
      description: String(meta.description || '').trim().slice(0, 600),
      category: String(meta.category || 'Social Media Posts').slice(0, 60),
      style: String(meta.style || 'Modern').slice(0, 40),
      aspectRatio: String(normalized.aspectRatio || '1:1').slice(0, 20),
      tags: sanitizeTags(meta.tags),
      previewImageUrl: String(previewUrl || '').slice(0, 420000),
      templateData: normalized,
      creatorId: currentUser.uid,
      creatorName: String(profile.displayName || 'Creator').slice(0, 120),
      creatorUsername: String(profile.username || 'creator').slice(0, 50),
      creatorAvatar: String(profile.avatar || '').slice(0, 200000),
      creatorVerified: Boolean(profile.verified || isAdmin()),
      visibility: meta.visibility === 'public' ? 'public' : 'private',
      status: 'active',
      isFeatured: false,
      allowRemix: meta.allowRemix !== false,
      usagePermission: ['public_remix', 'view_only', 'owner_only'].includes(meta.usagePermission)
        ? meta.usagePermission
        : 'public_remix',
      aiGenerated: Boolean(meta.aiGenerated),
      aiProvider: String(meta.aiProvider || '').slice(0, 40),
      sourceTemplateId: String(meta.sourceTemplateId || '').slice(0, 128),
      likesCount: 0,
      savesCount: 0,
      usesCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  }

  async function saveEditorToFirestore({ asNewCopy = false } = {}) {
    if (!currentUser) return false;
    autosaveState = 'saving';
    updateAutosaveDom();

    try {
      const normalized = normalizeTemplateData(editorData);
      const thumbUrl = await renderTemplateThumbnailDataUrl(normalized, { maxDim: 440, mime: 'image/jpeg', quality: 0.74 });
      const targetId =
        asNewCopy || !editorMeta.isPersisted || !editorMeta.id
          ? `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : editorMeta.id;

      if (asNewCopy || !editorMeta.isPersisted) {
        const nextMeta = { ...editorMeta, id: targetId };
        const createPayload = buildTemplateCreateDoc(nextMeta, normalized, thumbUrl);
        if (estimateJsonByteSize(createPayload) > 880000) {
          throw new Error('Template images exceed cloud sync budget (~880KB). Compress or remove heavy images.');
        }
        await setDoc(doc(db, 'templates', targetId), createPayload);
        clearDraftLocal(editorMeta.id || 'new');
        editorMeta = {
          ...nextMeta,
          isPersisted: true,
        };
      } else {
        const updatePayload = {
          title: String(editorMeta.title || 'Untitled Design').trim().slice(0, 120) || 'Untitled Design',
          description: String(editorMeta.description || '').trim().slice(0, 600),
          category: String(editorMeta.category || 'Social Media Posts').slice(0, 60),
          style: String(editorMeta.style || 'Modern').slice(0, 40),
          aspectRatio: String(normalized.aspectRatio || '1:1').slice(0, 20),
          tags: sanitizeTags(editorMeta.tags),
          previewImageUrl: String(thumbUrl || '').slice(0, 420000),
          templateData: normalized,
          visibility: editorMeta.visibility === 'public' ? 'public' : 'private',
          allowRemix: editorMeta.allowRemix !== false,
          usagePermission: ['public_remix', 'view_only', 'owner_only'].includes(editorMeta.usagePermission)
            ? editorMeta.usagePermission
            : 'public_remix',
          updatedAt: serverTimestamp(),
        };
        if (estimateJsonByteSize(updatePayload) > 880000) {
          throw new Error('Template size is too large for Firestore sync.');
        }
        await updateDoc(doc(db, 'templates', targetId), updatePayload);
        clearDraftLocal(targetId);
      }

      autosaveState = 'saved';
      updateAutosaveDom();
      return true;
    } catch (err) {
      autosaveState = 'failed';
      updateAutosaveDom();
      handleFirestoreError(err, OperationType.UPDATE, `templates/${editorMeta.id || 'new'}`, { silent: true });
      showToast(formatFriendlyError(err, 'Could not save template to cloud.'), 'error');
      return false;
    }
  }

  async function recordTemplateUsage(templateId, action = 'use', targetPostId = '') {
    if (!currentUser || !templateId || String(templateId).startsWith('starter-')) return;
    try {
      const usageId = `usg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const payload = {
        id: usageId,
        templateId,
        userId: currentUser.uid,
        action,
        createdAt: serverTimestamp(),
      };
      if (targetPostId) payload.targetPostId = targetPostId;
      await setDoc(doc(db, 'template_usage', usageId), payload);
      if (action === 'use' || action === 'remix') {
        const tplRef = doc(db, 'templates', templateId);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(tplRef);
          if (!snap.exists()) return;
          const cur = Math.max(0, Number(snap.data().usesCount || 0));
          tx.update(tplRef, { usesCount: cur + 1, updatedAt: serverTimestamp() });
        });
      }
    } catch {}
  }

  async function toggleTemplateLike(tplId) {
    if (!currentUser || !tplId) return;
    if (tplId.startsWith('starter-')) {
      if (starterLikesSet.has(tplId)) {
        starterLikesSet.delete(tplId);
      } else {
        starterLikesSet.add(tplId);
      }
      saveStarterLikesToLocal();
      requestSocialRender();
      return;
    }
    const likeId = `${tplId}__${currentUser.uid}`;
    const tplRef = doc(db, 'templates', tplId);
    const likeRef = doc(db, 'template_likes', likeId);
    try {
      await runTransaction(db, async (tx) => {
        const [tplSnap, likeSnap] = await Promise.all([tx.get(tplRef), tx.get(likeRef)]);
        if (!tplSnap.exists()) return;
        const cur = Math.max(0, Number(tplSnap.data().likesCount || 0));
        if (likeSnap.exists()) {
          tx.delete(likeRef);
          tx.update(tplRef, { likesCount: Math.max(0, cur - 1), updatedAt: serverTimestamp() });
        } else {
          tx.set(likeRef, {
            id: likeId,
            templateId: tplId,
            userId: currentUser.uid,
            displayName: String(profile.displayName || 'Member').slice(0, 120),
            createdAt: serverTimestamp(),
          });
          tx.update(tplRef, { likesCount: cur + 1, updatedAt: serverTimestamp() });
        }
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `templates/${tplId}`, 'Could not update template like.');
    }
  }

  async function toggleTemplateSave(tplId) {
    if (!currentUser || !tplId) return;
    const tpl = findTemplateById(tplId);
    if (!tpl) return;

    if (tplId.startsWith('starter-')) {
      // Built-in starter templates live outside Firestore; clone directly into user's My Templates collection
      const cloned = cloneTemplateForUser(tpl, profile);
      cloned.title = tpl.title;
      try {
        const thumbUrl = await renderTemplateThumbnailDataUrl(cloned.templateData, { maxDim: 420, mime: 'image/jpeg', quality: 0.74 });
        const payload = buildTemplateCreateDoc(cloned, cloned.templateData, thumbUrl);
        await setDoc(doc(db, 'templates', cloned.id), payload);
        showToast(`Saved "${tpl.title}" to My Templates!`, 'success');
      } catch (err) {
        showToast(formatFriendlyError(err, 'Could not save starter template copy.'), 'error');
      }
      return;
    }

    const saveId = `${tplId}__${currentUser.uid}`;
    const tplRef = doc(db, 'templates', tplId);
    const saveRef = doc(db, 'template_saves', saveId);
    try {
      await runTransaction(db, async (tx) => {
        const [tplSnap, saveSnap] = await Promise.all([tx.get(tplRef), tx.get(saveRef)]);
        if (!tplSnap.exists()) return;
        const cur = Math.max(0, Number(tplSnap.data().savesCount || 0));
        if (saveSnap.exists()) {
          tx.delete(saveRef);
          tx.update(tplRef, { savesCount: Math.max(0, cur - 1), updatedAt: serverTimestamp() });
        } else {
          tx.set(saveRef, {
            id: saveId,
            templateId: tplId,
            userId: currentUser.uid,
            title: String(tpl.title || 'Template').slice(0, 120),
            category: String(tpl.category || 'Custom').slice(0, 60),
            previewImageUrl: String(tpl.previewImageUrl || '').slice(0, 420000),
            createdAt: serverTimestamp(),
          });
          tx.update(tplRef, { savesCount: cur + 1, updatedAt: serverTimestamp() });
        }
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `templates/${tplId}`, 'Could not update saved templates.');
    }
  }

  async function deleteOwnTemplate(tplId) {
    if (!currentUser || !tplId) return;
    try {
      await deleteDoc(doc(db, 'templates', tplId));
      if (editorMeta.id === tplId) {
        editorMeta.id = '';
        editorMeta.isPersisted = false;
      }
      if (activeModal?.template?.id === tplId) activeModal = null;
      showToast('Template deleted', 'success');
      requestSocialRender();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `templates/${tplId}`, 'Could not delete template.');
    }
  }

  /* ---------- EDITOR STATE & HISTORY MANAGEMENT ---------- */

  function getDraftStorageKey(tplId = 'new') {
    return `${DRAFT_STORAGE_PREFIX}${currentUser?.uid || 'anon'}:${tplId || 'new'}`;
  }

  function persistDraftLocal() {
    try {
      const key = getDraftStorageKey(editorMeta.id || 'new');
      localStorage.setItem(
        key,
        JSON.stringify({
          savedAtMs: Date.now(),
          meta: editorMeta,
          data: editorData,
        })
      );
    } catch {}
  }

  function clearDraftLocal(tplId = 'new') {
    try {
      localStorage.removeItem(getDraftStorageKey(tplId));
    } catch {}
  }

  function updateAutosaveDom() {
    const el = document.getElementById('nx-tpl-autosave-status');
    if (!el) return;
    el.className = `nx-tpl-autosave-pill ${autosaveState}`;
    el.textContent =
      autosaveState === 'saving'
        ? 'Saving...'
        : autosaveState === 'saved'
          ? editorMeta.isPersisted
            ? 'Saved to Cloud'
            : 'Draft Ready'
          : autosaveState === 'failed'
            ? 'Save Failed'
            : 'Unsaved Changes';
  }

  function commitEditorMutation(nextData, { pushHistory = true, redraw = true } = {}) {
    editorData = normalizeTemplateData(nextData);
    if (pushHistory) {
      historyStack.push(editorData);
    }
    persistDraftLocal();
    autosaveState = 'unsaved';
    updateAutosaveDom();

    if (autosaveTimer) clearTimeout(autosaveTimer);
    if (editorMeta.isPersisted && editorMeta.id) {
      autosaveTimer = setTimeout(() => {
        saveEditorToFirestore({ asNewCopy: false });
      }, 1500);
    }

    if (redraw) {
      drawEditorCanvas();
    }
  }

  function openTemplateInEditor(tpl, { cloneMode = true } = {}) {
    if (!tpl) return;
    if (tpl.allowRemix === false && tpl.creatorId !== currentUser?.uid && !tpl.isStarter) {
      showToast('This creator restricted remixing for this template.');
      return;
    }

    const canDirectEdit = !cloneMode && !tpl.isStarter && tpl.creatorId === currentUser?.uid;
    if (canDirectEdit) {
      editorMeta = {
        id: tpl.id,
        isPersisted: true,
        title: tpl.title || 'Untitled Design',
        description: tpl.description || '',
        category: tpl.category || 'Social Media Posts',
        style: tpl.style || 'Modern',
        tags: Array.isArray(tpl.tags) ? [...tpl.tags] : [],
        visibility: tpl.visibility || 'private',
        allowRemix: tpl.allowRemix !== false,
        usagePermission: tpl.usagePermission || 'public_remix',
        aiGenerated: Boolean(tpl.aiGenerated),
        aiProvider: tpl.aiProvider || '',
        sourceTemplateId: tpl.sourceTemplateId || '',
        isFeatured: Boolean(tpl.isFeatured),
        likesCount: Number(tpl.likesCount || 0),
        savesCount: Number(tpl.savesCount || 0),
        usesCount: Number(tpl.usesCount || 0),
      };
      editorData = deepCloneTemplateData(normalizeTemplateData(tpl.templateData));
    } else {
      const cloned = cloneTemplateForUser(tpl, profile);
      editorMeta = {
        id: '',
        isPersisted: false,
        title: cloned.title,
        description: cloned.description,
        category: cloned.category,
        style: cloned.style,
        tags: cloned.tags,
        visibility: 'private',
        allowRemix: true,
        usagePermission: 'public_remix',
        aiGenerated: cloned.aiGenerated,
        aiProvider: cloned.aiProvider,
        sourceTemplateId: tpl.isStarter ? '' : tpl.id,
        isFeatured: false,
        likesCount: 0,
        savesCount: 0,
        usesCount: 0,
      };
      editorData = cloned.templateData;
      if (!tpl.isStarter && tpl.id) {
        recordTemplateUsage(tpl.id, 'use');
      }
    }

    // Check if there is a newer crash-recovery draft for this template
    try {
      const rawDraft = localStorage.getItem(getDraftStorageKey(editorMeta.id || 'new'));
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed?.data && Number(parsed.savedAtMs || 0) > Date.now() - 24 * 60 * 60 * 1000) {
          editorData = normalizeTemplateData(parsed.data);
          showToast('Restored recent unsaved canvas edits from local recovery.');
        }
      }
    } catch {}

    historyStack.reset(editorData);
    selectedLayerId = editorData.layers[editorData.layers.length - 1]?.id || '';
    autosaveState = 'saved';
    inlineEditLayerId = '';
    activeModal = null;
    activeSubView = 'editor';
    requestSocialRender();
  }

  function createBlankInEditor() {
    editorData = createBlankTemplateData();
    editorMeta = {
      id: '',
      isPersisted: false,
      title: 'Untitled NEXORA Design',
      description: '',
      category: 'Social Media Posts',
      style: 'Modern',
      tags: [],
      visibility: 'private',
      allowRemix: true,
      usagePermission: 'public_remix',
      aiGenerated: false,
      aiProvider: '',
      sourceTemplateId: '',
      isFeatured: false,
      likesCount: 0,
      savesCount: 0,
      usesCount: 0,
    };
    historyStack.reset(editorData);
    selectedLayerId = editorData.layers[2]?.id || editorData.layers[0]?.id || '';
    autosaveState = 'saved';
    inlineEditLayerId = '';
    activeModal = null;
    activeSubView = 'editor';
    requestSocialRender();
  }

  function performUndo() {
    const prev = historyStack.undo();
    if (!prev) return;
    editorData = normalizeTemplateData(prev);
    if (!editorData.layers.some((l) => l.id === selectedLayerId)) {
      selectedLayerId = editorData.layers[0]?.id || '';
    }
    persistDraftLocal();
    autosaveState = 'unsaved';
    requestSocialRender();
  }

  function performRedo() {
    const next = historyStack.redo();
    if (!next) return;
    editorData = normalizeTemplateData(next);
    if (!editorData.layers.some((l) => l.id === selectedLayerId)) {
      selectedLayerId = editorData.layers[0]?.id || '';
    }
    persistDraftLocal();
    autosaveState = 'unsaved';
    requestSocialRender();
  }

  /* ---------- AI API SETUP & TEMPLATE GENERATION ---------- */

  async function saveProviderConfig() {
    if (!currentUser || providerSaving) return;
    providerSaving = true;
    providerTestResult = null;
    requestSocialRender();

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/ai-providers', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: providerForm.id || undefined,
          provider: providerForm.provider,
          label: providerForm.label,
          apiKey: providerForm.apiKey,
          baseUrl: providerForm.baseUrl,
          textModel: providerForm.textModel,
          imageModel: providerForm.imageModel,
          isDefault: Boolean(providerForm.isDefault),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        providerTestResult = { ok: false, error: data.error || 'Failed to save provider.' };
        showToast(providerTestResult.error, 'error');
        return;
      }

      const rec = data.provider;
      serverProviders = Array.isArray(data.providers) ? data.providers : serverProviders;
      aiForm.providerConfigId = rec.id;

      // Mirror strictly sanitized non-secret metadata into Firestore
      const fsDoc = {
        id: rec.id,
        userId: currentUser.uid,
        provider: rec.provider,
        label: rec.label,
        baseUrl: rec.baseUrl || '',
        textModel: rec.textModel,
        imageModel: rec.imageModel || '',
        keyMasked: rec.keyMasked || '',
        hasKey: Boolean(rec.hasKey),
        capabilities: rec.capabilities || {},
        isDefault: Boolean(rec.isDefault),
        lastStatus: rec.lastStatus || 'saved',
        lastError: rec.lastError || '',
        lastTestedAtMs: Number(rec.lastTestedAtMs || Date.now()),
        updatedAt: serverTimestamp(),
      };
      const existingSnap = await getDoc(doc(db, 'ai_provider_settings', rec.id));
      if (!existingSnap.exists()) {
        fsDoc.createdAt = serverTimestamp();
      } else {
        fsDoc.createdAt = existingSnap.data().createdAt || serverTimestamp();
      }
      await setDoc(doc(db, 'ai_provider_settings', rec.id), fsDoc);

      providerForm = createEmptyProviderForm();
      providerTestResult = { ok: true, model: rec.textModel, message: `Saved encrypted key (${rec.keyMasked}). Ready for AI generation.` };
      showToast('AI Provider encrypted and saved cleanly!', 'success');
    } catch (err) {
      providerTestResult = { ok: false, error: formatFriendlyError(err, 'Could not save AI provider.') };
      showToast(providerTestResult.error, 'error');
    } finally {
      providerSaving = false;
      requestSocialRender();
    }
  }

  async function testProviderConnection(configId = '') {
    if (!currentUser || providerTesting) return;
    providerTesting = true;
    providerTestResult = null;
    requestSocialRender();

    try {
      const headers = await getAuthHeaders();
      const payload = configId
        ? { configId }
        : {
            configId: providerForm.id || undefined,
            provider: providerForm.provider,
            apiKey: providerForm.apiKey,
            baseUrl: providerForm.baseUrl,
            textModel: providerForm.textModel,
            imageModel: providerForm.imageModel,
          };
      const res = await fetch('/api/ai-providers/test', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      providerTestResult = data;
      if (data.ok) {
        showToast(`Connected to ${data.model} in ${data.latencyMs}ms`, 'success');
        if (configId) {
          updateDoc(doc(db, 'ai_provider_settings', configId), {
            lastStatus: 'connected',
            lastError: '',
            lastTestedAtMs: Date.now(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      } else {
        showToast(data.error || 'Connection test failed', 'error');
      }
      await refreshServerProviders();
    } catch (err) {
      providerTestResult = { ok: false, error: formatFriendlyError(err, 'Connection test failed.') };
    } finally {
      providerTesting = false;
      requestSocialRender();
    }
  }

  async function deleteProviderConfig(configId) {
    if (!currentUser || !configId) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/ai-providers/${encodeURIComponent(configId)}`, {
        method: 'DELETE',
        headers,
      });
      await deleteDoc(doc(db, 'ai_provider_settings', configId)).catch(() => {});
      if (aiForm.providerConfigId === configId) {
        aiForm.providerConfigId = 'platform';
      }
      await refreshServerProviders();
      showToast('AI provider removed', 'success');
    } catch (err) {
      showToast(formatFriendlyError(err, 'Could not remove provider.'), 'error');
    }
  }

  async function runAiGeneration() {
    if (!currentUser || aiGenerating) return;
    if (!aiForm.prompt.trim() || aiForm.prompt.trim().length < 3) {
      aiError = 'Enter a descriptive prompt (at least 3 characters) describing your design.';
      requestSocialRender();
      return;
    }

    aiGenerating = true;
    aiError = '';
    aiWarnings = [];
    aiResults = [];
    requestSocialRender();

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/templates/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          providerConfigId: aiForm.providerConfigId || 'platform',
          prompt: aiForm.prompt.trim(),
          templateName: aiForm.templateName.trim(),
          category: aiForm.category,
          style: aiForm.style,
          aspectRatio: aiForm.aspectRatio,
          customWidth: aiForm.customWidth,
          customHeight: aiForm.customHeight,
          primaryColor: aiForm.primaryColor,
          secondaryColor: aiForm.secondaryColor,
          accentColor: aiForm.accentColor,
          backgroundType: aiForm.backgroundType,
          fontPreference: aiForm.fontPreference,
          variationCount: Number(aiForm.variationCount || 2),
          referenceImageDataUrl: aiForm.referenceImageDataUrl,
          generateImageAsset: Boolean(aiForm.generateImageAsset),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        aiError = data.error || 'AI template generation failed. Check your provider settings or retry.';
        showToast(aiError, 'error');
        return;
      }
      aiWarnings = Array.isArray(data.warnings) ? data.warnings : [];
      aiResults = (Array.isArray(data.templates) ? data.templates : []).map((t, idx) => ({
        ...t,
        id: `ai-var-${Date.now().toString(36)}-${idx}`,
        templateData: normalizeTemplateData(t.templateData),
        aiGenerated: true,
        aiProvider: data.providerUsed || 'gemini',
        creatorId: currentUser.uid,
        creatorName: profile.displayName || 'Creator',
        creatorUsername: profile.username || 'creator',
        allowRemix: true,
      }));
      if (aiResults.length === 0) {
        aiError = 'AI returned empty variations. Please refine your prompt and retry.';
      } else {
        showToast(`Generated ${aiResults.length} AI template variation${aiResults.length > 1 ? 's' : ''}!`, 'success');
      }
    } catch (err) {
      aiError = formatFriendlyError(err, 'Could not reach AI generation backend.');
    } finally {
      aiGenerating = false;
      requestSocialRender();
    }
  }

  /* ---------- PUBLISH TO NEXORA POST / STORY / DM ---------- */

  async function publishTemplateAsPost({ caption = '', visibility = 'public' } = {}) {
    if (!currentUser) return;
    try {
      const { dataUrl } = await exportTemplateImageDataUrl(editorData, { format: 'jpg', quality: 0.84, scale: 1 });
      const boundedImg = dataUrl.length > 360000
        ? await renderTemplateThumbnailDataUrl(editorData, { maxDim: 920, mime: 'image/jpeg', quality: 0.72 })
        : dataUrl;

      const revTs = String(Math.max(0, 9999999999999 - Date.now())).padStart(13, '0');
      const postId = `pst-0-${revTs}-${Math.random().toString(36).slice(2, 6)}`;
      const cleanCaption = String(caption || editorMeta.title || 'Created with NEXORA AI Template Studio').trim().slice(0, 4000);
      const vis = ['public', 'followers', 'private'].includes(visibility) ? visibility : 'public';

      const payload = {
        id: postId,
        authorId: currentUser.uid,
        authorName: String(profile.displayName || 'Member').slice(0, 120),
        authorUsername: String(profile.username || 'member').slice(0, 50),
        authorInitials: String(profile.initials || 'NX').slice(0, 16),
        authorAvatar: String(profile.avatar || '').slice(0, 200000),
        authorVerified: Boolean(profile.verified || isAdmin()),
        content: cleanCaption,
        mediaType: 'image',
        mediaItems: [{ type: 'image', url: boundedImg }],
        feeling: 'Created with Template Studio ✨',
        location: '',
        hashtags: extractHashtags(cleanCaption),
        mentions: [],
        visibility: vis,
        likesUids: [],
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        edited: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const userRef = doc(db, 'users', currentUser.uid);
      const postRef = doc(db, 'posts', postId);
      await runTransaction(db, async (tx) => {
        const userSnap = await tx.get(userRef);
        const currentCount = userSnap.exists() ? Math.max(0, Number(userSnap.data().postsCount || 0)) : 0;
        tx.set(postRef, payload);
        if (userSnap.exists()) {
          tx.update(userRef, { postsCount: currentCount + 1, updatedAt: serverTimestamp() });
        }
      });

      if (editorMeta.isPersisted && editorMeta.id) {
        recordTemplateUsage(editorMeta.id, 'publish_post', postId);
      }
      activeModal = null;
      showToast('Published template artwork to NEXORA Feed!', 'success');
      navigateTo('home');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'posts', 'Could not publish template post.');
    }
  }

  async function publishTemplateAsStory({ caption = '' } = {}) {
    if (!currentUser) return;
    try {
      const thumbUrl = await renderTemplateThumbnailDataUrl(editorData, { maxDim: 960, mime: 'image/jpeg', quality: 0.78 });
      const sid = `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'stories', sid), {
        id: sid,
        userId: currentUser.uid,
        userName: String(profile.displayName || 'Member').slice(0, 120),
        userAvatar: String(profile.avatar || '').slice(0, 200000),
        userInitials: String(profile.initials || 'NX').slice(0, 16),
        mediaType: 'image',
        mediaUrl: String(thumbUrl).slice(0, 420000),
        content: String(caption || editorMeta.title || 'New Template Story ✨').slice(0, 400),
        bgGradient: '',
        sticker: '',
        reactions: {},
        viewsCount: 0,
        createdAt: serverTimestamp(),
        expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
      });
      if (editorMeta.isPersisted && editorMeta.id) {
        recordTemplateUsage(editorMeta.id, 'publish_story');
      }
      activeModal = null;
      showToast('Published to 24-Hour Stories!', 'success');
      navigateTo('home');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'stories', 'Could not publish story.');
    }
  }

  async function shareTemplateToDm(dmId, tpl) {
    if (!currentUser || !dmId || !tpl) return;
    const dm = (state.dms || []).find((d) => d.id === dmId);
    if (!dm) {
      showToast('Select a conversation first.');
      return;
    }
    const link = `${window.location.origin}/app.html#template-${tpl.id}`;
    const text = `Check out this NEXORA template "${tpl.title}" (${tpl.category} · ${tpl.aspectRatio}): ${link}`.slice(0, 2000);
    const msgId = `dmmsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'dm_threads', dm.id, 'messages', msgId), {
        id: msgId,
        threadId: dm.id,
        participantIds: dm.participants,
        senderId: currentUser.uid,
        senderName: String(profile.displayName || 'Member').slice(0, 50),
        senderInitials: String(profile.initials || 'NX').slice(0, 4),
        content: text,
        seenBy: [currentUser.uid],
        edited: false,
        pinned: false,
        reactions: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'dm_threads', dm.id), {
        lastMessage: `Shared template: ${tpl.title}`.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
      activeModal = null;
      showToast(`Shared template with ${dm.name || 'conversation'}!`, 'success');
      requestSocialRender();
    } catch (err) {
      showToast(formatFriendlyError(err, 'Could not share template via DM.'), 'error');
    }
  }

  async function submitTemplateReport({ templateId, templateTitle, reason, details }) {
    if (!currentUser || !templateId) return;
    const reportId = `trpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'template_reports', reportId), {
        id: reportId,
        templateId,
        templateTitle: String(templateTitle || 'Template').slice(0, 120),
        reporterId: currentUser.uid,
        reporterName: String(profile.displayName || 'Member').slice(0, 120),
        reason: String(reason || 'Inappropriate content').slice(0, 120),
        details: String(details || '').slice(0, 500),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      activeModal = null;
      showToast('Template report submitted for admin review.', 'success');
      requestSocialRender();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `template_reports/${reportId}`, 'Could not submit template report.');
    }
  }

  /* ---------- RENDERING HELPERS ---------- */

  function renderTemplateCardHtml(tpl, { compact = false } = {}) {
    const liked = isTemplateLiked(tpl.id);
    const saved = isTemplateSaved(tpl.id);
    const isMine = tpl.creatorId === currentUser?.uid && !tpl.isStarter;
    const creator = directoryMap.get(tpl.creatorId) || {
      id: tpl.creatorId,
      displayName: tpl.creatorName || 'Creator',
      username: tpl.creatorUsername || 'creator',
      avatar: tpl.creatorAvatar || '',
      initials: (tpl.creatorName || 'CR').slice(0, 2).toUpperCase(),
    };

    const previewSrc = tpl.previewImageUrl && tpl.previewImageUrl.startsWith('data:') ? tpl.previewImageUrl : '';

    return `
      <article class="nx-tpl-card" data-tpl-card="${escapeHtml(tpl.id)}">
        <div class="nx-tpl-card-media" style="cursor:pointer;" data-tpl-act="preview" data-tpl-id="${escapeHtml(tpl.id)}">
          <img
            src="${previewSrc ? escapeHtml(previewSrc) : ''}"
            alt="${escapeHtml(tpl.title)}"
            data-tpl-thumb-id="${escapeHtml(tpl.id)}"
            loading="lazy"
          />
          <div class="nx-tpl-card-badges">
            <span class="nx-tpl-badge">${escapeHtml(tpl.category)} · ${escapeHtml(tpl.aspectRatio || '1:1')}</span>
            <div style="display:flex;gap:4px;">
              ${tpl.aiGenerated ? `<span class="nx-tpl-badge">AI</span>` : ''}
              ${tpl.isFeatured ? `<span class="nx-tpl-badge featured">Featured</span>` : ''}
            </div>
          </div>
        </div>

        <div class="nx-tpl-card-body">
          <h4 class="nx-tpl-card-title" title="${escapeHtml(tpl.title)}">${escapeHtml(tpl.title)}</h4>
          <div class="nx-tpl-card-meta">
            ${
              tpl.creatorId && tpl.creatorId !== 'nexora-official'
                ? `<button type="button" class="nx-tpl-creator-btn" data-nx-act="view-user-profile" data-uid="${escapeHtml(tpl.creatorId)}">
                    ${renderUserAvatarHtml(creator, 20)}
                    <span>@${escapeHtml(creator.username || 'creator')}</span>
                  </button>`
                : `<span class="nx-tpl-creator-btn" style="cursor:default;"><span>@nexora_studio</span></span>`
            }
            <span>${escapeHtml(tpl.style || 'Modern')}</span>
          </div>
          ${
            !compact
              ? `<div class="nx-tpl-stats-row">
                  <span>${formatCompactCount(Number(tpl.likesCount || 0) + (tpl.isStarter && liked ? 1 : 0))} likes</span>
                  <span>${formatCompactCount(tpl.savesCount || 0)} saves</span>
                  <span>${formatCompactCount(tpl.usesCount || 0)} uses</span>
                </div>`
              : ''
          }
        </div>

        <div class="nx-tpl-card-actions">
          <div style="display:flex;gap:5px;">
            <button type="button" class="nx-tpl-icon-btn ${liked ? 'active' : ''}" data-tpl-act="toggle-like" data-tpl-id="${escapeHtml(tpl.id)}" title="Like template">
              ${svgIcon(liked ? 'heartFilled' : 'heart', 13)}
              <span>${formatCompactCount(Number(tpl.likesCount || 0) + (tpl.isStarter && liked ? 1 : 0))}</span>
            </button>
            <button type="button" class="nx-tpl-icon-btn ${saved ? 'active' : ''}" data-tpl-act="toggle-save" data-tpl-id="${escapeHtml(tpl.id)}" title="${tpl.isStarter ? 'Copy to My Templates' : 'Save template'}">
              ${svgIcon(saved ? 'bookmarkFilled' : 'bookmark', 13)}
            </button>
            <button type="button" class="nx-tpl-icon-btn" data-tpl-act="open-share" data-tpl-id="${escapeHtml(tpl.id)}" title="Share template">
              ${svgIcon('share', 13)}
            </button>
          </div>
          <div style="display:flex;gap:5px;">
            ${
              isMine
                ? `<button type="button" class="nx-tpl-icon-btn" data-tpl-act="edit-own" data-tpl-id="${escapeHtml(tpl.id)}" title="Edit template">${svgIcon('edit', 13)}</button>`
                : ''
            }
            <button type="button" class="nx-btn-grad" style="height:31px;padding:0 11px;font-size:0.75rem;" data-tpl-act="use-template" data-tpl-id="${escapeHtml(tpl.id)}">
              Use Template
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderStudioHeroAndTabs() {
    const subTabs = [
      { id: 'discover', label: 'Discover' },
      { id: 'ai', label: 'Create with AI', icon: 'sparkles' },
      { id: 'editor', label: 'Canvas Editor', icon: 'pen' },
      { id: 'my', label: `My Templates (${myTemplatesMap.size})` },
      { id: 'saved', label: `Saved (${mySavedDocs.size})` },
      { id: 'recent', label: 'Recently Used' },
      { id: 'categories', label: 'Categories' },
      { id: 'community', label: 'Community Templates' },
    ];

    const providers = getProvidersCombined();
    const activeProv =
      aiForm.providerConfigId === 'platform'
        ? platformGeminiConfigured
          ? 'Platform Gemini Ready'
          : 'No Key Configured'
        : providers.find((p) => p.id === aiForm.providerConfigId)?.label || 'Custom AI Provider';

    return `
      <section class="nx-tpl-hero">
        <div>
          <h1 class="nx-tpl-hero-title">
            ${svgIcon('templates', 22)}
            <span>NEXORA Template Studio</span>
          </h1>
          <p class="nx-tpl-hero-sub">Design, generate with AI, customize every layer, export HD assets, and publish across NEXORA.</p>
        </div>
        <div class="nx-tpl-hero-actions">
          <button type="button" class="nx-btn-soft" data-tpl-act="open-ai-setup">
            ${svgIcon('sliders', 14)}
            <span>AI API Setup (${escapeHtml(activeProv)})</span>
          </button>
          <button type="button" class="nx-btn-soft" data-tpl-act="new-blank">
            ${svgIcon('plus', 14)}
            <span>Blank Canvas</span>
          </button>
          <button type="button" class="nx-btn-grad" data-tpl-act="switch-subview" data-subview="ai">
            ${svgIcon('sparkles', 14)}
            <span>Create with AI</span>
          </button>
        </div>
      </section>

      <nav class="nx-tpl-subnav" aria-label="Template Studio sections">
        ${subTabs
          .map(
            (t) => `
          <button type="button" class="nx-tpl-nav-tab ${activeSubView === t.id ? 'active' : ''}" data-tpl-act="switch-subview" data-subview="${t.id}">
            ${t.icon ? svgIcon(t.icon, 14) : ''}
            <span>${escapeHtml(t.label)}</span>
          </button>
        `
          )
          .join('')}
      </nav>
    `;
  }

  function renderFilterBar() {
    const categories = ['All', ...getMergedCategoriesList()];
    const styles = ['All', ...TEMPLATE_STYLES];
    const ratios = ['All', ...Object.keys(TEMPLATE_ASPECT_RATIOS)];

    return `
      <div class="nx-tpl-filter-bar">
        <input
          type="search"
          id="nx-tpl-search-input"
          class="input"
          placeholder="Search templates, categories, tags, creators..."
          value="${escapeHtml(searchQuery)}"
          aria-label="Search templates"
        />
        <select id="nx-tpl-filter-cat" class="select" aria-label="Filter category">
          ${categories.map((c) => `<option value="${escapeHtml(c)}" ${filterCategory === c ? 'selected' : ''}>${c === 'All' ? 'All Categories' : escapeHtml(c)}</option>`).join('')}
        </select>
        <select id="nx-tpl-filter-style" class="select" aria-label="Filter style">
          ${styles.map((s) => `<option value="${escapeHtml(s)}" ${filterStyle === s ? 'selected' : ''}>${s === 'All' ? 'All Styles' : escapeHtml(s)}</option>`).join('')}
        </select>
        <select id="nx-tpl-filter-ratio" class="select" aria-label="Filter aspect ratio">
          ${ratios.map((r) => `<option value="${escapeHtml(r)}" ${filterRatio === r ? 'selected' : ''}>${r === 'All' ? 'All Ratios' : escapeHtml(r)}</option>`).join('')}
        </select>
        <select id="nx-tpl-filter-sort" class="select" aria-label="Sort templates">
          <option value="trending" ${sortBy === 'trending' ? 'selected' : ''}>Sort: Trending</option>
          <option value="most_used" ${sortBy === 'most_used' ? 'selected' : ''}>Sort: Most Used</option>
          <option value="most_liked" ${sortBy === 'most_liked' ? 'selected' : ''}>Sort: Most Liked</option>
          <option value="newest" ${sortBy === 'newest' ? 'selected' : ''}>Sort: Newest</option>
        </select>
      </div>

      <div class="nx-tpl-cat-rail" aria-label="Quick category filter">
        ${['All', ...getMergedCategoriesList()]
          .map(
            (c) => `
          <button type="button" class="nx-tpl-cat-chip ${filterCategory === c ? 'active' : ''}" data-tpl-act="quick-cat" data-cat="${escapeHtml(c)}">
            ${escapeHtml(c)}
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderDiscoveryView() {
    const allTemplates = getAllDiscoverableTemplates();
    const featured = allTemplates.filter((t) => t.isFeatured && t.status === 'active').slice(0, 6);

    let basePool = allTemplates;
    let heading = 'Trending & Discover Templates';

    if (activeSubView === 'my') {
      basePool = Array.from(myTemplatesMap.values());
      heading = 'My Templates';
    } else if (activeSubView === 'saved') {
      basePool = Array.from(mySavedDocs.keys())
        .map((tid) => findTemplateById(tid))
        .filter(Boolean);
      heading = 'Saved Templates';
    } else if (activeSubView === 'recent') {
      const seen = new Set();
      basePool = recentUsages
        .map((u) => findTemplateById(u.templateId))
        .filter((t) => {
          if (!t || seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
      heading = 'Recently Used Templates';
    } else if (activeSubView === 'community') {
      basePool = Array.from(publicTemplatesMap.values()).filter((t) => t.status === 'active');
      heading = 'Community Shared Templates';
    } else if (activeSubView === 'categories') {
      const cats = getMergedCategoriesList();
      const counts = new Map();
      for (const tpl of allTemplates) {
        counts.set(tpl.category, (counts.get(tpl.category) || 0) + 1);
      }
      return `
        ${renderFilterBar()}
        <section class="nx-tpl-panel">
          <div class="nx-tpl-section-head">
            <h2 class="nx-tpl-section-title">Browse All ${cats.length} Categories</h2>
            <span class="member-sub">Click any category to filter templates or launch AI generation directly.</span>
          </div>
          <div class="nx-tpl-grid">
            ${cats
              .map(
                (cat) => `
              <div class="nx-tpl-card" style="padding:14px;display:grid;gap:8px;">
                <strong style="font-size:0.95rem;">${escapeHtml(cat)}</strong>
                <span class="member-sub">${counts.get(cat) || 0} templates available</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
                  <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.75rem;" data-tpl-act="browse-category" data-cat="${escapeHtml(cat)}">Browse</button>
                  <button type="button" class="nx-btn-grad" style="height:30px;font-size:0.75rem;" data-tpl-act="ai-for-category" data-cat="${escapeHtml(cat)}">Generate AI</button>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </section>
      `;
    }

    const filtered = filterAndSortTemplates(basePool, {
      searchQuery,
      category: filterCategory,
      style: filterStyle,
      aspectRatio: filterRatio,
      sortBy,
      onlyPublic: activeSubView === 'discover' || activeSubView === 'community',
    });

    const visibleItems = filtered.slice(0, pageLimit);

    return `
      ${renderFilterBar()}

      ${
        activeSubView === 'discover' && !searchQuery && filterCategory === 'All' && featured.length > 0
          ? `<section style="display:grid;gap:10px;">
              <div class="nx-tpl-section-head">
                <h2 class="nx-tpl-section-title">Featured Studio Templates</h2>
                <span class="member-sub">Click Use Template to open any layout with full layer customization</span>
              </div>
              <div class="nx-tpl-featured-grid">
                ${featured.map((t) => renderTemplateCardHtml(t)).join('')}
              </div>
            </section>`
          : ''
      }

      <section style="display:grid;gap:10px;">
        <div class="nx-tpl-section-head">
          <h2 class="nx-tpl-section-title">${escapeHtml(heading)} (${filtered.length})</h2>
          ${
            activeSubView === 'community' && filtered.length === 0
              ? `<button type="button" class="nx-btn-grad" style="height:32px;font-size:0.78rem;" data-tpl-act="switch-subview" data-subview="ai">Create First Community Template</button>`
              : ''
          }
        </div>
        ${
          visibleItems.length > 0
            ? `<div class="nx-tpl-grid">
                ${visibleItems.map((t) => renderTemplateCardHtml(t)).join('')}
              </div>`
            : `<div class="nx-tpl-panel" style="text-align:center;padding:34px 20px;">
                <strong>No templates match the active filter</strong>
                <span class="member-sub">Try clearing your search filters, generating a custom design with AI, or starting from a blank canvas.</span>
              </div>`
        }
        ${
          filtered.length > visibleItems.length
            ? `<div style="display:flex;justify-content:center;padding-top:6px;">
                <button type="button" class="nx-btn-soft" data-tpl-act="show-more-templates">Show More Templates (${filtered.length - visibleItems.length} remaining)</button>
              </div>`
            : ''
        }
      </section>
    `;
  }

  function renderAiGeneratorView() {
    const providers = getProvidersCombined();
    const selectedSaved = providers.find((p) => p.id === aiForm.providerConfigId);
    const hasConfiguredAi = platformGeminiConfigured || providers.length > 0;
    const supportsImageAsset =
      aiForm.providerConfigId === 'platform'
        ? platformGeminiConfigured
        : Boolean(selectedSaved?.capabilities?.imageGeneration);

    const starterPrompts = [
      'Midnight neon product launch card with bold headline and discount sticker',
      'Clean editorial quote poster in high-contrast typography',
      'High-CTR YouTube coding tutorial thumbnail with punchy badge',
      'Festive music night event poster with vibrant magenta & electric blue',
    ];

    return `
      <div class="nx-tpl-ai-layout">
        <form class="nx-tpl-panel" id="nx-tpl-ai-form">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <h2 class="nx-tpl-section-title">AI Template Generator</h2>
            <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.74rem;" data-tpl-act="open-ai-setup">
              ${svgIcon('sliders', 13)} AI API Config
            </button>
          </div>

          ${
            !hasConfiguredAi
              ? `<div class="nx-tpl-alert warn">
                  <div>
                    <strong>No AI provider key configured yet.</strong>
                    <div>Connect your Gemini, OpenAI, or OpenAI-compatible API key in <em>AI API Setup</em> to run real AI template generation.</div>
                  </div>
                  <button type="button" class="nx-btn-grad" style="height:30px;font-size:0.74rem;flex-shrink:0;" data-tpl-act="open-ai-setup">Setup API</button>
                </div>`
              : ''
          }

          <label class="nx-tpl-field">
            <span class="nx-tpl-label">AI Provider</span>
            <select id="nx-ai-provider-select" class="select">
              ${
                platformGeminiConfigured
                  ? `<option value="platform" ${aiForm.providerConfigId === 'platform' ? 'selected' : ''}>NEXORA Platform Gemini AI (Server Managed)</option>`
                  : `<option value="platform" ${aiForm.providerConfigId === 'platform' ? 'selected' : ''}>Platform Gemini AI (Requires Server Key or Setup Below)</option>`
              }
              ${providers
                .map(
                  (p) =>
                    `<option value="${escapeHtml(p.id)}" ${aiForm.providerConfigId === p.id ? 'selected' : ''}>${escapeHtml(p.label)} (${escapeHtml(p.provider)} · ${escapeHtml(p.textModel)} · ${escapeHtml(p.keyMasked || 'saved')})</option>`
                )
                .join('')}
            </select>
          </label>

          <label class="nx-tpl-field">
            <span class="nx-tpl-label">Describe Your Template Design</span>
            <textarea id="nx-ai-prompt" class="textarea" rows="3" placeholder="e.g. Modern tech SaaS launch poster with dark violet background, white headline, CTA badge, and product showcase frame..." maxlength="2000" required>${escapeHtml(aiForm.prompt)}</textarea>
          </label>

          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${starterPrompts
              .map(
                (sp) =>
                  `<button type="button" class="nx-tpl-cat-chip" style="font-size:0.71rem;" data-tpl-act="fill-ai-prompt" data-prompt="${escapeHtml(sp)}">${escapeHtml(sp.slice(0, 38))}...</button>`
              )
              .join('')}
          </div>

          <label class="nx-tpl-field">
            <span class="nx-tpl-label">Template Name (Optional)</span>
            <input type="text" id="nx-ai-name" class="input" value="${escapeHtml(aiForm.templateName)}" placeholder="e.g. Q4 Creator Launch" maxlength="100" />
          </label>

          <div class="nx-tpl-two-col">
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Category</span>
              <select id="nx-ai-category" class="select">
                ${getMergedCategoriesList()
                  .map((c) => `<option value="${escapeHtml(c)}" ${aiForm.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Visual Style</span>
              <select id="nx-ai-style" class="select">
                ${TEMPLATE_STYLES.map((s) => `<option value="${escapeHtml(s)}" ${aiForm.style === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
              </select>
            </label>
          </div>

          <div class="nx-tpl-two-col">
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Aspect Ratio</span>
              <select id="nx-ai-ratio" class="select">
                ${Object.entries(TEMPLATE_ASPECT_RATIOS)
                  .map(([k, v]) => `<option value="${escapeHtml(k)}" ${aiForm.aspectRatio === k ? 'selected' : ''}>${escapeHtml(v.label)}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Font Preference</span>
              <select id="nx-ai-font" class="select">
                ${TEMPLATE_FONT_FAMILIES.map((f) => `<option value="${escapeHtml(f)}" ${aiForm.fontPreference === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
              </select>
            </label>
          </div>

          ${
            aiForm.aspectRatio === 'Custom'
              ? `<div class="nx-tpl-two-col">
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Width (px)</span><input type="number" id="nx-ai-custom-w" class="input" min="320" max="2400" value="${aiForm.customWidth}" /></label>
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Height (px)</span><input type="number" id="nx-ai-custom-h" class="input" min="320" max="2400" value="${aiForm.customHeight}" /></label>
                </div>`
              : ''
          }

          <div class="nx-tpl-three-col">
            <label class="nx-tpl-field"><span class="nx-tpl-label">Primary</span><input type="color" id="nx-ai-color-primary" class="nx-tpl-color-input" value="${escapeHtml(aiForm.primaryColor)}" /></label>
            <label class="nx-tpl-field"><span class="nx-tpl-label">Secondary</span><input type="color" id="nx-ai-color-secondary" class="nx-tpl-color-input" value="${escapeHtml(aiForm.secondaryColor)}" /></label>
            <label class="nx-tpl-field"><span class="nx-tpl-label">Accent</span><input type="color" id="nx-ai-color-accent" class="nx-tpl-color-input" value="${escapeHtml(aiForm.accentColor)}" /></label>
          </div>

          <div class="nx-tpl-two-col">
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Background Type</span>
              <select id="nx-ai-bg-type" class="select">
                <option value="gradient" ${aiForm.backgroundType === 'gradient' ? 'selected' : ''}>Gradient</option>
                <option value="solid" ${aiForm.backgroundType === 'solid' ? 'selected' : ''}>Solid Color</option>
                <option value="pattern" ${aiForm.backgroundType === 'pattern' ? 'selected' : ''}>Geometric Pattern</option>
                <option value="image" ${aiForm.backgroundType === 'image' ? 'selected' : ''}>Image Backdrop</option>
              </select>
            </label>
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Variations</span>
              <select id="nx-ai-variations" class="select">
                ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${Number(aiForm.variationCount) === n ? 'selected' : ''}>${n} Variation${n > 1 ? 's' : ''}</option>`).join('')}
              </select>
            </label>
          </div>

          <div class="nx-tpl-field">
            <span class="nx-tpl-label">Reference Image (Optional Vision Input)</span>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <label class="nx-btn-soft" style="cursor:pointer;height:34px;font-size:0.78rem;">
                ${svgIcon('image', 14)}
                <span>${aiForm.referenceImageDataUrl ? 'Replace Image' : 'Upload Reference'}</span>
                <input type="file" id="nx-ai-ref-file" accept="image/*" hidden />
              </label>
              ${
                aiForm.referenceImageDataUrl
                  ? `<img src="${escapeHtml(aiForm.referenceImageDataUrl)}" alt="Reference" style="width:38px;height:38px;object-fit:cover;border-radius:8px;border:1px solid var(--nx-border);" />
                     <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.74rem;" data-tpl-act="clear-ai-ref">Clear</button>`
                  : `<span class="member-sub">AI analyzes colors, tone & layout structure from your photo.</span>`
              }
            </div>
          </div>

          <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;cursor:pointer;">
            <input type="checkbox" id="nx-ai-gen-bg-img" ${aiForm.generateImageAsset ? 'checked' : ''} ${supportsImageAsset ? '' : 'disabled'} />
            <span>Generate AI Background Artwork ${supportsImageAsset ? '(Supported by selected provider)' : '(Select Gemini or OpenAI Image model)'}</span>
          </label>

          <button type="submit" class="nx-btn-grad" style="height:42px;justify-content:center;" ${aiGenerating ? 'disabled' : ''}>
            ${svgIcon('sparkles', 16)}
            <span>${aiGenerating ? 'Generating Real AI Layouts...' : 'Generate Templates with AI'}</span>
          </button>
        </form>

        <div class="nx-tpl-panel">
          <div class="nx-tpl-section-head">
            <h2 class="nx-tpl-section-title">Generated Variations</h2>
            <span class="member-sub">Every variation outputs real structured layers editable in Canvas Editor</span>
          </div>

          ${
            aiError
              ? `<div class="nx-tpl-alert error">
                  <div>
                    <strong>Generation Error</strong>
                    <div>${escapeHtml(aiError)}</div>
                  </div>
                  <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.74rem;" data-tpl-act="open-ai-setup">Switch API</button>
                    <button type="button" class="nx-btn-grad" style="height:30px;font-size:0.74rem;" data-tpl-act="retry-ai-gen">Retry</button>
                  </div>
                </div>`
              : ''
          }

          ${
            aiWarnings.length > 0
              ? `<div class="nx-tpl-alert warn"><div>${aiWarnings.map((w) => escapeHtml(w)).join('<br/>')}</div></div>`
              : ''
          }

          ${
            aiGenerating
              ? `<div style="padding:46px 20px;text-align:center;display:grid;gap:10px;justify-items:center;">
                  <strong>Synthesizing layout hierarchy, typography & palette...</strong>
                  <span class="member-sub">Calling live AI provider securely via server proxy. Never returns fake results.</span>
                </div>`
              : aiResults.length > 0
                ? `<div class="nx-tpl-featured-grid">
                    ${aiResults
                      .map(
                        (r, idx) => `
                      <article class="nx-tpl-card">
                        <div class="nx-tpl-card-media" style="cursor:pointer;" data-tpl-act="customize-ai-var" data-idx="${idx}">
                          <img src="" alt="${escapeHtml(r.title)}" data-tpl-thumb-ai-idx="${idx}" />
                          <div class="nx-tpl-card-badges">
                            <span class="nx-tpl-badge">${escapeHtml(r.category)} · ${escapeHtml(r.aspectRatio)}</span>
                            <span class="nx-tpl-badge featured">AI ${escapeHtml(r.aiProvider || 'Generated')}</span>
                          </div>
                        </div>
                        <div class="nx-tpl-card-body">
                          <h4 class="nx-tpl-card-title">${escapeHtml(r.title)}</h4>
                          <p class="member-sub" style="margin:0;white-space:normal;">${escapeHtml(r.description || '')}</p>
                        </div>
                        <div class="nx-tpl-card-actions">
                          <button type="button" class="nx-btn-soft" style="height:31px;font-size:0.75rem;" data-tpl-act="save-ai-var" data-idx="${idx}" data-vis="public">Publish Community</button>
                          <button type="button" class="nx-btn-grad" style="height:31px;font-size:0.75rem;" data-tpl-act="customize-ai-var" data-idx="${idx}">Edit in Canvas</button>
                        </div>
                      </article>
                    `
                      )
                      .join('')}
                  </div>`
                : `<div style="padding:46px 20px;text-align:center;display:grid;gap:8px;justify-items:center;">
                    <strong>Ready to create with AI</strong>
                    <span class="member-sub" style="max-width:440px;white-space:normal;">Describe your post, thumbnail, event flyer, or quote card on the left. Every generated layout opens in the full interactive canvas editor.</span>
                  </div>`
          }
        </div>
      </div>
    `;
  }

  /* ---------- VISUAL CANVAS EDITOR VIEW ---------- */

  function computeStageDisplayScale() {
    const w = Number(editorData.width || 1080);
    const h = Number(editorData.height || 1080);
    if (zoomMode === '50') return 0.5;
    if (zoomMode === '75') return 0.75;
    if (zoomMode === '100') return Math.min(1, 760 / Math.max(w, h));
    const maxStageW = typeof window !== 'undefined' && window.innerWidth < 900 ? Math.min(340, window.innerWidth - 64) : 520;
    const maxStageH = 540;
    return Math.min(maxStageW / w, maxStageH / h);
  }

  function renderSelectedLayerInspector() {
    const layer = editorData.layers.find((l) => l.id === selectedLayerId);
    if (!layer) {
      const bg = editorData.background || {};
      return `
        <div style="display:grid;gap:10px;">
          <div class="nx-tpl-section-head">
            <strong style="font-size:0.88rem;">Canvas &amp; Background</strong>
            <span class="member-sub">${editorData.width}×${editorData.height}</span>
          </div>
          <label class="nx-tpl-field">
            <span class="nx-tpl-label">Aspect Ratio</span>
            <select id="nx-ed-aspect" class="select">
              ${Object.entries(TEMPLATE_ASPECT_RATIOS)
                .map(([k, v]) => `<option value="${escapeHtml(k)}" ${editorData.aspectRatio === k ? 'selected' : ''}>${escapeHtml(v.label)}</option>`)
                .join('')}
            </select>
          </label>
          <label class="nx-tpl-field">
            <span class="nx-tpl-label">Background Type</span>
            <select id="nx-ed-bg-type" class="select">
              <option value="gradient" ${bg.type === 'gradient' ? 'selected' : ''}>Gradient</option>
              <option value="solid" ${bg.type === 'solid' ? 'selected' : ''}>Solid Color</option>
              <option value="pattern" ${bg.type === 'pattern' ? 'selected' : ''}>Pattern</option>
              <option value="image" ${bg.type === 'image' ? 'selected' : ''}>Background Image</option>
            </select>
          </label>
          ${
            bg.type === 'solid'
              ? `<label class="nx-tpl-field"><span class="nx-tpl-label">Solid Color</span><input type="color" id="nx-ed-bg-color" class="nx-tpl-color-input" value="${escapeHtml(bg.color || '#0D0E20')}" /></label>`
              : `<div class="nx-tpl-two-col">
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Gradient From</span><input type="color" id="nx-ed-bg-from" class="nx-tpl-color-input" value="${escapeHtml(bg.gradientFrom || '#12102C')}" /></label>
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Gradient To</span><input type="color" id="nx-ed-bg-to" class="nx-tpl-color-input" value="${escapeHtml(bg.gradientTo || '#286BFF')}" /></label>
                </div>
                <label class="nx-tpl-field"><span class="nx-tpl-label">Gradient Angle (${bg.gradientAngle || 145}°)</span><input type="range" id="nx-ed-bg-angle" min="0" max="360" value="${bg.gradientAngle || 145}" /></label>`
          }
          <div class="nx-tpl-two-col">
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Pattern Overlay</span>
              <select id="nx-ed-bg-pattern" class="select">
                ${['none', 'grid', 'dots', 'diagonal', 'glow'].map((p) => `<option value="${p}" ${bg.pattern === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </label>
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Pattern Opacity</span>
              <input type="range" id="nx-ed-bg-pat-op" min="0" max="0.8" step="0.05" value="${Number(bg.patternOpacity ?? 0.2)}" />
            </label>
          </div>
          <div class="nx-tpl-field">
            <span class="nx-tpl-label">Upload Background Image</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <label class="nx-btn-soft" style="cursor:pointer;height:32px;font-size:0.75rem;">
                ${svgIcon('image', 13)} Upload Image
                <input type="file" id="nx-ed-bg-file" accept="image/*" hidden />
              </label>
              ${bg.imageUrl ? `<button type="button" class="nx-btn-soft" style="height:32px;font-size:0.75rem;" data-tpl-act="clear-bg-image">Clear Photo</button>` : ''}
            </div>
          </div>
          ${
            bg.imageUrl
              ? `<div class="nx-tpl-two-col">
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Tint Overlay</span><input type="color" id="nx-ed-bg-overlay-color" class="nx-tpl-color-input" value="${escapeHtml(bg.overlayColor || '#090915')}" /></label>
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Tint Opacity</span><input type="range" id="nx-ed-bg-overlay-op" min="0" max="0.9" step="0.05" value="${Number(bg.overlayOpacity ?? 0.25)}" /></label>
                </div>`
              : ''
          }
        </div>
      `;
    }

    return `
      <div style="display:grid;gap:10px;">
        <div class="nx-tpl-section-head">
          <strong style="font-size:0.86rem;">${escapeHtml(layer.name)} (${escapeHtml(layer.type)})</strong>
          <button type="button" class="nx-link-action" style="font-size:0.74rem;" data-tpl-act="deselect-layer">Canvas BG</button>
        </div>

        <div class="nx-tpl-two-col">
          <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.73rem;" data-tpl-act="center-layer-h">Center H</button>
          <button type="button" class="nx-btn-soft" style="height:30px;font-size:0.73rem;" data-tpl-act="center-layer-v">Center V</button>
        </div>

        <div class="nx-tpl-two-col">
          <label class="nx-tpl-field"><span class="nx-tpl-label">X</span><input type="number" class="input" data-lyr-num="x" value="${Math.round(layer.x)}" /></label>
          <label class="nx-tpl-field"><span class="nx-tpl-label">Y</span><input type="number" class="input" data-lyr-num="y" value="${Math.round(layer.y)}" /></label>
          <label class="nx-tpl-field"><span class="nx-tpl-label">Width</span><input type="number" class="input" data-lyr-num="width" min="20" value="${Math.round(layer.width)}" /></label>
          <label class="nx-tpl-field"><span class="nx-tpl-label">Height</span><input type="number" class="input" data-lyr-num="height" min="16" value="${Math.round(layer.height)}" /></label>
        </div>

        <div class="nx-tpl-two-col">
          <label class="nx-tpl-field"><span class="nx-tpl-label">Rotation (${layer.rotation || 0}°)</span><input type="range" data-lyr-range="rotation" min="-180" max="180" value="${Number(layer.rotation || 0)}" /></label>
          <label class="nx-tpl-field"><span class="nx-tpl-label">Opacity (${Math.round((layer.opacity ?? 1) * 100)}%)</span><input type="range" data-lyr-range="opacity" min="0.05" max="1" step="0.05" value="${Number(layer.opacity ?? 1)}" /></label>
        </div>

        ${
          layer.type === 'text'
            ? `
            <label class="nx-tpl-field">
              <span class="nx-tpl-label">Text Content</span>
              <textarea id="nx-ed-lyr-text" class="textarea" rows="3">${escapeHtml(layer.text || '')}</textarea>
            </label>
            <div class="nx-tpl-two-col">
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Font Family</span>
                <select data-lyr-prop="fontFamily" class="select">
                  ${TEMPLATE_FONT_FAMILIES.map((f) => `<option value="${escapeHtml(f)}" ${layer.fontFamily === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                </select>
              </label>
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Weight</span>
                <select data-lyr-prop="fontWeight" class="select">
                  ${['400', '500', '600', '700', '800', '900'].map((w) => `<option value="${w}" ${String(layer.fontWeight) === w ? 'selected' : ''}>${w}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="nx-tpl-three-col">
              <label class="nx-tpl-field"><span class="nx-tpl-label">Size</span><input type="number" class="input" data-lyr-num="fontSize" min="10" max="240" value="${Math.round(layer.fontSize || 48)}" /></label>
              <label class="nx-tpl-field"><span class="nx-tpl-label">Text Color</span><input type="color" class="nx-tpl-color-input" data-lyr-prop="color" value="${escapeHtml(layer.color || '#FFFFFF')}" /></label>
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Align</span>
                <select data-lyr-prop="align" class="select">
                  <option value="left" ${layer.align === 'left' ? 'selected' : ''}>Left</option>
                  <option value="center" ${layer.align === 'center' ? 'selected' : ''}>Center</option>
                  <option value="right" ${layer.align === 'right' ? 'selected' : ''}>Right</option>
                </select>
              </label>
            </div>
            <div class="nx-tpl-two-col">
              <label class="nx-tpl-field"><span class="nx-tpl-label">Line Height</span><input type="range" data-lyr-range="lineHeight" min="0.85" max="2.2" step="0.05" value="${Number(layer.lineHeight || 1.18)}" /></label>
              <label class="nx-tpl-field"><span class="nx-tpl-label">Letter Space</span><input type="range" data-lyr-range="letterSpacing" min="-4" max="16" step="1" value="${Number(layer.letterSpacing || 0)}" /></label>
            </div>
            <div class="nx-tpl-two-col">
              <label class="nx-tpl-field"><span class="nx-tpl-label">Highlight BG</span><input type="color" class="nx-tpl-color-input" data-lyr-prop="bgColor" value="${escapeHtml(layer.bgColor || '#101124')}" /></label>
              <label class="nx-tpl-field"><span class="nx-tpl-label">BG Padding</span><input type="number" class="input" data-lyr-num="bgPadding" min="0" max="48" value="${Math.round(layer.bgPadding || 0)}" /></label>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.78rem;cursor:pointer;">
              <input type="checkbox" data-lyr-bool="shadow" ${layer.shadow ? 'checked' : ''} /> Drop Shadow
            </label>
            `
            : layer.type === 'image'
              ? `
              <div class="nx-tpl-field">
                <span class="nx-tpl-label">Photo Asset</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <label class="nx-btn-grad" style="cursor:pointer;height:32px;font-size:0.75rem;">
                    ${svgIcon('image', 13)} ${layer.src ? 'Replace Photo' : 'Upload Photo'}
                    <input type="file" id="nx-ed-lyr-img-file" accept="image/*" hidden />
                  </label>
                  ${layer.src ? `<button type="button" class="nx-btn-soft" style="height:32px;font-size:0.75rem;" data-tpl-act="clear-layer-img">Remove</button>` : ''}
                </div>
              </div>
              <div class="nx-tpl-two-col">
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Frame Style</span>
                  <select data-lyr-prop="frameStyle" class="select">
                    <option value="none" ${layer.frameStyle === 'none' ? 'selected' : ''}>Clean</option>
                    <option value="polaroid" ${layer.frameStyle === 'polaroid' ? 'selected' : ''}>Polaroid</option>
                    <option value="glass" ${layer.frameStyle === 'glass' ? 'selected' : ''}>Glass Card</option>
                    <option value="neon" ${layer.frameStyle === 'neon' ? 'selected' : ''}>Neon Glow</option>
                  </select>
                </label>
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Fit</span>
                  <select data-lyr-prop="objectFit" class="select">
                    <option value="cover" ${layer.objectFit === 'cover' ? 'selected' : ''}>Fill (Cover)</option>
                    <option value="contain" ${layer.objectFit === 'contain' ? 'selected' : ''}>Fit (Contain)</option>
                  </select>
                </label>
              </div>
              <div class="nx-tpl-three-col">
                <label class="nx-tpl-field"><span class="nx-tpl-label">Zoom</span><input type="range" data-lyr-range="cropZoom" min="1" max="3" step="0.1" value="${Number(layer.cropZoom || 1)}" /></label>
                <label class="nx-tpl-field"><span class="nx-tpl-label">Pan X</span><input type="range" data-lyr-range="cropX" min="-1" max="1" step="0.1" value="${Number(layer.cropX || 0)}" /></label>
                <label class="nx-tpl-field"><span class="nx-tpl-label">Pan Y</span><input type="range" data-lyr-range="cropY" min="-1" max="1" step="0.1" value="${Number(layer.cropY || 0)}" /></label>
              </div>
              <div class="nx-tpl-two-col">
                <label class="nx-tpl-field"><span class="nx-tpl-label">Radius</span><input type="number" class="input" data-lyr-num="borderRadius" min="0" max="400" value="${Math.round(layer.borderRadius || 0)}" /></label>
                <label class="nx-tpl-field"><span class="nx-tpl-label">Border W</span><input type="number" class="input" data-lyr-num="borderWidth" min="0" max="24" value="${Math.round(layer.borderWidth || 0)}" /></label>
              </div>
              `
              : layer.type === 'sticker'
                ? `
                <div class="nx-tpl-two-col">
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Emoji</span><input type="text" class="input" data-lyr-prop="emoji" maxlength="6" value="${escapeHtml(layer.emoji || '✨')}" /></label>
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Font Size</span><input type="number" class="input" data-lyr-num="fontSize" min="12" max="72" value="${Math.round(layer.fontSize || 22)}" /></label>
                </div>
                <label class="nx-tpl-field"><span class="nx-tpl-label">Badge Label</span><input type="text" class="input" data-lyr-prop="text" maxlength="48" value="${escapeHtml(layer.text || '')}" /></label>
                <div class="nx-tpl-two-col">
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Text Color</span><input type="color" class="nx-tpl-color-input" data-lyr-prop="color" value="${escapeHtml(layer.color || '#FFFFFF')}" /></label>
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Badge Color</span><input type="color" class="nx-tpl-color-input" data-lyr-prop="bgColor" value="${escapeHtml(layer.bgColor || '#701CFF')}" /></label>
                </div>
                `
                : `
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Shape Kind</span>
                  <select data-lyr-prop="shapeKind" class="select">
                    ${['rounded', 'rect', 'circle', 'pill', 'line', 'ring'].map((sk) => `<option value="${sk}" ${layer.shapeKind === sk ? 'selected' : ''}>${sk}</option>`).join('')}
                  </select>
                </label>
                <div class="nx-tpl-two-col">
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Fill Color</span><input type="color" class="nx-tpl-color-input" data-lyr-prop="fill" value="${escapeHtml(layer.fill?.startsWith('#') ? layer.fill : '#701CFF')}" /></label>
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Border Color</span><input type="color" class="nx-tpl-color-input" data-lyr-prop="borderColor" value="${escapeHtml(layer.borderColor || '#FFFFFF')}" /></label>
                </div>
                <div class="nx-tpl-two-col">
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Border W</span><input type="number" class="input" data-lyr-num="borderWidth" min="0" max="24" value="${Math.round(layer.borderWidth || 0)}" /></label>
                  <label class="nx-tpl-field"><span class="nx-tpl-label">Radius</span><input type="number" class="input" data-lyr-num="borderRadius" min="0" max="400" value="${Math.round(layer.borderRadius || 0)}" /></label>
                </div>
                <label style="display:flex;align-items:center;gap:8px;font-size:0.78rem;cursor:pointer;">
                  <input type="checkbox" data-lyr-bool="shadow" ${layer.shadow ? 'checked' : ''} /> Drop Shadow
                </label>
                `
        }
      </div>
    `;
  }

  function renderCanvasEditorView() {
    const scale = computeStageDisplayScale();
    const dispW = Math.round(editorData.width * scale);
    const dispH = Math.round(editorData.height * scale);
    const orderedLayersDesc = [...editorData.layers].sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0));

    return `
      <div class="nx-tpl-editor-shell">
        <div class="nx-tpl-editor-topbar">
          <div class="nx-tpl-editor-group">
            <button type="button" class="nx-btn-soft" style="height:34px;font-size:0.78rem;" data-tpl-act="switch-subview" data-subview="discover">
              ${svgIcon('arrowLeft', 14)} Library
            </button>
            <input type="text" id="nx-ed-title-input" class="input" style="width:210px;height:34px;font-weight:700;" value="${escapeHtml(editorMeta.title)}" maxlength="120" aria-label="Template title" />
            <span id="nx-tpl-autosave-status" class="nx-tpl-autosave-pill ${autosaveState}">
              ${autosaveState === 'saving' ? 'Saving...' : autosaveState === 'saved' ? (editorMeta.isPersisted ? 'Saved to Cloud' : 'Draft Ready') : autosaveState === 'failed' ? 'Save Failed' : 'Unsaved Changes'}
            </span>
          </div>

          <div class="nx-tpl-editor-group">
            <button type="button" class="nx-btn-soft" style="height:34px;font-size:0.76rem;" data-tpl-act="undo" ${historyStack.canUndo() ? '' : 'disabled'}>Undo</button>
            <button type="button" class="nx-btn-soft" style="height:34px;font-size:0.76rem;" data-tpl-act="redo" ${historyStack.canRedo() ? '' : 'disabled'}>Redo</button>
            <button type="button" class="nx-btn-soft" style="height:34px;font-size:0.76rem;" data-tpl-act="open-save-modal">${svgIcon('bookmark', 14)} Save / Publish</button>
            <button type="button" class="nx-btn-soft" style="height:34px;font-size:0.76rem;" data-tpl-act="open-export-modal">${svgIcon('download', 14)} Export</button>
            <button type="button" class="nx-btn-soft" style="height:34px;font-size:0.76rem;" data-tpl-act="open-story-publish">Story</button>
            <button type="button" class="nx-btn-grad" style="height:34px;font-size:0.78rem;" data-tpl-act="open-post-publish">${svgIcon('send', 14)} Post to NEXORA</button>
          </div>
        </div>

        <div class="nx-tpl-editor-grid">
          <aside class="nx-tpl-sidebar-panel">
            <strong style="font-size:0.84rem;">Add Elements</strong>
            <div class="nx-tpl-tool-grid">
              <button type="button" class="nx-btn-soft" style="height:32px;font-size:0.76rem;" data-tpl-act="add-layer" data-type="text">+ Text</button>
              <button type="button" class="nx-btn-soft" style="height:32px;font-size:0.76rem;" data-tpl-act="add-layer" data-type="image">+ Image Frame</button>
              <button type="button" class="nx-btn-soft" style="height:32px;font-size:0.76rem;" data-tpl-act="add-layer" data-type="shape">+ Shape</button>
              <button type="button" class="nx-btn-soft" style="height:32px;font-size:0.76rem;" data-tpl-act="add-layer" data-type="sticker">+ Sticker Badge</button>
            </div>

            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${TEMPLATE_STICKERS.slice(0, 6)
                .map(
                  (st, i) =>
                    `<button type="button" class="nx-tpl-cat-chip" style="font-size:0.69rem;padding:4px 8px;" data-tpl-act="add-sticker-preset" data-idx="${i}">${st.emoji} ${escapeHtml(st.text)}</button>`
                )
                .join('')}
            </div>

            <div class="nx-tpl-section-head" style="margin-top:4px;">
              <strong style="font-size:0.84rem;">Layers (${editorData.layers.length})</strong>
              <button type="button" class="nx-link-action" style="font-size:0.73rem;" data-tpl-act="deselect-layer">Edit Background</button>
            </div>

            <div style="display:grid;gap:6px;">
              ${orderedLayersDesc
                .map(
                  (lyr) => `
                <div class="nx-tpl-layer-row ${selectedLayerId === lyr.id ? 'selected' : ''}" data-tpl-act="select-layer" data-layer-id="${escapeHtml(lyr.id)}">
                  <div style="min-width:0;">
                    <div class="nx-tpl-layer-row-name">${escapeHtml(lyr.name)}</div>
                    <div class="member-sub" style="font-size:0.68rem;">${escapeHtml(lyr.type)} · z${lyr.zIndex}</div>
                  </div>
                  <div style="display:flex;gap:3px;flex-shrink:0;">
                    <button type="button" class="nx-tpl-icon-btn" style="height:24px;min-width:24px;padding:0;" data-tpl-act="layer-up" data-layer-id="${escapeHtml(lyr.id)}" title="Bring Forward">↑</button>
                    <button type="button" class="nx-tpl-icon-btn" style="height:24px;min-width:24px;padding:0;" data-tpl-act="layer-down" data-layer-id="${escapeHtml(lyr.id)}" title="Send Backward">↓</button>
                    <button type="button" class="nx-tpl-icon-btn" style="height:24px;min-width:24px;padding:0;" data-tpl-act="layer-vis" data-layer-id="${escapeHtml(lyr.id)}" title="Toggle visibility">${lyr.visible !== false ? '👁' : '🚫'}</button>
                    <button type="button" class="nx-tpl-icon-btn" style="height:24px;min-width:24px;padding:0;" data-tpl-act="layer-lock" data-layer-id="${escapeHtml(lyr.id)}" title="Lock layer">${lyr.locked ? '🔒' : '🔓'}</button>
                    <button type="button" class="nx-tpl-icon-btn" style="height:24px;min-width:24px;padding:0;" data-tpl-act="layer-dup" data-layer-id="${escapeHtml(lyr.id)}" title="Duplicate">⧉</button>
                    <button type="button" class="nx-tpl-icon-btn" style="height:24px;min-width:24px;padding:0;color:#f43f5e;" data-tpl-act="layer-del" data-layer-id="${escapeHtml(lyr.id)}" title="Delete">×</button>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </aside>

          <section class="nx-tpl-stage-wrap">
            <div class="nx-tpl-stage-toolbar">
              <span>${editorData.width} × ${editorData.height} px (${escapeHtml(editorData.aspectRatio)}) · Drag to move, corner handles to resize, double-click text</span>
              <div style="display:flex;gap:4px;">
                ${['fit', '50', '75', '100']
                  .map(
                    (z) =>
                      `<button type="button" class="nx-tpl-icon-btn ${zoomMode === z ? 'active' : ''}" style="height:26px;font-size:0.72rem;" data-tpl-act="set-zoom" data-zoom="${z}">${z === 'fit' ? 'Fit' : `${z}%`}</button>`
                  )
                  .join('')}
              </div>
            </div>

            <div class="nx-tpl-canvas-viewport">
              <div
                id="nx-tpl-stage-frame"
                class="nx-tpl-stage-frame"
                style="width:${dispW}px;height:${dispH}px;"
                data-canvas-w="${editorData.width}"
                data-canvas-h="${editorData.height}"
                data-scale="${scale}"
              >
                <canvas id="nx-tpl-editor-canvas" width="${editorData.width}" height="${editorData.height}"></canvas>
                <div id="nx-tpl-stage-overlay" class="nx-tpl-stage-overlay">
                  ${editorData.layers
                    .filter((l) => l.visible !== false)
                    .map((l) => {
                      const isSel = selectedLayerId === l.id;
                      const left = Math.round(l.x * scale);
                      const top = Math.round(l.y * scale);
                      const width = Math.max(12, Math.round(l.width * scale));
                      const height = Math.max(12, Math.round(l.height * scale));
                      return `
                        <div
                          class="nx-tpl-layer-box ${isSel ? 'selected' : ''} ${l.locked ? 'locked' : ''}"
                          data-stage-layer-id="${escapeHtml(l.id)}"
                          style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:${Number(l.zIndex || 1)};transform:rotate(${Number(l.rotation || 0)}deg);"
                        >
                          ${
                            isSel && !l.locked
                              ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
                                  .map((h) => `<span class="nx-tpl-handle" data-handle="${h}" data-stage-layer-id="${escapeHtml(l.id)}"></span>`)
                                  .join('')
                              : ''
                          }
                        </div>
                      `;
                    })
                    .join('')}
                  <div id="nx-tpl-snap-v" class="nx-tpl-snap-v" hidden></div>
                  <div id="nx-tpl-snap-h" class="nx-tpl-snap-h" hidden></div>
                </div>

                ${
                  inlineEditLayerId
                    ? (() => {
                        const il = editorData.layers.find((x) => x.id === inlineEditLayerId && x.type === 'text');
                        if (!il) return '';
                        return `
                          <div class="nx-tpl-inline-edit-popover">
                            <textarea id="nx-tpl-inline-textarea" class="textarea" rows="2">${escapeHtml(il.text || '')}</textarea>
                            <div style="display:flex;justify-content:flex-end;gap:6px;">
                              <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.74rem;" data-tpl-act="close-inline-edit">Done</button>
                            </div>
                          </div>
                        `;
                      })()
                    : ''
                }
              </div>
            </div>
          </section>

          <aside class="nx-tpl-sidebar-panel nx-tpl-editor-inspector">
            ${renderSelectedLayerInspector()}
          </aside>
        </div>
      </div>
    `;
  }

  /* ---------- MODALS RENDERING ---------- */

  function renderStudioModalHtml() {
    if (!activeModal) return '';

    if (activeModal.type === 'ai-setup') {
      const providers = getProvidersCombined();
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="AI Provider API Configuration">
            <div class="nx-tpl-modal-head">
              <h3>AI API Configuration &amp; Vault</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal" aria-label="Close modal">${svgIcon('close', 16)}</button>
            </div>
            <div class="nx-tpl-modal-body">
              <div class="nx-tpl-alert ok">
                <div>
                  <strong>Encrypted Key Handling</strong>
                  <div>Your API keys are encrypted server-side with AES-256-GCM before storage, masked on display, and never sent back to any browser or Firestore document.</div>
                </div>
              </div>

              <div class="nx-tpl-field">
                <span class="nx-tpl-label">Saved Providers</span>
                ${
                  platformGeminiConfigured
                    ? `<div class="file-row" style="justify-content:space-between;padding:8px 10px;">
                        <div>
                          <strong>NEXORA Platform Gemini AI</strong>
                          <div class="member-sub">Server-managed Gemini · Text, JSON &amp; Image Gen</div>
                        </div>
                        <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.73rem;" data-tpl-act="test-provider" data-config-id="platform">Test Connection</button>
                      </div>`
                    : ''
                }
                ${
                  providers.length > 0
                    ? providers
                        .map(
                          (p) => `
                        <div class="file-row" style="justify-content:space-between;padding:8px 10px;gap:8px;flex-wrap:wrap;">
                          <div style="min-width:0;">
                            <strong>${escapeHtml(p.label)}</strong>
                            <div class="member-sub">${escapeHtml(p.provider)} · ${escapeHtml(p.textModel)} · Key ${escapeHtml(p.keyMasked || 'saved')} ${p.lastStatus === 'connected' ? '· Connected' : ''}</div>
                            <div class="nx-tpl-cap-row" style="margin-top:4px;">
                              ${p.capabilities?.text ? '<span class="nx-tpl-cap-tag">Text</span>' : ''}
                              ${p.capabilities?.structuredJson ? '<span class="nx-tpl-cap-tag">JSON</span>' : ''}
                              ${p.capabilities?.vision ? '<span class="nx-tpl-cap-tag">Vision</span>' : ''}
                              ${p.capabilities?.imageGeneration ? '<span class="nx-tpl-cap-tag">Image Gen</span>' : ''}
                            </div>
                          </div>
                          <div style="display:flex;gap:5px;">
                            <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.73rem;" data-tpl-act="test-provider" data-config-id="${escapeHtml(p.id)}">Test</button>
                            <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.73rem;" data-tpl-act="use-provider" data-config-id="${escapeHtml(p.id)}">Select</button>
                            <button type="button" class="nx-btn-danger" style="height:28px;font-size:0.73rem;" data-tpl-act="delete-provider" data-config-id="${escapeHtml(p.id)}">Delete</button>
                          </div>
                        </div>
                      `
                        )
                        .join('')
                    : `<span class="member-sub">No custom user AI API keys added yet. Add Gemini, OpenAI, or OpenAI-compatible below.</span>`
                }
              </div>

              ${
                providerTestResult
                  ? `<div class="nx-tpl-alert ${providerTestResult.ok ? 'ok' : 'error'}">
                      <div>${escapeHtml(providerTestResult.ok ? providerTestResult.message || `Connected to ${providerTestResult.model} (${providerTestResult.latencyMs}ms)` : providerTestResult.error || 'Connection failed')}</div>
                    </div>`
                  : ''
              }

              <form id="nx-tpl-provider-form" style="display:grid;gap:10px;padding-top:10px;border-top:1px solid var(--nx-border);">
                <strong style="font-size:0.9rem;">Add or Update AI Provider</strong>
                <div class="nx-tpl-two-col">
                  <label class="nx-tpl-field">
                    <span class="nx-tpl-label">Provider</span>
                    <select id="nx-prov-kind" class="select">
                      <option value="gemini" ${providerForm.provider === 'gemini' ? 'selected' : ''}>Google Gemini API</option>
                      <option value="openai" ${providerForm.provider === 'openai' ? 'selected' : ''}>OpenAI API</option>
                      <option value="openai_compatible" ${providerForm.provider === 'openai_compatible' ? 'selected' : ''}>OpenAI-Compatible (OpenRouter, Groq, Together)</option>
                    </select>
                  </label>
                  <label class="nx-tpl-field">
                    <span class="nx-tpl-label">Label</span>
                    <input type="text" id="nx-prov-label" class="input" value="${escapeHtml(providerForm.label)}" placeholder="e.g. My Studio Key" required />
                  </label>
                </div>
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">API Key (Encrypted on Server)</span>
                  <input type="password" id="nx-prov-key" class="input" value="${escapeHtml(providerForm.apiKey)}" placeholder="Paste your API key (never stored in plain text)" autocomplete="off" required />
                </label>
                ${
                  providerForm.provider === 'openai_compatible' || providerForm.provider === 'openai'
                    ? `<label class="nx-tpl-field">
                        <span class="nx-tpl-label">Custom Base URL ${providerForm.provider === 'openai' ? '(Optional)' : '(Required HTTPS endpoint)'}</span>
                        <input type="url" id="nx-prov-url" class="input" value="${escapeHtml(providerForm.baseUrl)}" placeholder="https://openrouter.ai/api/v1" ${providerForm.provider === 'openai_compatible' ? 'required' : ''} />
                      </label>`
                    : ''
                }
                <div class="nx-tpl-two-col">
                  <label class="nx-tpl-field">
                    <span class="nx-tpl-label">Text / Layout Model</span>
                    <input type="text" id="nx-prov-text-model" class="input" value="${escapeHtml(providerForm.textModel)}" placeholder="gemini-4-hydrogen or gpt-4o-mini" required />
                  </label>
                  <label class="nx-tpl-field">
                    <span class="nx-tpl-label">Image Gen Model (Optional)</span>
                    <input type="text" id="nx-prov-image-model" class="input" value="${escapeHtml(providerForm.imageModel)}" placeholder="gemini-3.1-flash-lite-image or dall-e-3" />
                  </label>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:8px;">
                  <button type="button" class="nx-btn-soft" data-tpl-act="test-provider-form" ${providerTesting ? 'disabled' : ''}>
                    ${providerTesting ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button type="submit" class="nx-btn-grad" ${providerSaving ? 'disabled' : ''}>
                    ${providerSaving ? 'Saving...' : 'Encrypt & Save Key'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      `;
    }

    if (activeModal.type === 'preview' && activeModal.template) {
      const tpl = activeModal.template;
      const isMine = tpl.creatorId === currentUser?.uid && !tpl.isStarter;
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="Template Preview">
            <div class="nx-tpl-modal-head">
              <h3>${escapeHtml(tpl.title)}</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal">${svgIcon('close', 16)}</button>
            </div>
            <div class="nx-tpl-modal-body">
              <div style="background:#0b0c1a;border-radius:14px;padding:14px;display:grid;place-items:center;">
                <img src="${tpl.previewImageUrl ? escapeHtml(tpl.previewImageUrl) : ''}" alt="${escapeHtml(tpl.title)}" data-tpl-thumb-id="${escapeHtml(tpl.id)}" style="max-height:380px;max-width:100%;border-radius:10px;object-fit:contain;" />
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                <span class="nx-meta-chip">${escapeHtml(tpl.category)}</span>
                <span class="nx-meta-chip">${escapeHtml(tpl.style)}</span>
                <span class="nx-meta-chip">${escapeHtml(tpl.aspectRatio)}</span>
                ${tpl.aiGenerated ? `<span class="nx-meta-chip">AI Generated</span>` : ''}
              </div>
              <p class="member-sub" style="margin:0;white-space:normal;line-height:1.5;">${escapeHtml(tpl.description || 'Editable multi-layer template design.')}</p>
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-top:8px;border-top:1px solid var(--nx-border);">
                <div style="display:flex;gap:6px;">
                  ${
                    !tpl.isStarter && tpl.creatorId !== currentUser?.uid
                      ? `<button type="button" class="nx-btn-soft" style="height:34px;font-size:0.78rem;" data-tpl-act="open-report" data-tpl-id="${escapeHtml(tpl.id)}">${svgIcon('flag', 13)} Report</button>`
                      : ''
                  }
                  ${
                    isMine
                      ? `<button type="button" class="nx-btn-danger" style="height:34px;font-size:0.78rem;" data-tpl-act="delete-template" data-tpl-id="${escapeHtml(tpl.id)}">${svgIcon('trash', 13)} Delete</button>`
                      : ''
                  }
                </div>
                <div style="display:flex;gap:8px;">
                  <button type="button" class="nx-btn-soft" data-tpl-act="open-share" data-tpl-id="${escapeHtml(tpl.id)}">Share</button>
                  <button type="button" class="nx-btn-grad" data-tpl-act="use-template" data-tpl-id="${escapeHtml(tpl.id)}">Use &amp; Customize</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (activeModal.type === 'save') {
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="Save or Publish Template">
            <div class="nx-tpl-modal-head">
              <h3>Save &amp; Share Template</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal">${svgIcon('close', 16)}</button>
            </div>
            <form class="nx-tpl-modal-body" id="nx-tpl-save-form">
              <label class="nx-tpl-field"><span class="nx-tpl-label">Template Title</span><input type="text" id="nx-save-title" class="input" value="${escapeHtml(editorMeta.title)}" minlength="2" maxlength="120" required /></label>
              <label class="nx-tpl-field"><span class="nx-tpl-label">Description</span><textarea id="nx-save-desc" class="textarea" rows="2" maxlength="600">${escapeHtml(editorMeta.description)}</textarea></label>
              <div class="nx-tpl-two-col">
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Category</span>
                  <select id="nx-save-cat" class="select">
                    ${getMergedCategoriesList().map((c) => `<option value="${escapeHtml(c)}" ${editorMeta.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                  </select>
                </label>
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Style</span>
                  <select id="nx-save-style" class="select">
                    ${TEMPLATE_STYLES.map((s) => `<option value="${escapeHtml(s)}" ${editorMeta.style === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                  </select>
                </label>
              </div>
              <label class="nx-tpl-field"><span class="nx-tpl-label">Tags (comma separated)</span><input type="text" id="nx-save-tags" class="input" value="${escapeHtml((editorMeta.tags || []).join(', '))}" placeholder="promo, neon, creator" /></label>
              <div class="nx-tpl-two-col">
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Visibility</span>
                  <select id="nx-save-vis" class="select">
                    <option value="private" ${editorMeta.visibility === 'private' ? 'selected' : ''}>Private (Only Me)</option>
                    <option value="public" ${editorMeta.visibility === 'public' ? 'selected' : ''}>Public Community Library</option>
                  </select>
                </label>
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Remix Permission</span>
                  <select id="nx-save-perm" class="select">
                    <option value="public_remix" ${editorMeta.usagePermission === 'public_remix' ? 'selected' : ''}>Allow Community Remix</option>
                    <option value="view_only" ${editorMeta.usagePermission === 'view_only' ? 'selected' : ''}>View &amp; Inspiration Only</option>
                  </select>
                </label>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:8px;">
                ${
                  editorMeta.isPersisted
                    ? `<button type="button" class="nx-btn-soft" data-tpl-act="save-as-copy">Save as New Copy</button>`
                    : ''
                }
                <button type="submit" class="nx-btn-grad">${editorMeta.isPersisted ? 'Update Template' : 'Save Template'}</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (activeModal.type === 'export') {
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="Export Template Artwork">
            <div class="nx-tpl-modal-head">
              <h3>Export Clean Artwork</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal">${svgIcon('close', 16)}</button>
            </div>
            <form class="nx-tpl-modal-body" id="nx-tpl-export-form">
              <div class="nx-tpl-three-col">
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Format</span>
                  <select id="nx-exp-format" class="select">
                    <option value="png">PNG (Lossless)</option>
                    <option value="jpg">JPG (Compressed)</option>
                    <option value="pdf">PDF (Document)</option>
                  </select>
                </label>
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Resolution</span>
                  <select id="nx-exp-scale" class="select">
                    <option value="1">1× (${editorData.width}×${editorData.height})</option>
                    <option value="1.5">1.5× High-Res</option>
                    <option value="2">2× Ultra HD</option>
                  </select>
                </label>
                <label class="nx-tpl-field">
                  <span class="nx-tpl-label">Quality</span>
                  <select id="nx-exp-quality" class="select">
                    <option value="0.95">95% Best</option>
                    <option value="0.88" selected>88% Balanced</option>
                    <option value="0.72">72% Compact</option>
                  </select>
                </label>
              </div>
              <p class="member-sub" style="margin:0;">Exports pure canvas artwork with zero selection boxes, guides, or editor overlays.</p>
              <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button type="submit" class="nx-btn-grad">${svgIcon('download', 14)} Download Export</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (activeModal.type === 'publish-post') {
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="Publish Template as Post">
            <div class="nx-tpl-modal-head">
              <h3>Publish Design to NEXORA Feed</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal">${svgIcon('close', 16)}</button>
            </div>
            <form class="nx-tpl-modal-body" id="nx-tpl-pub-post-form">
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Post Caption &amp; Hashtags</span>
                <textarea id="nx-pub-post-caption" class="textarea" rows="3" maxlength="3000" required>${escapeHtml(`${editorMeta.title} #nexora #design`)}</textarea>
              </label>
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Visibility</span>
                <select id="nx-pub-post-vis" class="select">
                  <option value="public">Public (Global Feed)</option>
                  <option value="followers">Followers Only</option>
                  <option value="private">Only Me</option>
                </select>
              </label>
              <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button type="submit" class="nx-btn-grad">${svgIcon('send', 14)} Publish Post</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (activeModal.type === 'publish-story') {
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="Publish Template as Story">
            <div class="nx-tpl-modal-head">
              <h3>Share Design to 24h Stories</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal">${svgIcon('close', 16)}</button>
            </div>
            <form class="nx-tpl-modal-body" id="nx-tpl-pub-story-form">
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Story Caption</span>
                <input type="text" id="nx-pub-story-caption" class="input" value="${escapeHtml(editorMeta.title)}" maxlength="400" />
              </label>
              <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button type="submit" class="nx-btn-grad">Publish 24h Story</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    if (activeModal.type === 'share' && activeModal.template) {
      const tpl = activeModal.template;
      const shareUrl = `${window.location.origin}/app.html#template-${tpl.id}`;
      const dms = state.dms || [];
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="Share Template">
            <div class="nx-tpl-modal-head">
              <h3>Share "${escapeHtml(tpl.title)}"</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal">${svgIcon('close', 16)}</button>
            </div>
            <div class="nx-tpl-modal-body">
              <div style="display:flex;gap:8px;">
                <input type="text" class="input" readonly value="${escapeHtml(shareUrl)}" />
                <button type="button" class="nx-btn-grad" data-tpl-act="copy-tpl-link" data-url="${escapeHtml(shareUrl)}">Copy Link</button>
              </div>
              <strong style="font-size:0.84rem;margin-top:4px;">Send via Direct Message</strong>
              ${
                dms.length > 0
                  ? `<div style="display:grid;gap:6px;max-height:220px;overflow-y:auto;">
                      ${dms
                        .map(
                          (dm) => `
                        <div class="file-row" style="justify-content:space-between;padding:8px 10px;">
                          <strong>${escapeHtml(dm.name || dm.groupName || 'Conversation')}</strong>
                          <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.74rem;" data-tpl-act="send-tpl-dm" data-dm-id="${escapeHtml(dm.id)}" data-tpl-id="${escapeHtml(tpl.id)}">Send</button>
                        </div>
                      `
                        )
                        .join('')}
                    </div>`
                  : `<span class="member-sub">Start a conversation in Messages first to share directly in chat.</span>`
              }
            </div>
          </div>
        </div>
      `;
    }

    if (activeModal.type === 'report' && activeModal.template) {
      const tpl = activeModal.template;
      return `
        <div class="nx-tpl-modal-backdrop" id="nx-tpl-modal-backdrop">
          <div class="nx-tpl-modal-card" role="dialog" aria-modal="true" aria-label="Report Template">
            <div class="nx-tpl-modal-head">
              <h3>Report Template</h3>
              <button type="button" class="icon-btn" data-tpl-act="close-modal">${svgIcon('close', 16)}</button>
            </div>
            <form class="nx-tpl-modal-body" id="nx-tpl-report-form" data-tpl-id="${escapeHtml(tpl.id)}" data-tpl-title="${escapeHtml(tpl.title)}">
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Reason</span>
                <select id="nx-rpt-reason" class="select">
                  <option value="Spam or misleading">Spam or misleading</option>
                  <option value="Copyright / stolen design">Copyright / stolen design</option>
                  <option value="Inappropriate content">Inappropriate content</option>
                  <option value="Broken template data">Broken template data</option>
                </select>
              </label>
              <label class="nx-tpl-field">
                <span class="nx-tpl-label">Additional Details</span>
                <textarea id="nx-rpt-details" class="textarea" rows="3" maxlength="500" placeholder="Optional details for admins..."></textarea>
              </label>
              <div style="display:flex;justify-content:flex-end;">
                <button type="submit" class="nx-btn-danger">Submit Report</button>
              </div>
            </form>
          </div>
        </div>
      `;
    }

    return '';
  }

  /* ---------- PUBLIC INTEGRATION RENDERERS ---------- */

  function renderStudioView() {
    let bodyHtml = '';
    if (activeSubView === 'ai') {
      bodyHtml = renderAiGeneratorView();
    } else if (activeSubView === 'editor') {
      bodyHtml = renderCanvasEditorView();
    } else {
      bodyHtml = renderDiscoveryView();
    }

    return `
      <div class="nx-tpl-shell">
        ${renderStudioHeroAndTabs()}
        ${bodyHtml}
        ${renderStudioModalHtml()}
      </div>
    `;
  }

  function renderProfileTemplatesHtml(targetUid, { isPrivateLocked = false } = {}) {
    if (isPrivateLocked) {
      return `<div class="nx-card"><span class="member-sub">Follow this private account to see their templates.</span></div>`;
    }
    const isSelf = targetUid === currentUser?.uid;
    const pool = isSelf
      ? Array.from(myTemplatesMap.values())
      : Array.from(publicTemplatesMap.values()).filter((t) => t.creatorId === targetUid && t.status === 'active');

    pool.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));

    if (pool.length === 0) {
      return `<div class="nx-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="member-sub">${isSelf ? 'You have not created any templates yet.' : 'No public templates published by this creator yet.'}</span>
        ${isSelf ? `<button type="button" class="nx-btn-grad" style="height:32px;font-size:0.78rem;" data-tpl-act="open-studio-ai">Create Template</button>` : ''}
      </div>`;
    }

    return `<div class="nx-tpl-grid">${pool.map((t) => renderTemplateCardHtml(t)).join('')}</div>`;
  }

  function renderAdminTemplatesTabHtml() {
    if (!isAdmin()) return '<span class="member-sub">Administrator permissions required.</span>';
    if (!unsubAdminTpls) subscribeAdminModeration();

    const allModTpls = Array.from(adminTemplatesMap.values()).sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
    const openReports = templateReports.filter((r) => r.status === 'open');

    return `
      <div style="display:grid;gap:14px;">
        <div>
          <strong>Flagged Template Reports (${openReports.length} Open / ${templateReports.length} Total)</strong>
          <div style="display:grid;gap:8px;margin-top:8px;">
            ${
              templateReports
                .map(
                  (r) => `
                <div class="file-row" style="justify-content:space-between;padding:10px;gap:10px;flex-wrap:wrap;">
                  <div>
                    <strong>${escapeHtml(r.templateTitle || r.templateId)}</strong>
                    <div class="member-sub">${escapeHtml(r.reason)} · Status: ${escapeHtml(r.status)} ${r.details ? `· ${escapeHtml(r.details)}` : ''}</div>
                  </div>
                  ${
                    r.status === 'open'
                      ? `<div style="display:flex;gap:6px;">
                          <button type="button" class="nx-btn-danger" style="height:28px;font-size:0.74rem;" data-tpl-act="admin-hide-reported" data-tpl-id="${escapeHtml(r.templateId)}" data-report-id="${escapeHtml(r.id)}">Hide Template &amp; Resolve</button>
                          <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.74rem;" data-tpl-act="admin-resolve-report" data-report-id="${escapeHtml(r.id)}" data-status="dismissed">Dismiss</button>
                        </div>`
                      : ''
                  }
                </div>
              `
                )
                .join('') || '<span class="member-sub">No template reports submitted.</span>'
            }
          </div>
        </div>

        <div style="padding-top:10px;border-top:1px solid var(--nx-border);">
          <strong>Template Moderation &amp; Featuring (${allModTpls.length})</strong>
          <div style="display:grid;gap:8px;margin-top:8px;">
            ${
              allModTpls
                .slice(0, 30)
                .map(
                  (t) => `
                <div class="file-row" style="justify-content:space-between;padding:10px;gap:10px;flex-wrap:wrap;">
                  <div style="min-width:0;">
                    <strong>${escapeHtml(t.title)}</strong>
                    <div class="member-sub">@${escapeHtml(t.creatorUsername || 'creator')} · ${escapeHtml(t.category)} · ${escapeHtml(t.visibility)} · ${escapeHtml(t.status)} ${t.isFeatured ? '· Featured' : ''}</div>
                  </div>
                  <div style="display:flex;gap:5px;flex-wrap:wrap;">
                    <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.73rem;" data-tpl-act="admin-toggle-feature" data-tpl-id="${escapeHtml(t.id)}" data-val="${t.isFeatured ? '0' : '1'}">${t.isFeatured ? 'Unfeature' : 'Feature'}</button>
                    <button type="button" class="nx-btn-soft" style="height:28px;font-size:0.73rem;" data-tpl-act="admin-toggle-status" data-tpl-id="${escapeHtml(t.id)}" data-status="${t.status === 'active' ? 'hidden' : 'active'}">${t.status === 'active' ? 'Hide' : 'Restore'}</button>
                    <button type="button" class="nx-btn-danger" style="height:28px;font-size:0.73rem;" data-tpl-act="delete-template" data-tpl-id="${escapeHtml(t.id)}">Remove</button>
                  </div>
                </div>
              `
                )
                .join('') || '<span class="member-sub">No user-created Firestore templates yet.</span>'
            }
          </div>
        </div>

        <div style="padding-top:10px;border-top:1px solid var(--nx-border);">
          <strong>Custom Studio Categories (${customCategories.length})</strong>
          <form id="nx-admin-tpl-cat-form" style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;">
            <input type="text" id="nx-admin-cat-name" class="input" style="max-width:240px;" placeholder="New category name..." required minlength="2" maxlength="60" />
            <button type="submit" class="nx-btn-grad" style="height:36px;">Add Category</button>
          </form>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${customCategories
              .map(
                (c) => `
              <span class="nx-meta-chip">
                ${escapeHtml(c.name)}
                <button type="button" class="nx-link-action" style="color:var(--danger);" data-tpl-act="admin-del-cat" data-cat-id="${escapeHtml(c.id)}">×</button>
              </span>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  /* ---------- CANVAS THUMBNAILS & LIVE EDITOR STAGE SYNC ---------- */

  async function drawEditorCanvas() {
    const canvas = document.getElementById('nx-tpl-editor-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    await renderTemplateToCanvas(canvas, editorData);
  }

  async function hydrateThumbnails(rootEl) {
    if (!rootEl) return;
    const token = ++thumbRenderToken;

    const cardImgs = Array.from(rootEl.querySelectorAll('img[data-tpl-thumb-id]'));
    for (const imgEl of cardImgs) {
      if (token !== thumbRenderToken) return;
      if (!(imgEl instanceof HTMLImageElement)) continue;
      if (imgEl.getAttribute('src')) continue;
      const tid = imgEl.getAttribute('data-tpl-thumb-id');
      const tpl = findTemplateById(tid);
      if (!tpl?.templateData) continue;
      try {
        const url = await renderTemplateThumbnailDataUrl(tpl.templateData, { maxDim: 400, mime: 'image/jpeg', quality: 0.78 });
        if (token === thumbRenderToken && imgEl.isConnected) {
          imgEl.src = url;
        }
      } catch {}
    }

    const aiImgs = Array.from(rootEl.querySelectorAll('img[data-tpl-thumb-ai-idx]'));
    for (const imgEl of aiImgs) {
      if (token !== thumbRenderToken) return;
      if (!(imgEl instanceof HTMLImageElement)) continue;
      const idx = Number(imgEl.getAttribute('data-tpl-thumb-ai-idx'));
      const tpl = aiResults[idx];
      if (!tpl?.templateData) continue;
      try {
        const url = await renderTemplateThumbnailDataUrl(tpl.templateData, { maxDim: 420, mime: 'image/jpeg', quality: 0.8 });
        if (token === thumbRenderToken && imgEl.isConnected) {
          imgEl.src = url;
        }
      } catch {}
    }
  }

  function afterRender(rootEl) {
    hydrateThumbnails(rootEl);
    drawEditorCanvas();
  }

  /* ---------- DELEGATED DOM & CANVAS STAGE EVENTS ---------- */

  function handleCanvasStageBinding(socialRoot) {
    if (!socialRoot) return;

    let dragState = null; // { mode: 'move' | 'resize', handle: string, layerId: string, startX: number, startY: number, orig: { x, y, width, height }, scale: number, rafPending: boolean }

    socialRoot.addEventListener('pointerdown', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      const handleEl = target.closest('.nx-tpl-handle[data-handle]');
      const boxEl = target.closest('.nx-tpl-layer-box[data-stage-layer-id]');
      const stageFrame = document.getElementById('nx-tpl-stage-frame');
      if (!stageFrame || (!handleEl && !boxEl)) return;

      const layerId = (handleEl || boxEl).getAttribute('data-stage-layer-id');
      const lyr = editorData.layers.find((l) => l.id === layerId);
      if (!lyr || lyr.locked) {
        if (lyr) {
          selectedLayerId = lyr.id;
          requestSocialRender();
        }
        return;
      }

      selectedLayerId = lyr.id;
      const scale = Number(stageFrame.getAttribute('data-scale') || 0.4);
      dragState = {
        mode: handleEl ? 'resize' : 'move',
        handle: handleEl ? handleEl.getAttribute('data-handle') : '',
        layerId: lyr.id,
        startX: e.clientX,
        startY: e.clientY,
        orig: { x: lyr.x, y: lyr.y, width: lyr.width, height: lyr.height },
        scale,
        moved: false,
      };
      try {
        document.getElementById('nx-tpl-stage-overlay')?.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    });

    socialRoot.addEventListener('pointermove', (e) => {
      if (!dragState) return;
      const lyr = editorData.layers.find((l) => l.id === dragState.layerId);
      if (!lyr) return;

      const dx = (e.clientX - dragState.startX) / dragState.scale;
      const dy = (e.clientY - dragState.startY) / dragState.scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragState.moved = true;

      const snapV = document.getElementById('nx-tpl-snap-v');
      const snapH = document.getElementById('nx-tpl-snap-h');

      if (dragState.mode === 'move') {
        let nx = Math.round(dragState.orig.x + dx);
        let ny = Math.round(dragState.orig.y + dy);
        const centerX = editorData.width / 2 - lyr.width / 2;
        const centerY = editorData.height / 2 - lyr.height / 2;
        let showV = false;
        let showH = false;
        if (Math.abs(nx - centerX) < 14) {
          nx = Math.round(centerX);
          showV = true;
        }
        if (Math.abs(ny - centerY) < 14) {
          ny = Math.round(centerY);
          showH = true;
        }
        if (snapV) snapV.hidden = !showV;
        if (snapH) snapH.hidden = !showH;
        lyr.x = nx;
        lyr.y = ny;
      } else {
        const h = dragState.handle;
        let { x, y, width, height } = dragState.orig;
        if (h.includes('e')) width = Math.max(24, Math.round(dragState.orig.width + dx));
        if (h.includes('s')) height = Math.max(20, Math.round(dragState.orig.height + dy));
        if (h.includes('w')) {
          const nextW = Math.max(24, Math.round(dragState.orig.width - dx));
          x = Math.round(dragState.orig.x + (dragState.orig.width - nextW));
          width = nextW;
        }
        if (h.includes('n')) {
          const nextH = Math.max(20, Math.round(dragState.orig.height - dy));
          y = Math.round(dragState.orig.y + (dragState.orig.height - nextH));
          height = nextH;
        }
        lyr.x = x;
        lyr.y = y;
        lyr.width = width;
        lyr.height = height;
      }

      const boxEl = document.querySelector(`.nx-tpl-layer-box[data-stage-layer-id="${CSS.escape(lyr.id)}"]`);
      if (boxEl instanceof HTMLElement) {
        boxEl.style.left = `${Math.round(lyr.x * dragState.scale)}px`;
        boxEl.style.top = `${Math.round(lyr.y * dragState.scale)}px`;
        boxEl.style.width = `${Math.max(12, Math.round(lyr.width * dragState.scale))}px`;
        boxEl.style.height = `${Math.max(12, Math.round(lyr.height * dragState.scale))}px`;
      }
      drawEditorCanvas();
    });

    const endDrag = () => {
      if (!dragState) return;
      const snapV = document.getElementById('nx-tpl-snap-v');
      const snapH = document.getElementById('nx-tpl-snap-h');
      if (snapV) snapV.hidden = true;
      if (snapH) snapH.hidden = true;
      const wasMoved = dragState.moved;
      dragState = null;
      if (wasMoved) {
        commitEditorMutation(editorData, { pushHistory: true, redraw: false });
      }
      requestSocialRender();
    };
    socialRoot.addEventListener('pointerup', endDrag);
    socialRoot.addEventListener('pointercancel', endDrag);

    socialRoot.addEventListener('dblclick', (e) => {
      const boxEl = e.target instanceof Element ? e.target.closest('.nx-tpl-layer-box[data-stage-layer-id]') : null;
      if (!boxEl) return;
      const id = boxEl.getAttribute('data-stage-layer-id');
      const lyr = editorData.layers.find((l) => l.id === id);
      if (lyr && lyr.type === 'text' && !lyr.locked) {
        selectedLayerId = id;
        inlineEditLayerId = id;
        requestSocialRender();
        setTimeout(() => document.getElementById('nx-tpl-inline-textarea')?.focus(), 20);
      }
    });
  }

  function bindEvents() {
    const socialRoot = document.getElementById('nx-social-root');
    if (!socialRoot) return;

    handleCanvasStageBinding(socialRoot);

    // Keyboard shortcuts inside Canvas Editor
    document.addEventListener('keydown', (e) => {
      if (activeSubView !== 'editor') return;
      const el = document.activeElement;
      const isTyping =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      if (isTyping) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) performRedo();
        else performUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        performRedo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerId) {
        const lyr = editorData.layers.find((l) => l.id === selectedLayerId);
        if (lyr && !lyr.locked) {
          e.preventDefault();
          editorData.layers = editorData.layers.filter((l) => l.id !== selectedLayerId);
          selectedLayerId = editorData.layers[0]?.id || '';
          commitEditorMutation(editorData);
          requestSocialRender();
        }
      }
    });

    socialRoot.addEventListener('input', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.id === 'nx-tpl-search-input' && t instanceof HTMLInputElement) {
        searchQuery = t.value;
        requestSocialRender();
        return;
      }

      if (t.id === 'nx-ed-title-input' && t instanceof HTMLInputElement) {
        editorMeta.title = t.value;
        autosaveState = 'unsaved';
        updateAutosaveDom();
        return;
      }

      // AI form live bindings
      if (t.id === 'nx-ai-prompt' && t instanceof HTMLTextAreaElement) { aiForm.prompt = t.value; return; }
      if (t.id === 'nx-ai-name' && t instanceof HTMLInputElement) { aiForm.templateName = t.value; return; }
      if (t.id === 'nx-ai-color-primary' && t instanceof HTMLInputElement) { aiForm.primaryColor = t.value; return; }
      if (t.id === 'nx-ai-color-secondary' && t instanceof HTMLInputElement) { aiForm.secondaryColor = t.value; return; }
      if (t.id === 'nx-ai-color-accent' && t instanceof HTMLInputElement) { aiForm.accentColor = t.value; return; }

      // Provider form bindings
      if (t.id === 'nx-prov-label' && t instanceof HTMLInputElement) { providerForm.label = t.value; return; }
      if (t.id === 'nx-prov-key' && t instanceof HTMLInputElement) { providerForm.apiKey = t.value; return; }
      if (t.id === 'nx-prov-url' && t instanceof HTMLInputElement) { providerForm.baseUrl = t.value; return; }
      if (t.id === 'nx-prov-text-model' && t instanceof HTMLInputElement) { providerForm.textModel = t.value; return; }
      if (t.id === 'nx-prov-image-model' && t instanceof HTMLInputElement) { providerForm.imageModel = t.value; return; }

      // Live Editor Layer & Background bindings
      if (t.id === 'nx-ed-lyr-text' && t instanceof HTMLTextAreaElement) {
        const lyr = editorData.layers.find((l) => l.id === selectedLayerId);
        if (lyr) {
          lyr.text = t.value;
          commitEditorMutation(editorData, { pushHistory: false });
        }
        return;
      }

      if (t.id === 'nx-tpl-inline-textarea' && t instanceof HTMLTextAreaElement) {
        const lyr = editorData.layers.find((l) => l.id === inlineEditLayerId);
        if (lyr) {
          lyr.text = t.value;
          commitEditorMutation(editorData, { pushHistory: false });
        }
        return;
      }

      if (t.id === 'nx-ed-bg-color' && t instanceof HTMLInputElement) { editorData.background.color = t.value; commitEditorMutation(editorData, { pushHistory: false }); return; }
      if (t.id === 'nx-ed-bg-from' && t instanceof HTMLInputElement) { editorData.background.gradientFrom = t.value; commitEditorMutation(editorData, { pushHistory: false }); return; }
      if (t.id === 'nx-ed-bg-to' && t instanceof HTMLInputElement) { editorData.background.gradientTo = t.value; commitEditorMutation(editorData, { pushHistory: false }); return; }
      if (t.id === 'nx-ed-bg-angle' && t instanceof HTMLInputElement) { editorData.background.gradientAngle = Number(t.value); commitEditorMutation(editorData, { pushHistory: false }); return; }
      if (t.id === 'nx-ed-bg-pat-op' && t instanceof HTMLInputElement) { editorData.background.patternOpacity = Number(t.value); commitEditorMutation(editorData, { pushHistory: false }); return; }
      if (t.id === 'nx-ed-bg-overlay-color' && t instanceof HTMLInputElement) { editorData.background.overlayColor = t.value; commitEditorMutation(editorData, { pushHistory: false }); return; }
      if (t.id === 'nx-ed-bg-overlay-op' && t instanceof HTMLInputElement) { editorData.background.overlayOpacity = Number(t.value); commitEditorMutation(editorData, { pushHistory: false }); return; }

      const lyr = editorData.layers.find((l) => l.id === selectedLayerId);
      if (!lyr) return;

      if (t.hasAttribute('data-lyr-num') && t instanceof HTMLInputElement) {
        const key = t.getAttribute('data-lyr-num');
        lyr[key] = Number(t.value || 0);
        commitEditorMutation(editorData, { pushHistory: false });
      } else if (t.hasAttribute('data-lyr-range') && t instanceof HTMLInputElement) {
        const key = t.getAttribute('data-lyr-range');
        lyr[key] = Number(t.value || 0);
        commitEditorMutation(editorData, { pushHistory: false });
      } else if (t.hasAttribute('data-lyr-prop') && (t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) {
        const key = t.getAttribute('data-lyr-prop');
        lyr[key] = t.value;
        commitEditorMutation(editorData, { pushHistory: false });
      }
    });

    socialRoot.addEventListener('change', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      // Filters
      if (t.id === 'nx-tpl-filter-cat' && t instanceof HTMLSelectElement) { filterCategory = t.value; pageLimit = STUDIO_PAGE_SIZE; requestSocialRender(); return; }
      if (t.id === 'nx-tpl-filter-style' && t instanceof HTMLSelectElement) { filterStyle = t.value; pageLimit = STUDIO_PAGE_SIZE; requestSocialRender(); return; }
      if (t.id === 'nx-tpl-filter-ratio' && t instanceof HTMLSelectElement) { filterRatio = t.value; pageLimit = STUDIO_PAGE_SIZE; requestSocialRender(); return; }
      if (t.id === 'nx-tpl-filter-sort' && t instanceof HTMLSelectElement) { sortBy = t.value; pageLimit = STUDIO_PAGE_SIZE; requestSocialRender(); return; }

      // AI form selects & file
      if (t.id === 'nx-ai-provider-select' && t instanceof HTMLSelectElement) { aiForm.providerConfigId = t.value; requestSocialRender(); return; }
      if (t.id === 'nx-ai-category' && t instanceof HTMLSelectElement) { aiForm.category = t.value; return; }
      if (t.id === 'nx-ai-style' && t instanceof HTMLSelectElement) { aiForm.style = t.value; return; }
      if (t.id === 'nx-ai-ratio' && t instanceof HTMLSelectElement) { aiForm.aspectRatio = t.value; requestSocialRender(); return; }
      if (t.id === 'nx-ai-font' && t instanceof HTMLSelectElement) { aiForm.fontPreference = t.value; return; }
      if (t.id === 'nx-ai-bg-type' && t instanceof HTMLSelectElement) { aiForm.backgroundType = t.value; return; }
      if (t.id === 'nx-ai-variations' && t instanceof HTMLSelectElement) { aiForm.variationCount = Number(t.value); return; }
      if (t.id === 'nx-ai-custom-w' && t instanceof HTMLInputElement) { aiForm.customWidth = Number(t.value); return; }
      if (t.id === 'nx-ai-custom-h' && t instanceof HTMLInputElement) { aiForm.customHeight = Number(t.value); return; }
      if (t.id === 'nx-ai-gen-bg-img' && t instanceof HTMLInputElement) { aiForm.generateImageAsset = t.checked; return; }

      if (t.id === 'nx-ai-ref-file' && t instanceof HTMLInputElement && t.files?.[0]) {
        try {
          aiForm.referenceImageDataUrl = await compressImageFile(t.files[0], { maxW: 960, maxH: 960, maxBytes: 300000 });
          requestSocialRender();
        } catch (err) {
          showToast(formatFriendlyError(err, 'Could not load reference image.'), 'error');
        }
        return;
      }

      if (t.id === 'nx-prov-kind' && t instanceof HTMLSelectElement) {
        providerForm.provider = t.value;
        providerForm.textModel = t.value === 'gemini' ? 'gemini-4-hydrogen' : 'gpt-4o-mini';
        providerForm.imageModel = t.value === 'gemini' ? 'gemini-3.1-flash-lite-image' : t.value === 'openai' ? 'dall-e-3' : '';
        requestSocialRender();
        return;
      }

      // Editor Canvas selects & file uploads
      if (t.id === 'nx-ed-aspect' && t instanceof HTMLSelectElement) {
        const dims = resolveDimensionsForRatio(t.value, editorData.width, editorData.height);
        editorData.aspectRatio = dims.aspectRatio;
        editorData.width = dims.width;
        editorData.height = dims.height;
        commitEditorMutation(editorData);
        requestSocialRender();
        return;
      }
      if (t.id === 'nx-ed-bg-type' && t instanceof HTMLSelectElement) {
        editorData.background.type = t.value;
        commitEditorMutation(editorData);
        requestSocialRender();
        return;
      }
      if (t.id === 'nx-ed-bg-pattern' && t instanceof HTMLSelectElement) {
        editorData.background.pattern = t.value;
        commitEditorMutation(editorData);
        requestSocialRender();
        return;
      }
      if (t.id === 'nx-ed-bg-file' && t instanceof HTMLInputElement && t.files?.[0]) {
        try {
          editorData.background.imageUrl = await compressImageFile(t.files[0], { maxW: 1200, maxH: 1200, maxBytes: 180000 });
          editorData.background.type = 'image';
          commitEditorMutation(editorData);
          requestSocialRender();
        } catch (err) {
          showToast(formatFriendlyError(err, 'Could not process background image.'), 'error');
        }
        return;
      }
      if (t.id === 'nx-ed-lyr-img-file' && t instanceof HTMLInputElement && t.files?.[0]) {
        const lyr = editorData.layers.find((l) => l.id === selectedLayerId && l.type === 'image');
        if (lyr) {
          try {
            lyr.src = await compressImageFile(t.files[0], { maxW: 1080, maxH: 1080, maxBytes: 180000 });
            commitEditorMutation(editorData);
            requestSocialRender();
          } catch (err) {
            showToast(formatFriendlyError(err, 'Could not process image layer.'), 'error');
          }
        }
        return;
      }

      if (t.id === 'nx-ed-lyr-text' && t instanceof HTMLTextAreaElement) {
        historyStack.push(editorData);
        return;
      }

      const lyr = editorData.layers.find((l) => l.id === selectedLayerId);
      if (lyr && t.hasAttribute('data-lyr-bool') && t instanceof HTMLInputElement) {
        lyr[t.getAttribute('data-lyr-bool')] = t.checked;
        commitEditorMutation(editorData);
        requestSocialRender();
      } else if (lyr && (t.hasAttribute('data-lyr-prop') || t.hasAttribute('data-lyr-num') || t.hasAttribute('data-lyr-range'))) {
        historyStack.push(editorData);
      }
    });

    socialRoot.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      if (form.id === 'nx-tpl-ai-form') {
        e.preventDefault();
        await runAiGeneration();
        return;
      }
      if (form.id === 'nx-tpl-provider-form') {
        e.preventDefault();
        await saveProviderConfig();
        return;
      }
      if (form.id === 'nx-tpl-save-form') {
        e.preventDefault();
        editorMeta.title = document.getElementById('nx-save-title')?.value?.trim() || editorMeta.title;
        editorMeta.description = document.getElementById('nx-save-desc')?.value?.trim() || '';
        editorMeta.category = document.getElementById('nx-save-cat')?.value || editorMeta.category;
        editorMeta.style = document.getElementById('nx-save-style')?.value || editorMeta.style;
        editorMeta.tags = (document.getElementById('nx-save-tags')?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
        editorMeta.visibility = document.getElementById('nx-save-vis')?.value || 'private';
        const perm = document.getElementById('nx-save-perm')?.value || 'public_remix';
        editorMeta.usagePermission = perm;
        editorMeta.allowRemix = perm !== 'view_only';
        const ok = await saveEditorToFirestore({ asNewCopy: false });
        if (ok) {
          activeModal = null;
          showToast(editorMeta.visibility === 'public' ? 'Template published to NEXORA Community Library!' : 'Template saved to My Templates!', 'success');
          requestSocialRender();
        }
        return;
      }
      if (form.id === 'nx-tpl-export-form') {
        e.preventDefault();
        const format = document.getElementById('nx-exp-format')?.value || 'png';
        const scale = Number(document.getElementById('nx-exp-scale')?.value || 1);
        const quality = Number(document.getElementById('nx-exp-quality')?.value || 0.9);
        try {
          await triggerTemplateDownload(editorData, editorMeta.title || 'nexora-template', { format, scale, quality });
          if (editorMeta.isPersisted && editorMeta.id) {
            recordTemplateUsage(editorMeta.id, `export_${format}`);
          }
          activeModal = null;
          showToast(`Exported ${format.toUpperCase()} artwork cleanly!`, 'success');
          requestSocialRender();
        } catch (err) {
          showToast(formatFriendlyError(err, 'Could not export artwork.'), 'error');
        }
        return;
      }
      if (form.id === 'nx-tpl-pub-post-form') {
        e.preventDefault();
        const caption = document.getElementById('nx-pub-post-caption')?.value || '';
        const visibility = document.getElementById('nx-pub-post-vis')?.value || 'public';
        await publishTemplateAsPost({ caption, visibility });
        return;
      }
      if (form.id === 'nx-tpl-pub-story-form') {
        e.preventDefault();
        const caption = document.getElementById('nx-pub-story-caption')?.value || '';
        await publishTemplateAsStory({ caption });
        return;
      }
      if (form.id === 'nx-tpl-report-form') {
        e.preventDefault();
        await submitTemplateReport({
          templateId: form.getAttribute('data-tpl-id') || '',
          templateTitle: form.getAttribute('data-tpl-title') || '',
          reason: document.getElementById('nx-rpt-reason')?.value || 'Inappropriate content',
          details: document.getElementById('nx-rpt-details')?.value || '',
        });
        return;
      }
      if (form.id === 'nx-admin-tpl-cat-form' && isAdmin()) {
        e.preventDefault();
        const name = document.getElementById('nx-admin-cat-name')?.value?.trim() || '';
        if (!name) return;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
        const catId = `tcat-${slug}-${Date.now().toString(36).slice(-4)}`;
        try {
          await setDoc(doc(db, 'template_categories', catId), {
            id: catId,
            name: name.slice(0, 60),
            slug: slug.slice(0, 60),
            description: '',
            active: true,
            sortOrder: customCategories.length + 1,
            updatedBy: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          showToast(`Added template category "${name}"`, 'success');
          requestSocialRender();
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `template_categories/${catId}`, 'Could not add category.');
        }
      }
    });

    socialRoot.addEventListener('click', async (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      if (target.id === 'nx-tpl-modal-backdrop') {
        activeModal = null;
        requestSocialRender();
        return;
      }

      const actEl = target.closest('[data-tpl-act]');
      if (!actEl) return;
      const act = actEl.getAttribute('data-tpl-act');

      switch (act) {
        case 'switch-subview':
          activeSubView = actEl.getAttribute('data-subview') || 'discover';
          pageLimit = STUDIO_PAGE_SIZE;
          requestSocialRender();
          break;
        case 'quick-cat':
          filterCategory = actEl.getAttribute('data-cat') || 'All';
          pageLimit = STUDIO_PAGE_SIZE;
          requestSocialRender();
          break;
        case 'browse-category':
          filterCategory = actEl.getAttribute('data-cat') || 'All';
          activeSubView = 'discover';
          pageLimit = STUDIO_PAGE_SIZE;
          requestSocialRender();
          break;
        case 'ai-for-category':
          aiForm.category = actEl.getAttribute('data-cat') || 'Social Media Posts';
          activeSubView = 'ai';
          requestSocialRender();
          break;
        case 'show-more-templates':
          pageLimit += STUDIO_PAGE_SIZE;
          requestSocialRender();
          break;
        case 'new-blank':
          createBlankInEditor();
          break;
        case 'open-studio-ai':
          activeSubView = 'ai';
          navigateTo('templates');
          break;
        case 'open-ai-setup':
          providerTestResult = null;
          activeModal = { type: 'ai-setup' };
          refreshServerProviders();
          requestSocialRender();
          break;
        case 'close-modal':
          activeModal = null;
          requestSocialRender();
          break;
        case 'fill-ai-prompt':
          aiForm.prompt = actEl.getAttribute('data-prompt') || '';
          requestSocialRender();
          break;
        case 'clear-ai-ref':
          aiForm.referenceImageDataUrl = '';
          requestSocialRender();
          break;
        case 'retry-ai-gen':
          await runAiGeneration();
          break;
        case 'test-provider':
          await testProviderConnection(actEl.getAttribute('data-config-id') || 'platform');
          break;
        case 'test-provider-form':
          await testProviderConnection('');
          break;
        case 'use-provider':
          aiForm.providerConfigId = actEl.getAttribute('data-config-id') || 'platform';
          activeModal = null;
          activeSubView = 'ai';
          requestSocialRender();
          break;
        case 'delete-provider':
          await deleteProviderConfig(actEl.getAttribute('data-config-id') || '');
          break;
        case 'preview': {
          const tpl = findTemplateById(actEl.getAttribute('data-tpl-id'));
          if (tpl) {
            activeModal = { type: 'preview', template: tpl };
            requestSocialRender();
          }
          break;
        }
        case 'use-template': {
          const tpl = findTemplateById(actEl.getAttribute('data-tpl-id'));
          if (tpl) {
            navigateTo('templates');
            openTemplateInEditor(tpl, { cloneMode: true });
          }
          break;
        }
        case 'edit-own': {
          const tpl = findTemplateById(actEl.getAttribute('data-tpl-id'));
          if (tpl) {
            navigateTo('templates');
            openTemplateInEditor(tpl, { cloneMode: false });
          }
          break;
        }
        case 'customize-ai-var': {
          const idx = Number(actEl.getAttribute('data-idx'));
          const item = aiResults[idx];
          if (item) {
            openTemplateInEditor(item, { cloneMode: true });
          }
          break;
        }
        case 'save-ai-var': {
          const idx = Number(actEl.getAttribute('data-idx'));
          const vis = actEl.getAttribute('data-vis') || 'private';
          const item = aiResults[idx];
          if (item && currentUser) {
            openTemplateInEditor(item, { cloneMode: true });
            editorMeta.visibility = vis;
            await saveEditorToFirestore({ asNewCopy: false });
            showToast('AI template published to NEXORA Community Library!', 'success');
          }
          break;
        }
        case 'toggle-like':
          await toggleTemplateLike(actEl.getAttribute('data-tpl-id'));
          break;
        case 'toggle-save':
          await toggleTemplateSave(actEl.getAttribute('data-tpl-id'));
          break;
        case 'open-share': {
          const tpl = findTemplateById(actEl.getAttribute('data-tpl-id'));
          if (tpl) {
            activeModal = { type: 'share', template: tpl };
            requestSocialRender();
          }
          break;
        }
        case 'copy-tpl-link': {
          const url = actEl.getAttribute('data-url') || '';
          if (url) {
            navigator.clipboard?.writeText(url).catch(() => {});
            showToast('Template link copied!', 'success');
          }
          break;
        }
        case 'send-tpl-dm': {
          const dmId = actEl.getAttribute('data-dm-id');
          const tpl = findTemplateById(actEl.getAttribute('data-tpl-id'));
          await shareTemplateToDm(dmId, tpl);
          break;
        }
        case 'open-report': {
          const tpl = findTemplateById(actEl.getAttribute('data-tpl-id'));
          if (tpl) {
            activeModal = { type: 'report', template: tpl };
            requestSocialRender();
          }
          break;
        }
        case 'delete-template':
          await deleteOwnTemplate(actEl.getAttribute('data-tpl-id'));
          break;

        // Editor toolbars
        case 'undo':
          performUndo();
          break;
        case 'redo':
          performRedo();
          break;
        case 'set-zoom':
          zoomMode = actEl.getAttribute('data-zoom') || 'fit';
          requestSocialRender();
          break;
        case 'add-layer': {
          const type = actEl.getAttribute('data-type') || 'text';
          const lyr = createNewLayer(type, editorData);
          editorData.layers.push(lyr);
          selectedLayerId = lyr.id;
          commitEditorMutation(editorData);
          requestSocialRender();
          break;
        }
        case 'add-sticker-preset': {
          const preset = TEMPLATE_STICKERS[Number(actEl.getAttribute('data-idx'))] || TEMPLATE_STICKERS[0];
          const lyr = createNewLayer('sticker', editorData, {
            emoji: preset.emoji,
            text: preset.text,
            name: `Badge: ${preset.text}`,
          });
          editorData.layers.push(lyr);
          selectedLayerId = lyr.id;
          commitEditorMutation(editorData);
          requestSocialRender();
          break;
        }
        case 'select-layer':
          selectedLayerId = actEl.getAttribute('data-layer-id') || '';
          inlineEditLayerId = '';
          requestSocialRender();
          break;
        case 'deselect-layer':
          selectedLayerId = '';
          inlineEditLayerId = '';
          requestSocialRender();
          break;
        case 'close-inline-edit':
          inlineEditLayerId = '';
          historyStack.push(editorData);
          requestSocialRender();
          break;
        case 'center-layer-h': {
          const lyr = editorData.layers.find((l) => l.id === selectedLayerId);
          if (lyr) {
            lyr.x = Math.round((editorData.width - lyr.width) / 2);
            commitEditorMutation(editorData);
            requestSocialRender();
          }
          break;
        }
        case 'center-layer-v': {
          const lyr = editorData.layers.find((l) => l.id === selectedLayerId);
          if (lyr) {
            lyr.y = Math.round((editorData.height - lyr.height) / 2);
            commitEditorMutation(editorData);
            requestSocialRender();
          }
          break;
        }
        case 'layer-up':
        case 'layer-down': {
          e.stopPropagation();
          const id = actEl.getAttribute('data-layer-id');
          const sorted = [...editorData.layers].sort((a, b) => a.zIndex - b.zIndex);
          const idx = sorted.findIndex((l) => l.id === id);
          if (idx >= 0) {
            const swapIdx = act === 'layer-up' ? idx + 1 : idx - 1;
            if (swapIdx >= 0 && swapIdx < sorted.length) {
              const tmp = sorted[idx];
              sorted[idx] = sorted[swapIdx];
              sorted[swapIdx] = tmp;
              sorted.forEach((l, i) => { l.zIndex = i + 1; });
              editorData.layers = sorted;
              commitEditorMutation(editorData);
              requestSocialRender();
            }
          }
          break;
        }
        case 'layer-vis': {
          e.stopPropagation();
          const lyr = editorData.layers.find((l) => l.id === actEl.getAttribute('data-layer-id'));
          if (lyr) {
            lyr.visible = lyr.visible === false;
            commitEditorMutation(editorData);
            requestSocialRender();
          }
          break;
        }
        case 'layer-lock': {
          e.stopPropagation();
          const lyr = editorData.layers.find((l) => l.id === actEl.getAttribute('data-layer-id'));
          if (lyr) {
            lyr.locked = !lyr.locked;
            commitEditorMutation(editorData);
            requestSocialRender();
          }
          break;
        }
        case 'layer-dup': {
          e.stopPropagation();
          const src = editorData.layers.find((l) => l.id === actEl.getAttribute('data-layer-id'));
          if (src && editorData.layers.length < 60) {
            const copy = JSON.parse(JSON.stringify(src));
            copy.id = `lyr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
            copy.name = `${src.name} Copy`;
            copy.x += 24;
            copy.y += 24;
            copy.zIndex = editorData.layers.reduce((m, l) => Math.max(m, l.zIndex), 0) + 1;
            editorData.layers.push(copy);
            selectedLayerId = copy.id;
            commitEditorMutation(editorData);
            requestSocialRender();
          }
          break;
        }
        case 'layer-del': {
          e.stopPropagation();
          const id = actEl.getAttribute('data-layer-id');
          editorData.layers = editorData.layers.filter((l) => l.id !== id);
          if (selectedLayerId === id) selectedLayerId = editorData.layers[0]?.id || '';
          commitEditorMutation(editorData);
          requestSocialRender();
          break;
        }
        case 'clear-bg-image':
          editorData.background.imageUrl = '';
          editorData.background.type = 'gradient';
          commitEditorMutation(editorData);
          requestSocialRender();
          break;
        case 'clear-layer-img': {
          const lyr = editorData.layers.find((l) => l.id === selectedLayerId && l.type === 'image');
          if (lyr) {
            lyr.src = '';
            commitEditorMutation(editorData);
            requestSocialRender();
          }
          break;
        }
        case 'open-save-modal':
          activeModal = { type: 'save' };
          requestSocialRender();
          break;
        case 'save-as-copy': {
          editorMeta.title = document.getElementById('nx-save-title')?.value?.trim() || `${editorMeta.title} Copy`;
          const ok = await saveEditorToFirestore({ asNewCopy: true });
          if (ok) {
            activeModal = null;
            showToast('Saved as a new template copy!', 'success');
            requestSocialRender();
          }
          break;
        }
        case 'open-export-modal':
          activeModal = { type: 'export' };
          requestSocialRender();
          break;
        case 'open-post-publish':
          activeModal = { type: 'publish-post' };
          requestSocialRender();
          break;
        case 'open-story-publish':
          activeModal = { type: 'publish-story' };
          requestSocialRender();
          break;

        // Admin Moderation Actions
        case 'admin-resolve-report': {
          if (!isAdmin()) break;
          const rptId = actEl.getAttribute('data-report-id');
          const status = actEl.getAttribute('data-status') || 'resolved';
          if (rptId) {
            await updateDoc(doc(db, 'template_reports', rptId), {
              status,
              reviewedBy: currentUser.uid,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
            showToast(`Report ${status}`);
          }
          break;
        }
        case 'admin-hide-reported': {
          if (!isAdmin()) break;
          const tplId = actEl.getAttribute('data-tpl-id');
          const rptId = actEl.getAttribute('data-report-id');
          if (tplId) {
            await updateDoc(doc(db, 'templates', tplId), {
              status: 'hidden',
              moderatedBy: currentUser.uid,
              moderationNote: 'Hidden via report moderation',
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
          if (rptId) {
            await updateDoc(doc(db, 'template_reports', rptId), {
              status: 'resolved',
              reviewedBy: currentUser.uid,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
          showToast('Template hidden and report resolved', 'success');
          break;
        }
        case 'admin-toggle-feature': {
          if (!isAdmin()) break;
          const tplId = actEl.getAttribute('data-tpl-id');
          const val = actEl.getAttribute('data-val') === '1';
          if (tplId) {
            await updateDoc(doc(db, 'templates', tplId), {
              isFeatured: val,
              moderatedBy: currentUser.uid,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
            showToast(val ? 'Template featured!' : 'Removed from featured');
          }
          break;
        }
        case 'admin-toggle-status': {
          if (!isAdmin()) break;
          const tplId = actEl.getAttribute('data-tpl-id');
          const status = actEl.getAttribute('data-status') || 'hidden';
          if (tplId) {
            await updateDoc(doc(db, 'templates', tplId), {
              status,
              moderatedBy: currentUser.uid,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
            showToast(`Template status updated to ${status}`);
          }
          break;
        }
        case 'admin-del-cat': {
          if (!isAdmin()) break;
          const catId = actEl.getAttribute('data-cat-id');
          if (catId) {
            await deleteDoc(doc(db, 'template_categories', catId)).catch(() => {});
            showToast('Category removed');
          }
          break;
        }
      }
    });
  }

  function handleDeepLink(hash) {
    if (!hash || !hash.startsWith('#template')) return false;
    activeSubView = 'discover';
    if (hash.startsWith('#template-')) {
      const targetId = hash.slice('#template-'.length).trim();
      const found = findTemplateById(targetId);
      if (found) {
        activeModal = { type: 'preview', template: found };
      } else {
        pendingPreviewTemplateId = targetId;
      }
    }
    return true;
  }

  bindEvents();

  return {
    subscribeAll,
    cleanup,
    renderStudioView,
    renderModalHtml: renderStudioModalHtml,
    renderProfileTemplatesHtml,
    renderAdminTemplatesTabHtml,
    afterRender,
    handleDeepLink,
    openCreateWithAi: () => {
      activeSubView = 'ai';
      navigateTo('templates');
    },
    getTemplatesForSearch: () => getAllDiscoverableTemplates(),
    getMyTemplatesCount: () => myTemplatesMap.size,
  };
}
