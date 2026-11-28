export type FaceEffectPreset = 'none' | 'eyewear_classic' | 'rim_light' | 'studio_glow';
export type BackgroundEffectPreset = 'none' | 'portrait_blur' | 'studio_graphite' | 'warm_linen';
export type ColorGradePreset = 'natural' | 'editorial_film' | 'graphite_studio' | 'warm_linen' | 'crisp_daylight';

export interface CameraPipelineSettings {
  faceEffect: FaceEffectPreset;
  backgroundEffect: BackgroundEffectPreset;
  colorGrade: ColorGradePreset;
  outfitFramingGuide: boolean;
  mirrorPreview: boolean;
}

export interface PipelineRuntimeStatus {
  trackingBackend: 'mediapipe' | 'canvas-fallback';
  segmentationBackend: 'mediapipe' | 'canvas-fallback';
  statusNote: string;
}

interface MediaPipeModule {
  FilesetResolver?: any;
  FaceLandmarker?: any;
  ImageSegmenter?: any;
}

let cachedFaceLandmarker: any = null;
let cachedSegmenter: any = null;
let initAttempted = false;
let lastStatus: PipelineRuntimeStatus = {
  trackingBackend: 'canvas-fallback',
  segmentationBackend: 'canvas-fallback',
  statusNote: 'Canvas rendering pipeline ready.',
};

const MEDIAPIPE_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SELFIE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

/**
 * Stage A & C initializer: attempts MediaPipe FaceLandmarker + Selfie ImageSegmenter,
 * falling back cleanly to Canvas 2D geometry & vignette when sandboxed or offline.
 */
export async function initializeMediaPipeAdapters(): Promise<PipelineRuntimeStatus> {
  if (initAttempted) return lastStatus;
  initAttempted = true;

  try {
    const mod = (await import('@mediapipe/tasks-vision')) as unknown as MediaPipeModule;
    if (!mod?.FilesetResolver) {
      lastStatus = {
        trackingBackend: 'canvas-fallback',
        segmentationBackend: 'canvas-fallback',
        statusNote: 'MediaPipe bundle unavailable; using Canvas fallback rendering.',
      };
      return lastStatus;
    }

    const vision = await mod.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

    if (mod.FaceLandmarker) {
      try {
        cachedFaceLandmarker = await mod.FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
      } catch {
        cachedFaceLandmarker = null;
      }
    }

    if (mod.ImageSegmenter) {
      try {
        cachedSegmenter = await mod.ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: SELFIE_MODEL_URL },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
        });
      } catch {
        cachedSegmenter = null;
      }
    }

    lastStatus = {
      trackingBackend: cachedFaceLandmarker ? 'mediapipe' : 'canvas-fallback',
      segmentationBackend: cachedSegmenter ? 'mediapipe' : 'canvas-fallback',
      statusNote:
        cachedFaceLandmarker || cachedSegmenter
          ? 'MediaPipe vision models active with real-time Canvas compositor.'
          : 'Using local Canvas face-guide and background-vignette fallback (no external WASM network needed).',
    };
    return lastStatus;
  } catch {
    lastStatus = {
      trackingBackend: 'canvas-fallback',
      segmentationBackend: 'canvas-fallback',
      statusNote: 'Using local Canvas fallback pipeline (MediaPipe models unreachable in current environment).',
    };
    return lastStatus;
  }
}

export function getColorGradeFilter(grade: ColorGradePreset): string {
  switch (grade) {
    case 'editorial_film':
      return 'contrast(1.08) saturate(0.92) sepia(0.08)';
    case 'graphite_studio':
      return 'contrast(1.12) saturate(0.84) brightness(0.98)';
    case 'warm_linen':
      return 'contrast(1.03) saturate(1.06) sepia(0.12) brightness(1.03)';
    case 'crisp_daylight':
      return 'contrast(1.06) saturate(1.1) brightness(1.04)';
    case 'natural':
    default:
      return 'none';
  }
}

/* -------------------- STAGE B: FACE EFFECTS -------------------- */

