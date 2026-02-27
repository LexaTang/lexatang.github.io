/**
 * IndexedDB 帧缓存服务
 * 缓存 GIF 解码后的帧数据，避免重复 fetch 和解码
 */

import type { DecodedFrame, GifInfo } from './gif-decoder';

const DB_NAME = 'gif-frame-cache';
const DB_VERSION = 1;
const STORE_NAME = 'frames';

interface CachedGifData {
  url: string;
  width: number;
  height: number;
  loopCount: number;
  /** 每帧的 delay (1/100秒) */
  delays: number[];
  /**
   * 所有帧像素拼接在一起的 ArrayBuffer
   * 每帧大小 = width * height * 4
   */
  pixelData: ArrayBuffer;
  frameCount: number;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/**
 * 从 IndexedDB 读取缓存的帧数据
 */
export async function getCachedFrames(url: string): Promise<GifInfo | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        const cached = request.result as CachedGifData | undefined;
        if (!cached) {
          resolve(null);
          return;
        }

        // 重建 DecodedFrame 数组
        const frameSize = cached.width * cached.height * 4;
        const allPixels = new Uint8Array(cached.pixelData);
        const frames: DecodedFrame[] = [];

        for (let i = 0; i < cached.frameCount; i++) {
          frames.push({
            pixels: new Uint8Array(allPixels.buffer, i * frameSize, frameSize),
            width: cached.width,
            height: cached.height,
            delay: cached.delays[i],
          });
        }

        resolve({
          width: cached.width,
          height: cached.height,
          loopCount: cached.loopCount,
          frames,
        });
      };

      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * 将解码的帧数据缓存到 IndexedDB
 */
export async function cacheFrames(url: string, gifInfo: GifInfo): Promise<void> {
  try {
    const db = await openDB();

    // 将所有帧的像素合并为一个 ArrayBuffer 以减少 IDB 存储开销
    const frameSize = gifInfo.width * gifInfo.height * 4;
    const totalSize = frameSize * gifInfo.frames.length;
    const allPixels = new Uint8Array(totalSize);
    const delays: number[] = [];

    for (let i = 0; i < gifInfo.frames.length; i++) {
      allPixels.set(gifInfo.frames[i].pixels, i * frameSize);
      delays.push(gifInfo.frames[i].delay);
    }

    const cachedData: CachedGifData = {
      url,
      width: gifInfo.width,
      height: gifInfo.height,
      loopCount: gifInfo.loopCount,
      delays,
      pixelData: allPixels.buffer,
      frameCount: gifInfo.frames.length,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(cachedData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // 缓存失败不影响正常使用
  }
}
