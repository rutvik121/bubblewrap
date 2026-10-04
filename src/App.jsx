import { useCallback, useEffect, useRef, useState } from 'react';
import { BubbleWrap } from './wrap/engine.js';
import { PopAudio } from './wrap/audio.js';
import { haptic, hapticPress } from './wrap/haptics.js';
import { THEMES, loadSettings, saveSettings } from './settings.js';
import { MILESTONES, formatLength, loadStats, saveStats, shareLine } from './stats.js';
import { emptyCopy, milestoneCopy } from './copy.js';
import Settings from './Settings.jsx';

// The break comes each time the bubble counter on screen passes another
// multiple of this. Adding ?every=50 to the address shortens it, which is
// handy for seeing the break quickly.
const EVERY = Math.max(10, Number(new URLSearchParams(location.search).get('every')) || 1000);
const nextMark = (count) => (Math.floor(count / EVERY) + 1) * EVERY;

function readMuted() {
  try {
    return localStorage.getItem('wrap-muted') === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const canvasRef = useRef(null);
  const engine = useRef(null);
  const audio = useRef(null);
  // pops: bubbles this sitting. next: the all-time count that earns the next
  // break. breaks: how many have been shown, which picks the line.
  const journey = useRef({ lastPop: 0, pops: 0, next: 0, breaks: 0 });
  const [pause, setPause] = useState({ count: 0, line: '', ask: '' });
  // Length of wrap popped: all time (saved) and since the page opened.
  const stats = useRef({ ...loadStats(), session: 0, dirty: false });
  if (!journey.current.next) journey.current.next = nextMark(stats.current.pops);
  const meterNum = useRef(null);
  const meterCount = useRef(null);
  const [caption, setCaption] = useState('of wrap');
  const [view, setView] = useState(() => ({ mm: stats.current.mm, session: 0, pops: stats.current.pops }));
  const [name, setName] = useState(stats.current.name);
  const [shared, setShared] = useState(false);
  // pop → breath → ask → (pop | bye)
  const [phase, setPhase] = useState('pop');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [muted, setMuted] = useState(readMuted);
  const [settings, setSettings] = useState(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // On a wide screen there's room beside the strip, so the controls start open.
  const [panel, setPanel] = useState(() => window.matchMedia('(min-width: 1100px)').matches);

  useEffect(() => {
    const a = new PopAudio();
    a.setMuted(readMuted());
    // The meter is written straight to the page so it keeps up with fast popping.
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
      // Sound, haptic and collapse all fire from the same frame.
      onPop: (info) => {
        a.pop(info);
        haptic(info.strong, settingsRef.current.haptics);
        journey.current.pops++;
        journey.current.lastPop = performance.now();
        stats.current.pops++;
        addLength(info.length);
      },
      onDud: (info) => a.dud(info),
      // A finished sheet is rounded up to its full 50 cm as it rolls away.
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

  useEffect(() => {
    engine.current.setOptions(settings);
    audio.current.setVolume(settings.volume);
    audio.current.setVoice(settings.voice);
    saveSettings(settings);
    const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
    document.documentElement.dataset.ink = theme.ink;
  }, [settings]);

  // The journey: the longer the popping goes on, the calmer everything gets.
  useEffect(() => {
    const STEP = 0.2;
    const id = setInterval(() => {
      const j = journey.current;
      const s = settingsRef.current;
      const st = stats.current;
      if (st.dirty) {
        st.dirty = false;
        saveStats(st);
        setView({ mm: st.mm, session: st.session, pops: st.pops });
      }
      if (phaseRef.current !== 'pop' || !j.pops) return;
      const idle = (performance.now() - j.lastPop) / 1000;
      const single = s.endless === 'off';
      const done = engine.current.fraction();

      // Things mellow as the next break gets closer.
      let calm = 0;
      if (s.windDown) calm = single ? done * 0.9 : Math.min(0.85, (1 - (j.next - st.pops) / EVERY) * 0.85);
      engine.current.setCalm(Math.max(0, calm));
      audio.current.setCalm(Math.max(0, calm));

      // The break is earned when the counter passes the mark, and shown at
      // the first pause in the popping (or shortly after, if there isn't
      // one). A single sheet also stops when it's been popped clean.
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
    } catch {
      // Share sheet dismissed, or clipboard blocked: nothing to do.
    }
  }, []);

  const resetStats = useCallback(() => {
    const st = stats.current;
    st.mm = st.session = st.pops = 0;
    journey.current.pops = 0;
    journey.current.next = EVERY;
    // Back to the very start: counters at zero and an untouched sheet.
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

      <div className={`veil ${phase !== 'pop' ? 'on' : ''}`} aria-live="polite">
        <div className={`beat ${phase === 'breath' ? 'show breathe' : ''}`}>
          <span className="tally">{pause.count.toLocaleString()} bubbles</span>
          <p>{pause.line}</p>
        </div>
        <div className={`beat ${phase === 'ask' ? 'show' : ''}`}>
          <p>{pause.ask}</p>
          {/* The same two numbers the meter was showing when the break began. */}
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
        Bubble Wrap
      </div>

      <div className={'meter' + (settings.meter && phase === 'pop' ? '' : ' hide')} aria-live="off">
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
        name={name}
        onName={rename}
        onShare={share}
        shared={shared}
        onReset={resetStats}
      />

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
