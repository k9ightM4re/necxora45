import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FlipHorizontal,
  Image as ImageIcon,
  Layers,
  Search,
  Send,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { getActiveIdToken } from '../../js/session.js';
import { apiV1Request } from './apiClient';
import {
  captureCanvasDataUrl,
  initializeMediaPipeAdapters,
  renderPipelineFrame,
  startCameraStream,
  stopCameraStream,
  type BackgroundEffectPreset,
  type CameraPipelineSettings,
  type ColorGradePreset,
  type FaceEffectPreset,
  type PipelineRuntimeStatus,
} from './cameraPipeline';

export const CAMERA_HANDOFF_STORAGE_KEY = 'nexora_camera_handoff_image';

interface NexoraCameraViewProps {
  onNavigate: (section: string, opts?: Record<string, string>) => void;
}

const DEFAULT_SETTINGS: CameraPipelineSettings = {
  faceEffect: 'none',
  backgroundEffect: 'none',
  colorGrade: 'natural',
  outfitFramingGuide: true,
  mirrorPreview: true,
};

export const NexoraCameraView: React.FC<NexoraCameraViewProps> = ({ onNavigate }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const staticImgRef = useRef<HTMLImageElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [settings, setSettings] = useState<CameraPipelineSettings>(DEFAULT_SETTINGS);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineRuntimeStatus>({
    trackingBackend: 'canvas-fallback',
    segmentationBackend: 'canvas-fallback',
    statusNote: 'Initializing vision pipeline...',
  });

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [fallbackImageUrl, setFallbackImageUrl] = useState('');

  const [recording, setRecording] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState('');
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState('');

  const [studioConsent, setStudioConsent] = useState(false);
  const [studioLabel, setStudioLabel] = useState('Camera Look Capture');
  const [postCaption, setPostCaption] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void initializeMediaPipeAdapters().then(setPipelineStatus);
  }, []);

  const bootCamera = useCallback(async (mode: 'user' | 'environment') => {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
    setCameraError(null);
    try {
      const stream = await startCameraStream(mode);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (err) {
      setCameraActive(false);
      setCameraError(
        err instanceof Error
          ? `${err.message} Upload an outfit photo below to apply studio framing, look grading, or launch Visual Search.`
          : 'Camera permission denied or hardware unavailable.'
      );
    }
  }, []);

  useEffect(() => {
    void bootCamera(facingMode);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopCameraStream(streamRef.current);
      streamRef.current = null;
    };
  }, [bootCamera, facingMode]);

  useEffect(() => {
    let active = true;
    const drawLoop = (ts: number) => {
      if (!active) return;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const src =
          cameraActive && video && video.readyState >= 2
            ? video
            : staticImgRef.current && staticImgRef.current.complete
              ? staticImgRef.current
              : null;

        if (src) {
          renderPipelineFrame(ctx, src, canvas.width, canvas.height, settings, ts);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#2A0A0D';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#FFF0DC';
          ctx.font = '500 14px "DM Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            cameraError ? 'Upload a photo below or enable camera permission' : 'Connecting camera feed...',
            canvas.width / 2,
            canvas.height / 2
          );
        }
      }
      rafRef.current = requestAnimationFrame(drawLoop);
    };
    rafRef.current = requestAnimationFrame(drawLoop);
    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraActive, cameraError, settings]);

  const handleFallbackUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4_000_000) {
      setBanner({ tone: 'error', text: 'Please select an image under 4 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const img = new Image();
        img.onload = () => {
          staticImgRef.current = img;
          setFallbackImageUrl(reader.result as string);
        };
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCapturePhoto = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = captureCanvasDataUrl(canvas, 960);
    setCapturedPhotoUrl(dataUrl);
    setBanner({ tone: 'info', text: 'Look captured cleanly. Choose a workflow below.' });
  };

  const handleToggleRecording = () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
      setBanner({ tone: 'warn', text: 'In-browser video capture is unsupported in this browser. Use photo capture instead.' });
      return;
    }
    try {
      const stream = canvas.captureStream(24);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recordedChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setBanner({ tone: 'info', text: 'Short video clip recorded locally.' });
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setBanner({ tone: 'error', text: 'Could not start canvas video recording.' });
    }
  };

  const uploadMediaFile = async (dataUrl: string, kind: 'studio' | 'post', name: string): Promise<string> => {
    const token = await getActiveIdToken();
    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        name,
        kind,
        visibility: kind === 'studio' ? 'private' : 'public',
        dataUrl,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.media?.url) {
      throw new Error(json?.error?.message || json?.error || `Upload failed (${res.status})`);
    }
    return String(json.media.url);
  };

  const handleSearchVisually = () => {
    const targetUrl = capturedPhotoUrl || fallbackImageUrl;
    if (!targetUrl) return;
    try {
      sessionStorage.setItem(CAMERA_HANDOFF_STORAGE_KEY, targetUrl);
    } catch {
      // ignore storage quota edge cases
    }
    onNavigate('visual-search');
  };

  const handleSaveToStudio = async () => {
    const targetUrl = capturedPhotoUrl || fallbackImageUrl;
    if (!targetUrl) return;
    if (!studioConsent) {
      setBanner({ tone: 'warn', text: 'Confirm explicit consent before saving to your private AI Style Studio.' });
      return;
    }
    setBusyAction('studio');
    setBanner(null);
    try {
      const privateUrl = await uploadMediaFile(targetUrl, 'studio', 'camera-studio-look.jpg');
      await apiV1Request('/studio/photos', {
        method: 'POST',
        body: JSON.stringify({
          label: studioLabel.trim() || 'Nexora Camera Capture',
          mediaUrl: privateUrl,
          consentAccepted: true,
        }),
      });
      setBanner({ tone: 'info', text: 'Saved privately to AI Style Studio!' });
      onNavigate('studio');
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to save to Studio.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePublishSocialPost = async () => {
    const targetUrl = capturedPhotoUrl || fallbackImageUrl;
    if (!targetUrl) return;
    setBusyAction('post');
    setBanner(null);
    try {
      const publicUrl = await uploadMediaFile(targetUrl, 'post', 'camera-outfit-post.jpg');
      await apiV1Request('/posts', {
        method: 'POST',
        body: JSON.stringify({
          content: postCaption.trim() || 'Captured in Nexora Camera #NexoraStyle',
          visibility: 'public',
          media: [{ type: 'image', url: publicUrl, name: 'Nexora Camera Look' }],
        }),
      });
      setBanner({ tone: 'info', text: 'Published photo directly to your Home social feed!' });
      setPostCaption('');
    } catch (err) {
      setBanner({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to publish social post.' });
    } finally {
      setBusyAction(null);
    }
  };

  const previewUrl = capturedPhotoUrl || fallbackImageUrl;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-[#790B13] dark:text-[#F2B8B5]">
            <Camera className="h-4 w-4" />
            <span>Nexora Camera</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-[var(--nx-text)]">
            Outfit capture, studio framing &amp; visual lookup
          </h1>
          <p className="mt-1 text-sm text-[var(--nx-text-secondary)]">
            Capture styled outfits or upload a photo with separated face effects, background presets, and garment framing guides.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = facingMode === 'user' ? 'environment' : 'user';
              setFacingMode(next);
              setSettings((s) => ({ ...s, mirrorPreview: next === 'user' }));
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13]"
          >
            <FlipHorizontal className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F2B8B5]" />
            <span>{facingMode === 'user' ? 'Front camera' : 'Rear camera'}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('visual-search')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-2 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13]"
          >
            <Search className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F2B8B5]" />
            <span>Visual search</span>
          </button>
        </div>
      </div>

      {/* Separated Pipeline Telemetry Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="font-semibold text-[var(--nx-text)]">
            Tracking: {pipelineStatus.trackingBackend === 'mediapipe' ? 'MediaPipe Face Landmarker' : 'Canvas Guide'} ·
            Segmentation: {pipelineStatus.segmentationBackend === 'mediapipe' ? 'MediaPipe Selfie' : 'Canvas Vignette'}
          </span>
        </div>
        <span className="text-[var(--nx-text-secondary)]">{pipelineStatus.statusNote}</span>
      </div>

      {banner && (
        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm ${
            banner.tone === 'error'
              ? 'border-red-600/35 bg-red-600/10 text-red-700 dark:text-red-300'
              : banner.tone === 'warn'
                ? 'border-[#B45309]/40 bg-[#B45309]/10 text-[#B45309] dark:text-amber-300'
                : 'border-[#790B13]/35 bg-[#F7E1D3]/70 text-[#790B13] dark:bg-[#790B13]/20 dark:text-[#FFF0DC]'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss alert">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Live Canvas Viewport */}
        <div className="space-y-4 lg:col-span-7">
          <div className="relative overflow-hidden rounded-2xl border border-[var(--nx-border)] bg-[#2A0A0D]">
            <video ref={videoRef} playsInline muted className="hidden" />
            <canvas ref={canvasRef} width={720} height={540} className="aspect-[4/3] w-full object-cover" />
            {recording && (
              <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#790B13] px-3 py-1 text-xs font-semibold text-[#FFF0DC]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#FFF0DC]" />
                <span>REC</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCapturePhoto}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#790B13] px-4 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Capture photo</span>
              </button>
              <button
                type="button"
                onClick={handleToggleRecording}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold ${
                  recording
                    ? 'bg-red-700 text-[#FFF0DC]'
                    : 'border border-[var(--nx-border)] bg-[var(--nx-card-soft)] text-[var(--nx-text)]'
                }`}
              >
                <Video className="h-3.5 w-3.5" />
                <span>{recording ? 'Stop recording' : 'Record clip'}</span>
              </button>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-xs font-medium text-[var(--nx-text)] hover:border-[#790B13]">
              <Upload className="h-3.5 w-3.5" />
              <span>Upload photo fallback</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFallbackUpload} className="hidden" />
            </label>
          </div>

          {cameraError && (
            <div className="rounded-xl border border-[#B45309]/40 bg-[#B45309]/10 px-4 py-3 text-xs text-[#B45309] dark:text-amber-300">
              {cameraError}
            </div>
          )}

          {recordedVideoUrl && (
            <div className="space-y-2 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-[var(--nx-text)]">
                <span>Recorded video clip</span>
                <a href={recordedVideoUrl} download="nexora-camera-clip.webm" className="text-[#790B13] hover:underline dark:text-[#F2B8B5]">
                  Download WebM
                </a>
              </div>
              <video src={recordedVideoUrl} controls className="max-h-56 w-full rounded-lg bg-[#2A0A0D]" />
            </div>
          )}
        </div>

        {/* Separated Effects & Direct Capture Workflows */}
        <div className="space-y-5 lg:col-span-5">
          <section className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text)]">
              <Layers className="h-4 w-4 text-[#790B13] dark:text-[#F2B8B5]" />
              <span>Modular pipeline controls</span>
            </h2>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">
                Face effects (landmark tracked)
              </label>
              <select
                value={settings.faceEffect}
                onChange={(e) => setSettings((s) => ({ ...s, faceEffect: e.target.value as FaceEffectPreset }))}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-xs text-[var(--nx-text)]"
              >
                <option value="none">None</option>
                <option value="eyewear_classic">Editorial Eyewear Frame</option>
                <option value="studio_glow">Warm Studio Key Glow</option>
                <option value="rim_light">Dual Rim Accent Light</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">
                Background segmentation
              </label>
              <select
                value={settings.backgroundEffect}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, backgroundEffect: e.target.value as BackgroundEffectPreset }))
                }
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-xs text-[var(--nx-text)]"
              >
                <option value="none">Natural Background</option>
                <option value="portrait_blur">Portrait Depth Blur</option>
                <option value="studio_graphite">Studio Dark (#2A0A0D)</option>
                <option value="warm_linen">Warm Ivory (#FFF0DC)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--nx-text-secondary)]">
                Fashion look grade
              </label>
              <select
                value={settings.colorGrade}
                onChange={(e) => setSettings((s) => ({ ...s, colorGrade: e.target.value as ColorGradePreset }))}
                className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] px-3 py-2 text-xs text-[var(--nx-text)]"
              >
                <option value="natural">Natural Balanced</option>
                <option value="editorial_film">Editorial Film</option>
                <option value="graphite_studio">Editorial Monochrome</option>
                <option value="warm_linen">Warm Ivory Daylight</option>
                <option value="crisp_daylight">Crisp True-Color</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-4 pt-1 text-xs text-[var(--nx-text-secondary)]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.outfitFramingGuide}
                  onChange={(e) => setSettings((s) => ({ ...s, outfitFramingGuide: e.target.checked }))}
                />
                <span>Outfit Framing Guide</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.mirrorPreview}
                  onChange={(e) => setSettings((s) => ({ ...s, mirrorPreview: e.target.checked }))}
                />
                <span>Mirror Selfie</span>
              </label>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-[var(--nx-border)] bg-[var(--nx-card-bg)] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text)]">
              <ImageIcon className="h-4 w-4 text-[#B45309] dark:text-amber-300" />
              <span>Captured look handoffs</span>
            </h2>

            {!previewUrl ? (
              <p className="text-xs text-[var(--nx-text-secondary)]">
                Capture a frame or upload a photo to search matching Shop items, save privately to AI Style Studio, or publish to your Home feed.
              </p>
            ) : (
              <div className="space-y-3">
                <img
                  src={previewUrl}
                  alt="Captured look preview"
                  className="max-h-48 w-full rounded-lg border border-[var(--nx-border)] bg-[#2A0A0D] object-contain"
                />

                <button
                  type="button"
                  onClick={handleSearchVisually}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#790B13] px-3.5 py-2 text-xs font-semibold text-[#FFF0DC] hover:bg-[#5C0810]"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Search visually in Shop</span>
                </button>

                <div className="space-y-2 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3">
                  <input
                    type="text"
                    placeholder="Private Studio label"
                    value={studioLabel}
                    onChange={(e) => setStudioLabel(e.target.value)}
                    className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-2.5 py-1.5 text-xs text-[var(--nx-text)]"
                  />
                  <label className="flex items-start gap-2 text-[11px] text-[var(--nx-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={studioConsent}
                      onChange={(e) => setStudioConsent(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>I consent to storing this capture privately in my AI Style Studio workspace.</span>
                  </label>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleSaveToStudio}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#B45309]/45 bg-[#B45309]/12 px-3 py-1.5 text-xs font-semibold text-[#B45309] dark:text-amber-300 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{busyAction === 'studio' ? 'Saving...' : 'Save to AI Style Studio'}</span>
                  </button>
                </div>

                <div className="space-y-2 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-soft)] p-3">
                  <input
                    type="text"
                    placeholder="Social caption (optional)..."
                    value={postCaption}
                    onChange={(e) => setPostCaption(e.target.value)}
                    className="w-full rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-2.5 py-1.5 text-xs text-[var(--nx-text)]"
                  />
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handlePublishSocialPost}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-card-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--nx-text)] hover:border-[#790B13] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5 text-[#790B13] dark:text-[#F2B8B5]" />
                    <span>{busyAction === 'post' ? 'Publishing...' : 'Publish to Home feed'}</span>
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
