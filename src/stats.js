// How much wrap this person has got through, measured the way wrap is sold:
// by length. Kept on this device only.

const KEY = 'wrap-stats';

export const MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000]; // metres

export function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      mm: Number(s.mm) || 0,
      pops: Number(s.pops) || 0,
      name: typeof s.name === 'string' ? s.name.slice(0, 24) : '',
    };
  } catch {
    return { mm: 0, pops: 0, name: '' };
  }
}

export function saveStats({ mm, pops, name }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mm, pops, name }));
  } catch {}
}

export function formatLength(mm) {
  if (mm < 1000) return (mm / 10).toFixed(1) + ' cm';
  if (mm < 1e6) return (mm / 1000).toFixed(2) + ' m';
  return (mm / 1e6).toFixed(2) + ' km';
}

export function shareLine(name, mm) {
  const who = name.trim();
  return `${who ? who + ' has' : 'I have'} popped ${formatLength(mm)} of bubble wrap. Your turn: ${location.href}`;
}

const BLITZ_KEY = 'wrap-blitz-best';

export function loadBlitzBest() {
  try {
    return Number(localStorage.getItem(BLITZ_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveBlitzBest(score) {
  try {
    const cur = loadBlitzBest();
    if (score > cur) {
      localStorage.setItem(BLITZ_KEY, String(score));
      return score;
    }
    return cur;
  } catch {
    return score;
  }
}