function drawFaceEffects(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: FaceEffectPreset,
  landmarks: Array<{ x: number; y: number }> | null,
  mirrored: boolean
) {
  if (preset === 'none') return;

  const mapX = (normX: number) => (mirrored ? (1 - normX) * width : normX * width);
  const mapY = (normY: number) => normY * height;

  if (preset === 'studio_glow') {
    const cx = landmarks && landmarks[1] ? mapX(landmarks[1].x) : width * 0.5;
    const cy = landmarks && landmarks[1] ? mapY(landmarks[1].y) : height * 0.38;
    const radius = Math.min(width, height) * 0.34;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
    grad.addColorStop(0, 'rgba(255, 240, 214, 0.16)');
    grad.addColorStop(0.65, 'rgba(218, 179, 114, 0.06)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }

  if (preset === 'rim_light') {
    ctx.save();
    const edgeGrad = ctx.createLinearGradient(0, 0, width, 0);
    edgeGrad.addColorStop(0, 'rgba(71, 119, 223, 0.22)');
    edgeGrad.addColorStop(0.22, 'rgba(71, 119, 223, 0)');
    edgeGrad.addColorStop(0.78, 'rgba(218, 179, 114, 0)');
    edgeGrad.addColorStop(1, 'rgba(218, 179, 114, 0.22)');
    ctx.fillStyle = edgeGrad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }

  if (preset === 'eyewear_classic') {
    // Landmarks 33 (left outer eye) & 263 (right outer eye) or centered head estimate
    const leftEye = landmarks && landmarks[33] ? { x: mapX(landmarks[33].x), y: mapY(landmarks[33].y) } : { x: width * 0.41, y: height * 0.36 };
    const rightEye = landmarks && landmarks[263] ? { x: mapX(landmarks[263].x), y: mapY(landmarks[263].y) } : { x: width * 0.59, y: height * 0.36 };

    const minX = Math.min(leftEye.x, rightEye.x);
    const maxX = Math.max(leftEye.x, rightEye.x);
    const span = Math.max(48, maxX - minX);
    const lensW = span * 0.44;
    const lensH = lensW * 0.62;
    const midY = (leftEye.y + rightEye.y) / 2;
    const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    ctx.save();
    ctx.translate((minX + maxX) / 2, midY);
    ctx.rotate(landmarks ? angle : 0);
    ctx.strokeStyle = '#DAB372';
    ctx.lineWidth = Math.max(2.5, span * 0.032);
    ctx.fillStyle = 'rgba(16, 19, 24, 0.28)';

    // Left frame
    const offset = span * 0.32;
    ctx.beginPath();
    ctx.roundRect(-offset - lensW / 2, -lensH / 2, lensW, lensH, 8);
    ctx.fill();
    ctx.stroke();

    // Right frame
    ctx.beginPath();
    ctx.roundRect(offset - lensW / 2, -lensH / 2, lensW, lensH, 8);
    ctx.fill();
    ctx.stroke();

    // Bridge
    ctx.beginPath();
    ctx.moveTo(-offset + lensW / 2, -lensH * 0.12);
    ctx.lineTo(offset - lensW / 2, -lensH * 0.12);
    ctx.stroke();
    ctx.restore();
  }
}

/* -------------------- STAGE C: BACKGROUND SEGMENTATION -------------------- */

function drawBackgroundEffect(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement,
  width: number,
  height: number,
  preset: BackgroundEffectPreset,
  settings: CameraPipelineSettings,
  timestampMs: number
) {
  if (preset === 'none') return;

  // Try MediaPipe Selfie Segmentation mask if available
  if (cachedSegmenter && source instanceof HTMLVideoElement && source.readyState >= 2) {
    try {
      const seg = cachedSegmenter.segmentForVideo(source, timestampMs);
      const mask = seg?.categoryMask;
      if (mask) {
        const mWidth = mask.width;
        const mHeight = mask.height;
        const maskData = mask.getAsUint8Array();
        const off = document.createElement('canvas');
        off.width = width;
        off.height = height;
        const octx = off.getContext('2d');
        if (octx) {
          if (preset === 'portrait_blur') {
            octx.filter = `blur(10px) ${getColorGradeFilter(settings.colorGrade)}`;
            if (settings.mirrorPreview) {
              octx.translate(width, 0);
              octx.scale(-1, 1);
            }
            octx.drawImage(source, 0, 0, width, height);
            octx.setTransform(1, 0, 0, 1, 0, 0);
            octx.filter = 'none';
          } else {
            octx.fillStyle = preset === 'studio_graphite' ? '#171C23' : '#EBEEF2';
            octx.fillRect(0, 0, width, height);
          }

          // Composite masked background around foreground person
          const fgCanvas = document.createElement('canvas');
          fgCanvas.width = width;
          fgCanvas.height = height;
          const fctx = fgCanvas.getContext('2d');
          if (fctx) {
            const imgData = fctx.createImageData(mWidth, mHeight);
            for (let i = 0; i < maskData.length; i++) {
              // Category 0 is person in selfie segmenter
              const isPerson = maskData[i] === 0;
              const idx = i * 4;
              imgData.data[idx] = 255;
              imgData.data[idx + 1] = 255;
              imgData.data[idx + 2] = 255;
              imgData.data[idx + 3] = isPerson ? 255 : 0;
            }
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = mWidth;
            maskCanvas.height = mHeight;
            maskCanvas.getContext('2d')?.putImageData(imgData, 0, 0);

            fctx.drawImage(maskCanvas, 0, 0, width, height);
            fctx.globalCompositeOperation = 'source-in';
            fctx.drawImage(ctx.canvas, 0, 0);

            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(off, 0, 0);
            ctx.drawImage(fgCanvas, 0, 0);
          }
        }
        mask.close?.();
        seg.close?.();
        return;
      }
    } catch {
      // Fallback below
    }
  }

  // Canvas-only graceful backdrop vignette fallback
  ctx.save();
  const cx = width * 0.5;
  const cy = height * 0.45;
  const inner = Math.min(width, height) * 0.24;
  const outer = Math.max(width, height) * 0.65;
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  if (preset === 'portrait_blur') {
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(10,12,16,0.52)');
  } else if (preset === 'studio_graphite') {
    grad.addColorStop(0, 'rgba(23,28,35,0)');
    grad.addColorStop(0.6, 'rgba(23,28,35,0.55)');
    grad.addColorStop(1, 'rgba(23,28,35,0.92)');
  } else {
    grad.addColorStop(0, 'rgba(235,238,242,0)');
    grad.addColorStop(0.65, 'rgba(235,238,242,0.52)');
    grad.addColorStop(1, 'rgba(235,238,242,0.90)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/* -------------------- STAGE D: FASHION OVERLAYS -------------------- */

function drawFashionFramingGuide(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(218, 179, 114, 0.72)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);

  const padX = width * 0.2;
  const padY = height * 0.1;
  ctx.strokeRect(padX, padY, width - padX * 2, height - padY * 2);

  // Subtle silhouette shoulder / hem horizon markers
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(16, 19, 24, 0.65)';
  ctx.fillRect(padX, padY - 22, 162, 20);
  ctx.fillStyle = '#E8EDF5';
  ctx.font = '600 11px Inter, sans-serif';
  ctx.fillText('OUTFIT FRAME GUIDE', padX + 8, padY - 8);
  ctx.restore();
}

/* -------------------- STAGE E: COMPOSITE FRAME -------------------- */

export function renderPipelineFrame(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement,
  width: number,
  height: number,
  settings: CameraPipelineSettings,
  timestampMs: number
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.filter = getColorGradeFilter(settings.colorGrade);

  if (settings.mirrorPreview && source instanceof HTMLVideoElement) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.restore();

  // Stage C: Background Segmentation
  drawBackgroundEffect(ctx, source, width, height, settings.backgroundEffect, settings, timestampMs);

  // Stage A: Face Tracking
  let landmarks: Array<{ x: number; y: number }> | null = null;
  if (
    settings.faceEffect !== 'none' &&
    cachedFaceLandmarker &&
    source instanceof HTMLVideoElement &&
    source.readyState >= 2
  ) {
    try {
      const res = cachedFaceLandmarker.detectForVideo(source, timestampMs);
      if (Array.isArray(res?.faceLandmarks) && res.faceLandmarks[0]) {
        landmarks = res.faceLandmarks[0];
      }
    } catch {
      landmarks = null;
    }
  }

  // Stage B: Face Effects
  drawFaceEffects(
    ctx,
    width,
    height,
    settings.faceEffect,
    landmarks,
    settings.mirrorPreview && source instanceof HTMLVideoElement
  );

  // Stage D: Fashion Overlays
  if (settings.outfitFramingGuide) {
    drawFashionFramingGuide(ctx, width, height);
  }
}

export async function startCameraStream(facingMode: 'user' | 'environment'): Promise<MediaStream> {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not supported in this browser or context.');
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
}

export function stopCameraStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore cleanup failures
    }
  }
}

export function captureCanvasDataUrl(canvas: HTMLCanvasElement, maxWidth = 960): string {
  const scale = canvas.width > maxWidth ? maxWidth / canvas.width : 1;
  if (scale >= 1) {
    return canvas.toDataURL('image/jpeg', 0.88);
  }
  const tmp = document.createElement('canvas');
  tmp.width = Math.round(canvas.width * scale);
  tmp.height = Math.round(canvas.height * scale);
  const tctx = tmp.getContext('2d');
  if (tctx) {
    tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
    return tmp.toDataURL('image/jpeg', 0.88);
  }
  return canvas.toDataURL('image/jpeg', 0.88);
}
