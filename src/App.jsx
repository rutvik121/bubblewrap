import { useCallback, useEffect, useRef, useState } from 'react';
import { BubbleWrap } from './wrap/engine.js';
import { PopAudio } from './wrap/audio.js';
import { haptic, hapticPress } from './wrap/haptics.js';
import { THEMES, loadSettings, saveSettings } from './settings.js';
import { MILESTONES, formatLength, loadStats, saveStats, shareLine, loadBlitzBest, saveBlitzBest } from './stats.js';
import { emptyCopy, milestoneCopy } from './copy.js';
import Settings from './Settings.jsx';

const EVERY = Math.max(10, Number(new URLSearchParams(location.search).get('every')) || 1000);
const nextMark = (count) => (Math.floor(count / EVERY) + 1) * EVERY;

function readMuted() {
  try {
    return localStorage.getItem('wrap-muted') === '1';
  } catch {
    return false;
  }
}

const KEY_ROWS = [
  { row: 0.18, keys: '1234567890-=' },
  { row: 0.38, keys: 'qwertyuiop[]\\' },
  { row: 0.58, keys: "asdfghjkl;'" },
  { row: 0.78, keys: 'zxcvbnm,./' },
];

export default function App() {
  const canvasRef = useRef(null);
  const engine = useRef(null);
  const audio = useRef(null);
  const lastMouse = useRef({ x: 0, y: 0, onScreen: false });

  const journey = useRef({ lastPop: 0, pops: 0, next: 0, breaks: 0 });
  const [pause, setPause] = useState({ count: 0, line: '', ask: '' });
  const stats = useRef({ ...loadStats(), session: 0, dirty: false });
  if (!journey.current.next) journey.current.next = nextMark(stats.current.pops);

  const meterNum = useRef(null);
  const meterCount = useRef(null);
  const [caption, setCaption] = useState('of wrap');
  const [view, setView] = useState(() => ({ mm: stats.current.mm, session: 0, pops: stats.current.pops }));
  const [name, setName] = useState(stats.current.name);
  const [shared, setShared] = useState(false);

  const [phase, setPhase] = useState('pop');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const [muted, setMuted] = useState(readMuted);
  const [settings, setSettings] = useState(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [panel, setPanel] = useState(() => window.matchMedia('(min-width: 1100px)').matches);
  const [fullscreen, setFullscreen] = useState(() => Boolean(typeof document !== 'undefined' && document.fullscreenElement));

  // Speed meter (PPM: Pops Per Minute)
  const popTimes = useRef([]);
  const [ppm, setPpm] = useState(0);

  // Lucky golden bubble toast
  const [luckyToast, setLuckyToast] = useState(false);

  // 30s Pop Blitz Challenge mode
  const [blitz, setBlitz] = useState(() => ({
    active: false,
    timeLeft: 30,
    pops: 0,
    best: loadBlitzBest(),
    isNewBest: false,
    showResult: false,
  }));
  const blitzRef = useRef(blitz);
  blitzRef.current = blitz;

  // Listen to fullscreen changes
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // 30s Blitz Controls
  const startBlitz = useCallback(() => {
    setPhase('pop');
    setPanel(false);
    audio.current?.resume();
    engine.current?.reset();
    setBlitz({
      active: true,
      timeLeft: 30,
      pops: 0,
      best: loadBlitzBest(),
      isNewBest: false,
      showResult: false,
    });
  }, []);

  const stopBlitz = useCallback((finalPops) => {
    const curBest = loadBlitzBest();
    const isNew = finalPops > curBest;
    const best = saveBlitzBest(finalPops);
    setBlitz((b) => ({
      ...b,
      active: false,
      timeLeft: 0,
      pops: finalPops,
      best,
      isNewBest: isNew,
      showResult: true,
    }));
  }, []);

  useEffect(() => {
    if (!blitz.active) return;
    const timer = setInterval(() => {
      setBlitz((b) => {
        if (!b.active) return b;
        if (b.timeLeft <= 1) {
          clearInterval(timer);
          stopBlitz(b.pops);
          return { ...b, active: false, timeLeft: 0 };
        }
        return { ...b, timeLeft: b.timeLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [blitz.active, stopBlitz]);

  useEffect(() => {
    const a = new PopAudio();
    a.setMuted(readMuted());
    a.setSoundPack(settingsRef.current.soundPack);
    a.setAmbient(settingsRef.current.ambient);
    a.setAmbientVolume(settingsRef.current.ambientVol);

    const addLength = (mm) => {
      const st = stats.current;
      const before = st.mm;
      st.mm += mm;
      st.session += mm;
      st.dirty = true;
      if (meterNum.current) meterNum.current.textContent = formatLength(st.mm);
      if (meterCount.current) meterCount.current.textContent = st.pops.toLocaleString();
      const hit = MILESTONES.find((m) => before < m * 1000 && st.mm >= m * 1000);
      if (hit) {
        setCaption(hit >= 1000 ? '1 km!' : hit + (hit === 1 ? ' metre!' : ' metres!'));
        setTimeout(() => setCaption('of wrap'), 4500);
      }
    };

    const e = new BubbleWrap(canvasRef.current, settingsRef.current, {
      onPress: () => {
        a.resume();
        hapticPress(settingsRef.current.haptics);
      },
      onPop: (info) => {
        a.pop(info);
        haptic(info.strong, settingsRef.current.haptics);
        journey.current.pops++;
        journey.current.lastPop = performance.now();
        stats.current.pops++;
        addLength(info.length);

        // Record for live PPM calculation
        popTimes.current.push(performance.now());

        // Increment blitz counter if blitz active
        if (blitzRef.current.active) {
          setBlitz((b) => ({ ...b, pops: b.pops + 1 }));
        }

        // Lucky Golden Bubble celebration
        if (info.special) {
          setLuckyToast(true);
          setTimeout(() => setLuckyToast(false), 2400);
        }
      },
      onDud: (info) => a.dud(info),
      onFeed: (info) => {
        a.rustle();
        if (info.length > 0) addLength(info.length);
      },
    });

    audio.current = a;
    engine.current = e;

    const unlock = () => {
      a.resume();
    };
    const events = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'];
    events.forEach((evt) => {
      window.addEventListener(evt, unlock, { capture: true, passive: true });
    });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        a.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      events.forEach((evt) => {
        window.removeEventListener(evt, unlock, { capture: true });
      });
      document.removeEventListener('visibilitychange', onVisibility);
      e.dispose();
      a.dispose();
    };
  }, []);

  // Keyboard desktop popping & cursor tracking
  useEffect(() => {
    const onMouseMove = (e) => {
      lastMouse.current = { x: e.clientX, y: e.clientY, onScreen: true };
    };
    const onMouseLeave = () => {
      lastMouse.current.onScreen = false;
    };
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    const onKeyDown = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      ) {
        return;
      }
      if (phaseRef.current !== 'pop') return;

      audio.current?.resume();

      if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const m = lastMouse.current;
        if (m.onScreen && m.x > 0 && m.y > 0) {
          const popped = engine.current?.popAtPoint(m.x, m.y);
          if (!popped) engine.current?.popRandomOnScreen();
        } else {
          engine.current?.popRandomOnScreen();
        }
        return;
      }

      // Key row coordinates mapping
      const k = e.key.toLowerCase();
      for (const r of KEY_ROWS) {
        const idx = r.keys.indexOf(k);
        if (idx !== -1) {
          e.preventDefault();
          const nx = (idx + 0.5) / r.keys.length;
          const ny = r.row;
          engine.current?.popAtNormalized(nx, ny);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Sync settings to engine & audio
  useEffect(() => {
    if (!engine.current || !audio.current) return;
    engine.current.setOptions(settings);
    audio.current.setVolume(settings.volume);
    audio.current.setVoice(settings.voice);
    audio.current.setSoundPack(settings.soundPack);
    audio.current.setAmbient(settings.ambient);
    audio.current.setAmbientVolume(settings.ambientVol);
    saveSettings(settings);
    const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
    document.documentElement.dataset.ink = theme.ink;
  }, [settings]);

  // Rolling stats, breaks, and live PPM computation
  useEffect(() => {
    const STEP = 0.2;
    const id = setInterval(() => {
      const j = journey.current;
      const s = settingsRef.current;
      const st = stats.current;

      // Update live PPM
      const cutoff = performance.now() - 3200;
      while (popTimes.current.length > 0 && popTimes.current[0] < cutoff) {
        popTimes.current.shift();
      }
      const currentPpm = popTimes.current.length > 0 ? Math.round((popTimes.current.length / 3.2) * 60) : 0;
      setPpm(currentPpm);

      if (st.dirty) {
        st.dirty = false;
        saveStats(st);
        setView({ mm: st.mm, session: st.session, pops: st.pops });
      }
      if (phaseRef.current !== 'pop' || !j.pops || blitzRef.current.active) return;
      const idle = (performance.now() - j.lastPop) / 1000;
      const single = s.endless === 'off';
      const done = engine.current.fraction();

      let calm = 0;
      if (s.windDown) calm = single ? done * 0.9 : Math.min(0.85, (1 - (j.next - st.pops) / EVERY) * 0.85);
      engine.current.setCalm(Math.max(0, calm));
      audio.current.setCalm(Math.max(0, calm));

      const earned = s.windDown && st.pops >= j.next && (idle > 0.8 || st.pops >= j.next + EVERY * 0.15);
      const empty = single && done >= 0.985 && idle > 0.9;
      if (earned) {
        const [line, ask] = milestoneCopy(++j.breaks);
        setPause({ count: j.next, line, ask });
        j.next = nextMark(st.pops);
        setPhase('breath');
      } else if (empty) {
        const [line, ask] = emptyCopy();
        setPause({ count: j.pops, line, ask });
        setPhase('breath');
      }
    }, STEP * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase === 'pop') return;
    setPanel(false);
    engine.current.setInteractive(false);
    engine.current.setCalm(1);
    audio.current.setCalm(1);
    if (phase !== 'breath') return;
    const id = setTimeout(() => setPhase('ask'), 4800);
    return () => clearTimeout(id);
  }, [phase]);

  const again = useCallback(() => {
    journey.current.next = nextMark(stats.current.pops);
    engine.current.reset();
    engine.current.setCalm(0);
    engine.current.setInteractive(true);
    audio.current.resume();
    audio.current.setCalm(0);
    setPhase('pop');
  }, []);

  const fresh = useCallback(() => {
    audio.current.resume();
    engine.current.feed();
  }, []);

  const set = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);

  const rename = useCallback((value) => {
    const v = value.slice(0, 24);
    stats.current.name = v;
    stats.current.dirty = true;
    setName(v);
  }, []);

  const share = useCallback(async () => {
    const text = shareLine(stats.current.name, stats.current.mm);
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {}
  }, []);

  const resetStats = useCallback(() => {
    const st = stats.current;
    st.mm = st.session = st.pops = 0;
    journey.current.pops = 0;
    journey.current.next = EVERY;
    engine.current.reset();
    engine.current.setCalm(0);
    audio.current.setCalm(0);
    saveStats(st);
    setView({ mm: 0, session: 0, pops: 0 });
    if (meterNum.current) meterNum.current.textContent = formatLength(0);
    if (meterCount.current) meterCount.current.textContent = '0';
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      audio.current.resume();
      audio.current.setMuted(next);
      try {
        localStorage.setItem('wrap-muted', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="wrap" />

      {/* Lucky Golden Bubble Toast */}
      <div className={`lucky-toast ${luckyToast ? 'show' : ''}`} aria-hidden="true">
        <span>✨ Lucky Golden Bubble!</span>
      </div>

      {/* Zen Breathe Visual Rhythm Guide */}
      {settings.zenBreathe && phase === 'pop' && !blitz.active && (
        <div className="zen-breathe-guide" aria-hidden="true">
          <div className="zen-circle" />
          <span className="zen-caption">Breathe</span>
        </div>
      )}

      {/* 30s Blitz Challenge HUD */}
      {blitz.active && phase === 'pop' && (
        <div className="blitz-hud" aria-live="polite">
          <div className="blitz-timer">
            <span className="blitz-sec">{blitz.timeLeft}s</span>
          </div>
          <div className="blitz-score">
            <span className="blitz-num">{blitz.pops}</span>
            <span className="blitz-lbl">POPS</span>
          </div>
          <button type="button" className="blitz-cancel" onClick={() => stopBlitz(blitz.pops)}>
            End
          </button>
        </div>
      )}

      {/* 30s Blitz Result Modal */}
      {blitz.showResult && (
        <div className="blitz-modal-backdrop">
          <div className="blitz-modal">
            <span className="blitz-badge">{blitz.isNewBest ? '🏆 New Best!' : '⚡ Blitz Complete'}</span>
            <h2>{blitz.pops} Bubbles</h2>
            <p className="blitz-stat">in 30 seconds</p>
            <p className="blitz-record">Personal Record: {blitz.best} pops</p>
            <div className="blitz-actions">
              <button type="button" className="blitz-again" onClick={startBlitz}>
                Try Again
              </button>
              <button type="button" className="blitz-done" onClick={() => setBlitz((b) => ({ ...b, showResult: false }))}>
                Keep Relaxing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mindful Pause / Breaks */}
      <div className={`veil ${phase !== 'pop' ? 'on' : ''}`} aria-live="polite">
        <div className={`beat ${phase === 'breath' ? 'show breathe' : ''}`}>
          <span className="tally">{pause.count.toLocaleString()} bubbles</span>
          <p>{pause.line}</p>
        </div>
        <div className={`beat ${phase === 'ask' ? 'show' : ''}`}>
          <p>{pause.ask}</p>
          {settings.meter && (
            <p className="sub">
              {stats.current.pops.toLocaleString()} bubbles, {formatLength(stats.current.mm)} of wrap so far.
            </p>
          )}
          <div className="choices">
            <button type="button" onClick={again} tabIndex={phase === 'ask' ? 0 : -1}>
              Keep popping
            </button>
            <button type="button" onClick={() => setPhase('bye')} tabIndex={phase === 'ask' ? 0 : -1}>
              I’m good
            </button>
          </div>
        </div>
        <div className={`beat ${phase === 'bye' ? 'show' : ''}`}>
          <p>Go gently.</p>
          <div className="choices late">
            <button type="button" onClick={again} tabIndex={phase === 'bye' ? 0 : -1}>
              Pop again
            </button>
          </div>
        </div>
      </div>

      <div className={phase !== 'pop' ? 'mark hide' : 'mark'} aria-hidden="true">
        <span className="mark-title">Pop Therapy</span>
        <span className="mark-sub">virtual bubble wrap</span>
      </div>

      {/* Real-time Meter & Speed Gauge */}
      <div className={'meter' + (settings.meter && phase === 'pop' ? '' : ' hide')} aria-live="off">
        {settings.showPpm && ppm > 0 && (
          <div className={`stat ppm-stat ${ppm >= 160 ? 'frenzy' : ''}`}>
            <span className="meter-num">{ppm}</span>
            <span className="meter-cap">pops/min</span>
          </div>
        )}
        <div className="stat">
          <span className="meter-num" ref={meterCount}>
            {stats.current.pops.toLocaleString()}
          </span>
          <span className="meter-cap">bubbles</span>
        </div>
        <div className="stat">
          <span className="meter-num" ref={meterNum}>
            {formatLength(stats.current.mm)}
          </span>
          <span className={'meter-cap' + (caption === 'of wrap' ? '' : ' hit')}>{caption}</span>
        </div>
      </div>

      <Settings
        open={panel && phase === 'pop'}
        settings={settings}
        set={set}
        onClose={() => setPanel(false)}
        stats={view}
        blitzBest={blitz.best}
        onStartBlitz={startBlitz}
        name={name}
        onName={rename}
        onShare={share}
        shared={shared}
        onReset={resetStats}
      />

      {/* Floating Bottom Dock */}
      <div className="dock">
        {phase === 'pop' && (
          <>
            <button
              type="button"
              className="dock-main"
              onClick={() => setPanel((p) => !p)}
              aria-expanded={panel}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
                <circle cx="15" cy="7" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="17" cy="17" r="2" />
              </svg>
              <span>Customize</span>
            </button>
            <span className="dock-rule" />
            <button type="button" className="dock-icon" onClick={fresh} aria-label="Fresh wrap" title="Fresh wrap">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12a8 8 0 1 1-2.6-5.9" />
                <path d="M20 4v4.5h-4.5" />
              </svg>
            </button>
            <button
              type="button"
              className={`dock-icon ${settings.zenBreathe ? 'active' : ''}`}
              onClick={() => set({ zenBreathe: !settings.zenBreathe })}
              aria-label="Zen Breathe guide"
              title="Zen Breathe guide"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            </button>
            <button
              type="button"
              className={`dock-icon ${blitz.active ? 'active' : ''}`}
              onClick={blitz.active ? () => stopBlitz(blitz.pops) : startBlitz}
              aria-label="30s Pop Blitz"
              title="30s Pop Blitz"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </button>
            <button
              type="button"
              className="dock-icon"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 9l-7 7M3 15l7-7" />
                </svg>
              )}
            </button>
            <span className="dock-rule" />
          </>
        )}
        <button
          type="button"
          className="dock-icon"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z" />
            {muted ? (
              <path d="M16 9.5l4.5 5M20.5 9.5l-4.5 5" />
            ) : (
              <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" />
            )}
          </svg>
        </button>
      </div>
    </>
  );
}
