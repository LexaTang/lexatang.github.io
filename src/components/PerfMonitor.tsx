import { useEffect, useRef, useState, useCallback } from 'react';

interface PerfStats {
  fps: number;
  avgFps: number;
  frameTime: number;
  memory: number | null;
  domNodes: number;
  imgLoaded: number;
  imgTotal: number;
}

export default function PerfMonitor() {
  const [stats, setStats] = useState<PerfStats>({
    fps: 0,
    avgFps: 0,
    frameTime: 0,
    memory: null,
    domNodes: 0,
    imgLoaded: 0,
    imgTotal: 0,
  });
  const [collapsed, setCollapsed] = useState(false);
  const rafRef = useRef(0);
  const framesRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const frameTimesRef = useRef<number[]>([]);
  const startTimeRef = useRef(performance.now());
  const totalFramesRef = useRef(0);

  const measure = useCallback(() => {
    const now = performance.now();
    const delta = now - lastTimeRef.current;

    frameTimesRef.current.push(delta);
    if (frameTimesRef.current.length > 60) {
      frameTimesRef.current.shift();
    }
    lastTimeRef.current = now;
    framesRef.current++;
    totalFramesRef.current++;

    if (framesRef.current % 30 === 0) {
      const times = frameTimesRef.current;
      const avgFrameTime = times.reduce((a, b) => a + b, 0) / times.length;
      const fps = Math.round(1000 / avgFrameTime);

      const elapsed = (now - startTimeRef.current) / 1000;
      const avgFps = elapsed > 0 ? Math.round(totalFramesRef.current / elapsed) : 0;

      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number };
      };
      const memory = perf.memory
        ? Math.round(perf.memory.usedJSHeapSize / 1048576)
        : null;

      const imgs = document.querySelectorAll('img');
      let loaded = 0;
      imgs.forEach((img) => {
        if (img.complete && img.naturalWidth > 0) loaded++;
      });

      setStats({
        fps,
        avgFps,
        frameTime: Math.round(avgFrameTime * 10) / 10,
        memory,
        domNodes: document.querySelectorAll('*').length,
        imgLoaded: loaded,
        imgTotal: imgs.length,
      });
    }

    rafRef.current = requestAnimationFrame(measure);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(rafRef.current);
  }, [measure]);

  const fpsColor =
    stats.fps >= 55 ? '#4ade80' : stats.fps >= 30 ? '#facc15' : '#f87171';
  const avgFpsColor =
    stats.avgFps >= 55 ? '#4ade80' : stats.avgFps >= 30 ? '#facc15' : '#f87171';

  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          zIndex: 9999,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          borderRadius: 8,
          padding: '6px 10px',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: 12,
          color: fpsColor,
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {stats.fps} FPS
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(12px)',
        borderRadius: 10,
        padding: '10px 14px',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.8,
        color: '#ccc',
        border: '1px solid rgba(255,255,255,0.1)',
        minWidth: 170,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 700, color: '#fff', fontSize: 11, letterSpacing: 1 }}>
          PERF
        </span>
        <span
          onClick={() => setCollapsed(true)}
          style={{ cursor: 'pointer', color: '#888', fontSize: 14, lineHeight: 1 }}
        >
          &minus;
        </span>
      </div>
      <div>
        <span style={{ color: '#888' }}>FPS </span>
        <span style={{ color: fpsColor, fontWeight: 700 }}>{stats.fps}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>Avg </span>
        <span style={{ color: avgFpsColor, fontWeight: 700 }}>{stats.avgFps}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>Frame </span>
        <span>{stats.frameTime}ms</span>
      </div>
      {stats.memory !== null && (
        <div>
          <span style={{ color: '#888' }}>Heap </span>
          <span>{stats.memory} MB</span>
        </div>
      )}
      <div>
        <span style={{ color: '#888' }}>DOM </span>
        <span>{stats.domNodes}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>IMG </span>
        <span>
          {stats.imgLoaded}/{stats.imgTotal}
        </span>
      </div>
    </div>
  );
}
