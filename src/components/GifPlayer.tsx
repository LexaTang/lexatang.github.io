/**
 * Canvas 2D GIF 播放器组件
 * 使用纯 JS 解码 GIF + Canvas 2D putImageData 播放
 *
 * 要点：
 * - 每帧绘制前 clearRect 清空画布（含透明度），避免上一帧暂留
 * - 使用 IntersectionObserver 控制可见性，不可见时停止播放
 * - IndexedDB 缓存解码帧
 * - Canvas 2D 无 context 数量限制，适合大量同屏场景
 */

import { useEffect, useRef, useCallback } from 'react';
import { decodeGif, type GifInfo } from '../lib/gif-decoder';
import { getCachedFrames, cacheFrames } from '../lib/frame-cache';

interface GifPlayerProps {
  src: string;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}

// 全局解码任务去重：同一 URL 只解码一次
const pendingDecodes = new Map<string, Promise<GifInfo>>();

async function loadGifFrames(src: string): Promise<GifInfo> {
  // 1. 先查 IndexedDB 缓存
  const cached = await getCachedFrames(src);
  if (cached) return cached;

  // 2. 去重：同一 URL 正在解码就等待
  const pending = pendingDecodes.get(src);
  if (pending) return pending;

  // 3. fetch + 解码
  const promise = (async () => {
    const resp = await fetch(src);
    const buffer = await resp.arrayBuffer();
    const gifInfo = decodeGif(buffer);

    // 写入缓存（异步，不阻塞）
    cacheFrames(src, gifInfo).catch(() => {});

    return gifInfo;
  })();

  pendingDecodes.set(src, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    pendingDecodes.delete(src);
  }
}

interface PlayerState {
  ctx: CanvasRenderingContext2D | null;
  gifInfo: GifInfo | null;
  /** 每帧预构建的 ImageData，避免每次绘制重新创建 */
  imageDataCache: ImageData[];
  frameIndex: number;
  lastFrameTime: number;
  rafId: number;
  visible: boolean;
  disposed: boolean;
}

export default function GifPlayer({ src, style, className, onClick }: GifPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<PlayerState>({
    ctx: null,
    gifInfo: null,
    imageDataCache: [],
    frameIndex: 0,
    lastFrameTime: 0,
    rafId: 0,
    visible: false,
    disposed: false,
  });

  const drawFrame = useCallback((state: PlayerState) => {
    const { ctx, gifInfo, imageDataCache } = state;
    if (!ctx || !gifInfo || gifInfo.frames.length === 0) return;

    const imgData = imageDataCache[state.frameIndex];
    if (!imgData) return;

    // 清空画布（包括透明度），避免上帧暂留
    ctx.clearRect(0, 0, gifInfo.width, gifInfo.height);

    // 绘制当前帧
    ctx.putImageData(imgData, 0, 0);
  }, []);

  const animate = useCallback((timestamp: number) => {
    const state = stateRef.current;
    if (state.disposed || !state.visible || !state.gifInfo) return;

    const frames = state.gifInfo.frames;
    if (frames.length === 0) return;

    const frame = frames[state.frameIndex];
    const delayMs = frame.delay * 10; // 1/100秒 → 毫秒

    if (timestamp - state.lastFrameTime >= delayMs) {
      state.frameIndex = (state.frameIndex + 1) % frames.length;
      state.lastFrameTime = timestamp;
      drawFrame(state);
    }

    state.rafId = requestAnimationFrame(animate);
  }, [drawFrame]);

  const startPlayback = useCallback(() => {
    const state = stateRef.current;
    if (state.disposed || !state.visible || !state.gifInfo) return;

    // 先绘制当前帧
    drawFrame(state);
    state.lastFrameTime = performance.now();

    // 多帧才启动动画循环
    if (state.gifInfo.frames.length > 1) {
      cancelAnimationFrame(state.rafId);
      state.rafId = requestAnimationFrame(animate);
    }
  }, [drawFrame, animate]);

  const stopPlayback = useCallback(() => {
    const state = stateRef.current;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const state = stateRef.current;
    state.disposed = false;

    // 获取 Canvas 2D context
    state.ctx = canvas.getContext('2d');

    // IntersectionObserver 控制可见性
    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries[0]?.isIntersecting ?? false;
        state.visible = isVisible;

        if (isVisible && state.gifInfo) {
          startPlayback();
        } else {
          stopPlayback();
        }
      },
      { threshold: 0 },
    );

    observer.observe(canvas);

    // 加载 & 解码
    let cancelled = false;

    (async () => {
      try {
        const gifInfo = await loadGifFrames(src);
        if (cancelled || state.disposed) return;

        // 设置 canvas 尺寸
        canvas.width = gifInfo.width;
        canvas.height = gifInfo.height;

        // 预构建每帧的 ImageData 对象
        const imageDataCache: ImageData[] = [];
        for (const frame of gifInfo.frames) {
          const clamped = new Uint8ClampedArray(frame.pixels.length);
          clamped.set(frame.pixels);
          const imgData = new ImageData(clamped, frame.width, frame.height);
          imageDataCache.push(imgData);
        }

        state.gifInfo = gifInfo;
        state.imageDataCache = imageDataCache;
        state.frameIndex = 0;

        if (state.visible) {
          startPlayback();
        }
      } catch (e) {
        console.warn('GIF 解码失败:', src, e);
      }
    })();

    return () => {
      cancelled = true;
      state.disposed = true;
      stopPlayback();
      observer.disconnect();

      state.ctx = null;
      state.gifInfo = null;
      state.imageDataCache = [];
    };
  }, [src, startPlayback, stopPlayback]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        maxWidth: '80%',
        maxHeight: '80%',
        objectFit: 'contain',
        ...style,
      }}
      onClick={onClick}
    />
  );
}
