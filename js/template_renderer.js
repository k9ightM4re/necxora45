/**
 * Deterministic HTML5 Canvas compositor, offscreen preview thumbnail renderer,
 * and clean PNG / JPG / PDF exporter for NEXORA AI Template Studio.
 */

const loadedImagesCache = new Map();
const renderedThumbnailCache = new Map();

export function loadImageCached(src) {
  const key = String(src || '');
  if (!key) return Promise.resolve(null);
  if (loadedImagesCache.has(key)) return loadedImagesCache.get(key);

  const promise = new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    if (!key.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = key;
  });
  loadedImagesCache.set(key, promise);
  return promise;
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(Math.max(0, Number(r || 0)), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapTextLines(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawBackgroundPattern(ctx, bg, width, height) {
  const pattern = bg?.pattern || 'none';
  const alpha = Math.min(0.85, Math.max(0, Number(bg?.patternOpacity ?? 0.16)));
  if (pattern === 'none' || alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (pattern === 'grid') {
    const step = Math.round(Math.min(width, height) / 14);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else if (pattern === 'dots') {
    const step = Math.round(Math.min(width, height) / 16);
    ctx.fillStyle = '#FFFFFF';
    for (let x = step / 2; x < width; x += step) {
      for (let y = step / 2; y < height; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'diagonal') {
    const step = 48;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    for (let i = -height; i < width + height; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }
  } else if (pattern === 'glow') {
    const rad1 = ctx.createRadialGradient(width * 0.2, height * 0.18, 10, width * 0.2, height * 0.18, width * 0.55);
    rad1.addColorStop(0, 'rgba(167, 53, 255, 0.9)');
    rad1.addColorStop(1, 'rgba(167, 53, 255, 0)');
    ctx.fillStyle = rad1;
    ctx.fillRect(0, 0, width, height);

    const rad2 = ctx.createRadialGradient(width * 0.84, height * 0.82, 10, width * 0.84, height * 0.82, width * 0.55);
    rad2.addColorStop(0, 'rgba(40, 107, 255, 0.85)');
    rad2.addColorStop(1, 'rgba(40, 107, 255, 0)');
    ctx.fillStyle = rad2;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

export async function renderTemplateToCanvas(canvas, templateData, options = {}) {
  if (!canvas || !templateData) return;
  const width = Math.max(120, Number(templateData.width || 1080));
  const height = Math.max(120, Number(templateData.height || 1080));
  const scale = Number(options.scale || 1);

  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(scale, scale);

  // 1. Preload images
  const bg = templateData.background || {};
  const layers = (Array.isArray(templateData.layers) ? templateData.layers : [])
    .filter((l) => l && l.visible !== false)
    .slice()
    .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));

  const urlsToLoad = [];
  if (bg.type === 'image' && bg.imageUrl) urlsToLoad.push(bg.imageUrl);
  for (const l of layers) {
    if (l.type === 'image' && l.src) urlsToLoad.push(l.src);
  }
  const loadedImgs = await Promise.all(urlsToLoad.map((u) => loadImageCached(u)));
  const imgMap = new Map();
  urlsToLoad.forEach((u, i) => imgMap.set(u, loadedImgs[i]));

  // 2. Render Background
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color || '#0D0E20';
    ctx.fillRect(0, 0, width, height);
  } else if (bg.type === 'image' && bg.imageUrl && imgMap.get(bg.imageUrl)) {
    const bgImg = imgMap.get(bg.imageUrl);
    const ratio = Math.max(width / bgImg.width, height / bgImg.height);
    const dw = bgImg.width * ratio;
    const dh = bgImg.height * ratio;
    ctx.drawImage(bgImg, (width - dw) / 2, (height - dh) / 2, dw, dh);
    if (Number(bg.overlayOpacity || 0) > 0) {
      ctx.save();
      ctx.globalAlpha = Number(bg.overlayOpacity || 0.25);
      ctx.fillStyle = bg.overlayColor || '#090915';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  } else {
    const angle = (Number(bg.gradientAngle ?? 145) * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.hypot(width, height) / 2;
    const grad = ctx.createLinearGradient(
      cx - Math.cos(angle) * r,
      cy - Math.sin(angle) * r,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r
    );
    grad.addColorStop(0, bg.gradientFrom || bg.color || '#12102C');
    grad.addColorStop(1, bg.gradientTo || '#286BFF');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  drawBackgroundPattern(ctx, bg, width, height);

  // 3. Render Ordered Layers
  for (const layer of layers) {
    const lx = Number(layer.x || 0);
    const ly = Number(layer.y || 0);
    const lw = Math.max(12, Number(layer.width || 100));
    const lh = Math.max(8, Number(layer.height || 100));
    const rot = (Number(layer.rotation || 0) * Math.PI) / 180;

    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0.02, Number(layer.opacity ?? 1)));
    ctx.translate(lx + lw / 2, ly + lh / 2);
    if (rot) ctx.rotate(rot);
    ctx.translate(-lw / 2, -lh / 2);

    if (layer.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 10;
    }

    if (layer.type === 'shape') {
      const kind = layer.shapeKind || 'rounded';
      if (kind === 'circle') {
        const rad = Math.min(lw, lh) / 2;
        ctx.beginPath();
        ctx.arc(lw / 2, lh / 2, rad, 0, Math.PI * 2);
        if (layer.fill) {
          ctx.fillStyle = layer.fill;
          ctx.fill();
        }
        if (Number(layer.borderWidth || 0) > 0) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = layer.borderColor || '#701CFF';
          ctx.lineWidth = Number(layer.borderWidth || 2);
          ctx.stroke();
        }
      } else if (kind === 'ring') {
        const rad = Math.min(lw, lh) / 2 - Number(layer.borderWidth || 4);
        ctx.beginPath();
        ctx.arc(lw / 2, lh / 2, Math.max(4, rad), 0, Math.PI * 2);
        ctx.strokeStyle = layer.borderColor || layer.fill || '#701CFF';
        ctx.lineWidth = Math.max(2, Number(layer.borderWidth || 6));
        ctx.stroke();
      } else if (kind === 'line') {
        ctx.fillStyle = layer.fill || layer.borderColor || '#701CFF';
        drawRoundedRectPath(ctx, 0, Math.max(0, lh / 2 - 4), lw, Math.max(4, Math.min(lh, 16)), 999);
        ctx.fill();
      } else {
        const radius = kind === 'rect' ? 0 : kind === 'pill' ? 999 : Number(layer.borderRadius ?? 24);
        drawRoundedRectPath(ctx, 0, 0, lw, lh, radius);
        if (layer.fill) {
          ctx.fillStyle = layer.fill;
          ctx.fill();
        }
        if (Number(layer.borderWidth || 0) > 0) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = layer.borderColor || '#701CFF';
          ctx.lineWidth = Number(layer.borderWidth || 2);
          ctx.stroke();
        }
      }
    } else if (layer.type === 'image') {
      const rad = Number(layer.borderRadius ?? 20);
      if (layer.frameStyle === 'polaroid') {
        ctx.fillStyle = '#FAF9F6';
        drawRoundedRectPath(ctx, -14, -14, lw + 28, lh + 64, Math.max(8, rad));
        ctx.fill();
      }
      ctx.save();
      drawRoundedRectPath(ctx, 0, 0, lw, lh, rad);
      ctx.clip();

      const loadedImg = layer.src ? imgMap.get(layer.src) : null;
      if (loadedImg) {
        const zoom = Math.max(1, Number(layer.cropZoom || 1));
        const fitRatio =
          layer.objectFit === 'contain'
            ? Math.min(lw / loadedImg.width, lh / loadedImg.height)
            : Math.max(lw / loadedImg.width, lh / loadedImg.height);
        const dw = loadedImg.width * fitRatio * zoom;
        const dh = loadedImg.height * fitRatio * zoom;
        const offsetX = (lw - dw) / 2 + Number(layer.cropX || 0) * (dw - lw) * 0.5;
        const offsetY = (lh - dh) / 2 + Number(layer.cropY || 0) * (dh - lh) * 0.5;
        ctx.drawImage(loadedImg, offsetX, offsetY, dw, dh);
      } else {
        const phGrad = ctx.createLinearGradient(0, 0, lw, lh);
        phGrad.addColorStop(0, 'rgba(112, 28, 255, 0.24)');
        phGrad.addColorStop(1, 'rgba(40, 107, 255, 0.22)');
        ctx.fillStyle = phGrad;
        ctx.fillRect(0, 0, lw, lh);

        ctx.strokeStyle = 'rgba(255,255,255,0.34)';
        ctx.setLineDash([12, 10]);
        ctx.lineWidth = 3;
        drawRoundedRectPath(ctx, 8, 8, Math.max(10, lw - 16), Math.max(10, lh - 16), Math.max(4, rad - 6));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `700 ${Math.round(Math.min(28, Math.max(16, lw * 0.045)))}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.placeholderLabel || 'Upload Photo', lw / 2, lh / 2);
      }
      ctx.restore();

      const borderW = layer.frameStyle === 'neon' ? Math.max(4, Number(layer.borderWidth || 4)) : Number(layer.borderWidth || 0);
      if (borderW > 0) {
        ctx.save();
        if (layer.frameStyle === 'neon') {
          ctx.shadowColor = layer.borderColor || '#701CFF';
          ctx.shadowBlur = 22;
        }
        drawRoundedRectPath(ctx, 0, 0, lw, lh, rad);
        ctx.strokeStyle = layer.borderColor || '#FFFFFF';
        ctx.lineWidth = borderW;
        ctx.stroke();
        ctx.restore();
      }
    } else if (layer.type === 'sticker') {
      const rad = Number(layer.borderRadius ?? 999);
      ctx.fillStyle = layer.bgColor || '#701CFF';
      drawRoundedRectPath(ctx, 0, 0, lw, lh, rad);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = layer.color || '#FFFFFF';
      const fSize = Math.round(Number(layer.fontSize || 22));
      ctx.font = `800 ${fSize}px "Plus Jakarta Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = `${layer.emoji ? `${layer.emoji} ` : ''}${layer.text || ''}`.trim();
      ctx.fillText(label, lw / 2, lh / 2 + 1, Math.max(20, lw - 24));
    } else if (layer.type === 'text') {
      const pad = Math.max(0, Number(layer.bgPadding || 0));
      if (layer.bgColor) {
        ctx.fillStyle = layer.bgColor;
        drawRoundedRectPath(ctx, 0, 0, lw, lh, Number(layer.borderRadius ?? 12));
        ctx.fill();
      }

      const fontSize = Math.max(12, Number(layer.fontSize || 48));
      const fontWeight = layer.fontWeight || '700';
      const fontFamily = layer.fontFamily || 'Plus Jakarta Sans';
      ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = layer.color || '#FFFFFF';
      ctx.textBaseline = 'top';

      const maxTextW = Math.max(24, lw - pad * 2);
      const lines = wrapTextLines(ctx, layer.text || '', maxTextW);
      const linePx = fontSize * Number(layer.lineHeight || 1.18);
      const align = layer.align || 'left';
      ctx.textAlign = align;

      let textX = pad;
      if (align === 'center') textX = lw / 2;
      else if (align === 'right') textX = lw - pad;

      lines.forEach((line, i) => {
        const lineY = pad + i * linePx;
        if (lineY > lh + linePx) return;
        ctx.fillText(line, textX, lineY);
      });
    }

    ctx.restore();
  }

  ctx.restore();
}

export async function renderTemplateThumbnailDataUrl(templateData, { maxDim = 420, mime = 'image/jpeg', quality = 0.82 } = {}) {
  if (!templateData) return '';
  const w = Number(templateData.width || 1080);
  const h = Number(templateData.height || 1080);
  const cacheKey = `${maxDim}:${mime}:${JSON.stringify(templateData)}`;
  if (renderedThumbnailCache.has(cacheKey)) {
    return renderedThumbnailCache.get(cacheKey);
  }
  if (typeof document === 'undefined') return '';
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  await renderTemplateToCanvas(canvas, templateData, { scale });
  const dataUrl = canvas.toDataURL(mime, quality);
  if (renderedThumbnailCache.size > 160) renderedThumbnailCache.clear();
  renderedThumbnailCache.set(cacheKey, dataUrl);
  return dataUrl;
}

/**
 * Renders clean offscreen export data URL without any editor UI chrome.
 */
export async function exportTemplateImageDataUrl(templateData, { format = 'png', quality = 0.92, scale = 1 } = {}) {
  if (typeof document === 'undefined') {
    throw new Error('Canvas export requires a browser environment.');
  }
  const canvas = document.createElement('canvas');
  await renderTemplateToCanvas(canvas, templateData, { scale: Math.min(2, Math.max(0.5, Number(scale || 1))) });
  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return {
    dataUrl: canvas.toDataURL(mime, quality),
    width: canvas.width,
    height: canvas.height,
    mime,
  };
}

/**
 * Pure zero-dependency PDF 1.4 builder wrapping a JPEG image stream.
 * Unit-testable in Node.js without DOM dependencies.
 */
export function buildPdfFromJpegDataUrl(jpegDataUrl, widthPx = 1080, heightPx = 1080) {
  const match = String(jpegDataUrl || '').match(/^data:image\/jpe?g;base64,(.+)$/i);
  if (!match) {
    throw new Error('Expected a valid JPEG data URL for PDF export.');
  }
  const rawBinary =
    typeof Buffer !== 'undefined'
      ? Buffer.from(match[1], 'base64')
      : Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));

  const w = Math.max(100, Math.round(Number(widthPx || 1080)));
  const h = Math.max(100, Math.round(Number(heightPx || 1080)));
  // Convert to comfortable PDF points (max side ~612pt US Letter scale)
  const ptScale = Math.min(1, 720 / Math.max(w, h));
  const ptW = Number((w * ptScale).toFixed(2));
  const ptH = Number((h * ptScale).toFixed(2));

  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [0];

  function pushText(str) {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    offset += bytes.length;
  }

  function pushBytes(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    chunks.push(arr);
    offset += arr.length;
  }

  pushText('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  offsets[1] = offset;
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = offset;
  pushText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets[3] = offset;
  pushText(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  offsets[4] = offset;
  pushText(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${rawBinary.length} >>\nstream\n`
  );
  pushBytes(rawBinary);
  pushText('\nendstream\nendobj\n');

  const contentStream = `q\n${ptW} 0 0 ${ptH} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets[5] = offset;
  pushText(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

  const xrefOffset = offset;
  pushText('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) {
    pushText(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export async function triggerTemplateDownload(templateData, title = 'nexora-template', { format = 'png', quality = 0.92, scale = 1 } = {}) {
  const safeName = String(title || 'nexora-template')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'nexora-template';

  if (format === 'pdf') {
    const { dataUrl, width, height } = await exportTemplateImageDataUrl(templateData, {
      format: 'jpg',
      quality: Math.max(0.8, quality),
      scale,
    });
    const pdfBytes = buildPdfFromJpegDataUrl(dataUrl, width, height);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

  const { dataUrl } = await exportTemplateImageDataUrl(templateData, { format, quality, scale });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${safeName}.${format === 'jpg' ? 'jpg' : 'png'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
