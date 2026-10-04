// Everything the person popping can change. Kept in one place so the panel,
// the engine and the sound all read the same shape.

// A theme is a table to lay the wrap on and the colour of the film itself.
// `tint` is what the film lets through; white means ordinary clear wrap.
// `ink` says whether page text over the table should be light or dark.
export const THEMES = [
  { id: 'studio', label: 'Studio', a: '#465060', b: '#2a3039', tex: 0.03, tint: [1, 1, 1], ink: 'light' },
  { id: 'noir', label: 'Noir', a: '#2b2e33', b: '#17191c', tex: 0.04, tint: [1, 1, 1], ink: 'light' },
  { id: 'kraft', label: 'Kraft', a: '#9a7a56', b: '#6b5238', tex: 0.14, tint: [1, 1, 1], ink: 'light' },
  { id: 'blush', label: 'Blush', a: '#d6aaa6', b: '#b0827f', tex: 0.04, tint: [1.0, 0.74, 0.8], ink: 'dark' },
  { id: 'mint', label: 'Mint', a: '#a3c4b2', b: '#7a9c8a', tex: 0.04, tint: [0.74, 1.0, 0.86], ink: 'dark' },
  { id: 'sky', label: 'Sky', a: '#a5bcd8', b: '#7c94b2', tex: 0.04, tint: [0.76, 0.88, 1.0], ink: 'dark' },
  { id: 'lilac', label: 'Lilac', a: '#bcaed8', b: '#9384b2', tex: 0.04, tint: [0.86, 0.79, 1.0], ink: 'dark' },
];

export const DEFAULTS = {
  theme: 'studio',
  size: 'm', // s | m | l
  endless: 'roll', // roll | regrow | off
  feel: 'normal', // light | normal | firm
  voice: 'mixed', // mixed | soft | crisp | deep
  volume: 0.9,
  haptics: 'light', // off | light | strong
  windDown: true,
  meter: true,
};

const KEY = 'wrap-settings';

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
    }
    if (!THEMES.some((t) => t.id === out.theme)) out.theme = DEFAULTS.theme;
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}
