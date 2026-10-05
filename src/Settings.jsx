import { useState } from 'react';
import { THEMES, SOUND_PACKS, AMBIENT_SOUNDS } from './settings.js';
import { formatLength } from './stats.js';
import { haptic, hapticSupport, isIOS } from './wrap/haptics.js';

const HAPTIC_NOTE = {
  native: null,
  vibrate: 'You should feel a buzz when you switch this on. Nothing? Check touch vibration and battery saver in your phone’s settings.',
  ios: 'On iPhone this needs iOS 17.4 or later, at one fixed strength.',
  none: 'This device or browser can’t vibrate from a web page.',
};

function Seg({ label, value, options, onChange }) {
  return (
    <div className="row">
      <span className="lab">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// Each swatch shows the table with a dot of the film colour on it.
function swatch(t) {
  const film = `rgb(${t.tint.map((c) => Math.round(150 + c * 105)).join(',')})`;
  return { background: `radial-gradient(circle at 50% 50%, ${film} 0 34%, ${t.a} 38%)` };
}

export default function Settings({
  open,
  settings,
  set,
  onClose,
  stats,
  blitzBest = 0,
  onStartBlitz,
  name,
  onName,
  onShare,
  shared,
  onReset,
}) {
  const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
  const [sure, setSure] = useState(false);

  return (
    <div className={`panel ${open ? 'open' : ''}`} inert={!open} role="dialog" aria-label="Customize">
      <div className="panel-head">
        <span>Customize</span>
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="themes">
        <div className="themes-head">
          <span className="lab">Theme</span>
          <span className="theme-name">{theme.label}</span>
        </div>
        <div className="swatches" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={settings.theme === t.id}
              style={swatch(t)}
              onClick={() => set({ theme: t.id })}
            />
          ))}
        </div>
      </div>

      <Seg
        label="Bubbles"
        value={settings.size}
        onChange={(v) => set({ size: v })}
        options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]}
      />
      <Seg
        label="Supply"
        value={settings.endless}
        onChange={(v) => set({ endless: v })}
        options={[['roll', 'Endless roll'], ['regrow', 'Refill'], ['off', 'One sheet']]}
      />
      <Seg
        label="Press"
        value={settings.feel}
        onChange={(v) => set({ feel: v })}
        options={[['light', 'Light'], ['normal', 'Normal'], ['firm', 'Firm']]}
      />

      {/* Sound Packs */}
      <Seg
        label="Sound"
        value={settings.soundPack || 'classic'}
        onChange={(v) => set({ soundPack: v })}
        options={[
          ['classic', 'Classic'],
          ['plop', 'Water Plop'],
          ['thock', 'Thock'],
          ['marimba', 'Marimba'],
        ]}
      />

      {settings.soundPack === 'classic' && (
        <Seg
          label="Voice"
          value={settings.voice}
          onChange={(v) => set({ voice: v })}
          options={[['mixed', 'Mixed'], ['soft', 'Soft'], ['crisp', 'Crisp'], ['deep', 'Deep']]}
        />
      )}

      <div className="row">
        <label className="lab" htmlFor="vol">Pop Vol</label>
        <input
          id="vol"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.volume}
          onChange={(e) => set({ volume: Number(e.target.value) })}
        />
      </div>

      {/* Ambient ASMR Soundscape */}
      <Seg
        label="Ambient"
        value={settings.ambient || 'off'}
        onChange={(v) => set({ ambient: v })}
        options={[
          ['off', 'Off'],
          ['rain', 'Rain'],
          ['waves', 'Waves'],
          ['hum', 'Zen Hum'],
        ]}
      />

      {settings.ambient !== 'off' && (
        <div className="row">
          <label className="lab" htmlFor="ambvol">ASMR Vol</label>
          <input
            id="ambvol"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.ambientVol ?? 0.35}
            onChange={(e) => set({ ambientVol: Number(e.target.value) })}
          />
        </div>
      )}

      {isIOS && (
        <p className="note">iPhone tip: if you don’t hear sound, check your side Silent switch or Action Button, and turn up media volume.</p>
      )}

      <Seg
        label="Vibration"
        value={settings.haptics}
        onChange={(v) => {
          set({ haptics: v });
          haptic(false, v);
        }}
        options={[['off', 'Off'], ['light', 'Light'], ['strong', 'Strong']]}
      />
      {HAPTIC_NOTE[hapticSupport] && (settings.haptics !== 'off' || hapticSupport === 'none') && (
        <p className="note">{HAPTIC_NOTE[hapticSupport]}</p>
      )}

      <Seg
        label="Zen Guide"
        value={settings.zenBreathe ? 'on' : 'off'}
        onChange={(v) => set({ zenBreathe: v === 'on' })}
        options={[['on', 'Show'], ['off', 'Hide']]}
      />

      <Seg
        label="Pop Speed"
        value={settings.showPpm ? 'on' : 'off'}
        onChange={(v) => set({ showPpm: v === 'on' })}
        options={[['on', 'Show'], ['off', 'Hide']]}
      />
      {settings.showPpm && (
        <p className="note">Shows real-time pops per minute while you pop.</p>
      )}

      <Seg
        label="Breaks"
        value={settings.windDown ? 'on' : 'off'}
        onChange={(v) => set({ windDown: v === 'on' })}
        options={[['on', 'Every 1,000'], ['off', 'Never']]}
      />

      <div className="challenge-row">
        <button
          type="button"
          className="blitz-btn"
          onClick={() => {
            onClose();
            onStartBlitz?.();
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Start 30s Pop Blitz</span>
        </button>
        {blitzBest > 0 && <span className="blitz-best">Best: {blitzBest} pops</span>}
      </div>

      <div className="yours">
        <div className="yours-head">
          <span className="lab">Your wrap</span>
          <span className="yours-total">{formatLength(stats.mm)}</span>
        </div>
        <p className="yours-detail">
          {formatLength(stats.session)} this visit · {stats.pops.toLocaleString()} bubbles all time
        </p>
        <div className="yours-row">
          <input
            type="text"
            value={name}
            maxLength={24}
            placeholder="Your name"
            aria-label="Your name, used when you share"
            onChange={(e) => onName(e.target.value)}
          />
          <button type="button" className="act" onClick={onShare}>
            {shared ? 'Done' : 'Share'}
          </button>
        </div>
        <Seg
          label="Meter"
          value={settings.meter ? 'on' : 'off'}
          onChange={(v) => set({ meter: v === 'on' })}
          options={[['on', 'Show'], ['off', 'Hide']]}
        />
        <button
          type="button"
          className={sure ? 'reset sure' : 'reset'}
          onClick={() => {
            if (sure) onReset();
            setSure(!sure);
          }}
          onBlur={() => setSure(false)}
        >
          {sure ? 'Tap again to reset' : 'Reset counters and wrap'}
        </button>
      </div>
    </div>
  );
}
