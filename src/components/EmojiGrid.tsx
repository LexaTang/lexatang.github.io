import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import GifPlayer from './GifPlayer';

interface EmojiItem {
  id: string;
  src: string;
  tag?: string;
  basePath?: string;
}

interface EmojiGridProps {
  items: EmojiItem[];
  columns?: number;
  formats?: string[];
  defaultFormat?: string;
}

export default function EmojiGrid({ items, columns: defaultColumns = 6, formats, defaultFormat }: EmojiGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const autoScrollRef = useRef<number | null>(null);

  // Tri-state values: undefined = not set, or specific string values
  type LoadingState = undefined | 'lazy' | 'eager';
  type DecodingState = undefined | 'sync' | 'async';
  type CvState = undefined | 'auto' | 'hidden';

  const LOADING_STATES: LoadingState[] = [undefined, 'lazy', 'eager'];
  const DECODING_STATES: DecodingState[] = [undefined, 'sync', 'async'];
  const CV_STATES: CvState[] = [undefined, 'auto', 'hidden'];

  // --- URL search params helpers ---
  function getUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  function parseTriState<T extends string>(val: string | null, allowed: (T | undefined)[]): T | undefined {
    if (val === null || val === 'off') return undefined;
    return allowed.includes(val as any) ? (val as T) : undefined;
  }

  function initFromUrl() {
    if (typeof window === 'undefined') return {};
    const p = getUrlParams();
    return {
      fmt: p.get('fmt'),
      virtual: p.get('virtual'),
      auto: p.get('auto'),
      load: p.get('load'),
      dec: p.get('dec'),
      cv: p.get('cv'),
    };
  }

  const urlInit = useRef(initFromUrl());

  const [activeFormat, setActiveFormat] = useState(() => {
    const u = urlInit.current.fmt;
    if (u && formats?.includes(u)) return u;
    return defaultFormat || (formats ? formats[0] : '');
  });
  const [virtualScrollEnabled, setVirtualScrollEnabled] = useState(() => {
    const u = urlInit.current.virtual;
    if (u === '0' || u === 'false') return false;
    return true;
  });
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(() => {
    const u = urlInit.current.auto;
    if (u === '1' || u === 'true') return true;
    return false;
  });
  const [loadingState, setLoadingState] = useState<LoadingState>(() =>
    parseTriState(urlInit.current.load ?? null, LOADING_STATES)
  );
  const [decodingState, setDecodingState] = useState<DecodingState>(() =>
    parseTriState(urlInit.current.dec ?? null, DECODING_STATES)
  );
  const [cvState, setCvState] = useState<CvState>(() =>
    parseTriState(urlInit.current.cv ?? null, CV_STATES)
  );

  // Sync state -> URL
  useEffect(() => {
    const p = new URLSearchParams();
    if (activeFormat && activeFormat !== (defaultFormat || formats?.[0])) p.set('fmt', activeFormat);
    if (!virtualScrollEnabled) p.set('virtual', '0');
    if (autoScrollEnabled) p.set('auto', '1');
    if (loadingState) p.set('load', loadingState); else if (getUrlParams().has('load')) p.set('load', 'off');
    if (decodingState) p.set('dec', decodingState); else if (getUrlParams().has('dec')) p.set('dec', 'off');
    if (cvState) p.set('cv', cvState); else if (getUrlParams().has('cv')) p.set('cv', 'off');
    const qs = p.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }, [activeFormat, virtualScrollEnabled, autoScrollEnabled, loadingState, decodingState, cvState]);

  const cycleLoading = useCallback(() => {
    setLoadingState((v) => LOADING_STATES[(LOADING_STATES.indexOf(v) + 1) % LOADING_STATES.length]);
  }, []);
  const cycleDecoding = useCallback(() => {
    setDecodingState((v) => DECODING_STATES[(DECODING_STATES.indexOf(v) + 1) % DECODING_STATES.length]);
  }, []);
  const cycleCv = useCallback(() => {
    setCvState((v) => CV_STATES[(CV_STATES.indexOf(v) + 1) % CV_STATES.length]);
  }, []);

  const ROW_HEIGHT = 140;

  useEffect(() => {
    if (!autoScrollEnabled || !parentRef.current) {
      if (autoScrollRef.current !== null) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }
      return;
    }

    const el = parentRef.current;
    const pxPerSecond = ROW_HEIGHT;
    let lastTime: number | null = null;

    const step = (timestamp: number) => {
      if (lastTime !== null) {
        const delta = (timestamp - lastTime) / 1000;
        el.scrollTop += pxPerSecond * delta;

        if (el.scrollTop >= el.scrollHeight - el.clientHeight) {
          el.scrollTop = 0;
        }
      }
      lastTime = timestamp;
      autoScrollRef.current = requestAnimationFrame(step);
    };

    autoScrollRef.current = requestAnimationFrame(step);

    return () => {
      if (autoScrollRef.current !== null) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }
    };
  }, [autoScrollEnabled]);

  const displayItems = useMemo(() => {
    if (!formats || !activeFormat) return items;
    // canvas 选项卡实际使用 .gif 文件（由 GifPlayer 解码渲染）
    const ext = activeFormat === 'canvas' ? 'gif' : activeFormat;
    return items.map((item) => ({
      ...item,
      src: item.basePath ? `${item.basePath}.${ext}` : item.src,
    }));
  }, [items, formats, activeFormat]);

  const columns = useMemo(() => {
    if (typeof window === 'undefined') return defaultColumns;
    const w = window.innerWidth;
    if (w < 480) return 3;
    if (w < 768) return 4;
    if (w < 1024) return 5;
    return defaultColumns;
  }, [defaultColumns]);

  const rows = useMemo(() => {
    const result: EmojiItem[][] = [];
    for (let i = 0; i < displayItems.length; i += columns) {
      result.push(displayItems.slice(i, i + columns));
    }
    return result;
  }, [displayItems, columns]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 0,
  });

  const handleClick = useCallback((src: string) => {
    setPreviewSrc(src);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewSrc(null);
  }, []);

  return (
    <>
      <div className="grid-info">
        <span>{displayItems.length} items</span>
        <div className="grid-controls">
          {formats && formats.length > 1 && (
            <div className="format-switcher">
              {formats.map((fmt) => (
                <button
                  key={fmt}
                  className={`format-btn${activeFormat === fmt ? ' format-btn--active' : ''}`}
                  onClick={() => setActiveFormat(fmt)}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <button
            className={`format-btn${virtualScrollEnabled ? ' format-btn--active' : ''}`}
            onClick={() => setVirtualScrollEnabled((v) => !v)}
            title="Virtual Scroll"
          >
            VIRTUAL
          </button>
          <button
            className={`format-btn${autoScrollEnabled ? ' format-btn--active' : ''}`}
            onClick={() => setAutoScrollEnabled((v) => !v)}
            title="Auto Scroll"
          >
            AUTO
          </button>
          <button
            className={`format-btn${loadingState ? ' format-btn--active' : ''}`}
            onClick={cycleLoading}
            title="loading attribute"
          >
            {loadingState ? `LOAD:${loadingState.toUpperCase()}` : 'LOAD:OFF'}
          </button>
          <button
            className={`format-btn${decodingState ? ' format-btn--active' : ''}`}
            onClick={cycleDecoding}
            title="decoding attribute"
          >
            {decodingState ? `DEC:${decodingState.toUpperCase()}` : 'DEC:OFF'}
          </button>
          <button
            className={`format-btn${cvState ? ' format-btn--active' : ''}`}
            onClick={cycleCv}
            title="content-visibility"
          >
            {cvState ? `CV:${cvState.toUpperCase()}` : 'CV:OFF'}
          </button>
        </div>
      </div>
      <div
        ref={parentRef}
        style={{
          height: 'calc(100vh - 160px)',
          overflow: 'auto',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {virtualScrollEnabled ? (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: '8px',
                  padding: '4px 12px',
                }}
              >
                {rows[virtualRow.index].map((item) => (
                  <div
                    key={item.id}
                    className={`emoji-cell${item.tag ? ' emoji-cell--' + item.tag : ''}`}
                    style={cvState ? { contentVisibility: cvState, containIntrinsicSize: '0 140px' } as React.CSSProperties : undefined}
                    onClick={() => handleClick(item.src)}
                  >
                    {activeFormat === 'mp4' ? (
                      <video
                        src={item.src}
                        autoPlay
                        loop
                        muted
                        playsInline
                        style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}
                      />
                    ) : activeFormat === 'canvas' ? (
                      <GifPlayer src={item.src} />
                    ) : (
                      <img
                        src={item.src}
                        alt={item.id}
                        loading={loadingState}
                        decoding={decodingState}
                      />
                    )}
                    {item.tag && <span className="emoji-tag">{item.tag}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: '8px',
              padding: '4px 12px',
            }}
          >
            {displayItems.map((item) => (
              <div
                key={item.id}
                className={`emoji-cell${item.tag ? ' emoji-cell--' + item.tag : ''}`}
                style={cvState ? { contentVisibility: cvState, containIntrinsicSize: '0 140px' } as React.CSSProperties : undefined}
                onClick={() => handleClick(item.src)}
              >
                {activeFormat === 'mp4' ? (
                  <video
                    src={item.src}
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}
                  />
                ) : activeFormat === 'canvas' ? (
                  <GifPlayer src={item.src} />
                ) : (
                  <img
                    src={item.src}
                    alt={item.id}
                    loading={loadingState}
                    decoding={decodingState}
                  />
                )}
                {item.tag && <span className="emoji-tag">{item.tag}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {previewSrc && (
        <div className="preview-overlay" onClick={closePreview}>
          <div className="preview-content" onClick={(e) => e.stopPropagation()}>
            {activeFormat === 'mp4' ? (
              <video src={previewSrc} autoPlay loop muted playsInline />
            ) : activeFormat === 'canvas' ? (
              <GifPlayer
                src={previewSrc}
                style={{ maxWidth: '400px', maxHeight: '400px', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
              />
            ) : (
              <img src={previewSrc} alt="preview" />
            )}
            <button className="preview-close" onClick={closePreview}>
              &times;
            </button>
          </div>
        </div>
      )}

      <style>{`
        .grid-info {
          padding: 8px 0 12px;
          font-size: 0.85rem;
          color: #666;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .grid-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .format-switcher {
          display: flex;
          gap: 4px;
        }

        .format-btn {
          padding: 3px 10px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: #999;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          letter-spacing: 0.5px;
        }

        .format-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ccc;
        }

        .format-btn--active {
          background: #667eea;
          border-color: #667eea;
          color: #fff;
        }

        .format-btn--active:hover {
          background: #5a6fd6;
        }

        .emoji-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          overflow: hidden;
        }

        .emoji-cell:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: scale(1.05);
        }

        .emoji-cell--png {
          border: 2px solid #f59e0b;
          position: relative;
        }

        .emoji-tag {
          position: absolute;
          top: 4px;
          right: 4px;
          background: #f59e0b;
          color: #000;
          font-size: 0.6rem;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          text-transform: uppercase;
          line-height: 1.4;
        }

        .emoji-cell img {
          max-width: 80%;
          max-height: 80%;
          object-fit: contain;
        }

        .preview-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.2s ease;
        }

        .preview-content {
          position: relative;
          max-width: 90vw;
          max-height: 90vh;
        }

        .preview-content img,
        .preview-content video {
          max-width: 400px;
          max-height: 400px;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        .preview-close {
          position: absolute;
          top: -12px;
          right: -12px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: #333;
          color: #fff;
          font-size: 1.2rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
        }

        .preview-close:hover {
          background: #555;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </>
  );
}
