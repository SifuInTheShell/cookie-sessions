import WheelPainter from './vendor/wheel-of-names/WheelPainter.js';

export const SPIN_DURATION_MS = 10000;

// Wheel backgrounds a host can pick per evening. Sources and licenses: assets/IMAGE-CREDITS.md.
export const WHEEL_THEMES = {
  cookie: { label: 'Chocolate chip cookie', file: 'chocolate-chip-cookie.jpg', emoji: '🍪' },
  pumpkin: { label: 'Halloween pumpkin', file: 'wheel-pumpkin.jpg', emoji: '🎃' },
  vinyl: { label: 'Vinyl record', file: 'wheel-vinyl.jpg', emoji: '💿' },
  christmas: { label: 'Christmas', file: 'wheel-christmas.jpg', emoji: '🎄' },
  donut: { label: 'Donut', file: 'wheel-donut.jpg', emoji: '🍩' },
  pizza: { label: 'Pizza', file: 'wheel-pizza.jpg', emoji: '🍕' }
};
export function themeKey(key) { return Object.hasOwn(WHEEL_THEMES, key) ? key : 'cookie'; }
const TAU = Math.PI * 2;

// Rejection sampling gives every queued track the same probability.
export function randomIndex(length, random = crypto) {
  if (!Number.isInteger(length) || length < 1 || length > 200) throw Error('Invalid wheel entry count.');
  const limit = Math.floor(0x100000000 / length) * length;
  const buffer = new Uint32Array(1);
  do { random.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % length;
}

export function createSpinPlan(tracks, now = Date.now(), random = crypto) {
  const index = randomIndex(tracks.length, random);
  const buffer = new Uint32Array(1);
  random.getRandomValues(buffer);
  const sector = TAU / tracks.length;
  // Original renderer places slice zero at the right-hand pointer.
  // Stop safely inside the selected slice, away from boundary rounding.
  const offset = (buffer[0] / 0x100000000 - .5) * sector * .7;
  return {
    spinTargetId: tracks[index].id,
    spinTracks: tracks.map(t => ({ id: t.id, title: t.title })),
    spinStartedAt: now,
    spinDurationMs: SPIN_DURATION_MS,
    spinFinalAngle: TAU * 7 + index * sector + offset
  };
}

export function spinAngle(plan, now = Date.now()) {
  const progress = Math.max(0, Math.min(1, (now - plan.spinStartedAt) / plan.spinDurationMs));
  return plan.spinFinalAngle * (1 - Math.pow(1 - progress, 4));
}

export function indexAtPointer(angle, count) {
  const normalized = ((angle % TAU) + TAU) % TAU;
  return Math.round(normalized / (TAU / count)) % count;
}

export class CookieWheel {
  constructor(canvas, repaint) {
    this.context = canvas.getContext('2d');
    this.painter = new WheelPainter();
    this.key = '';
    this.repaint = repaint;
    this.cover = '';
    // Settings copied from the user's saved q8g-7gj cookie wheel.
    this.config = {
      type: 'image', hubSize: 'S', isAdvanced: false, drawOutlines: false,
      pageBackgroundColor: '#291d18',
      getCoverImage: () => this.cover,
      getWheelImage: () => null,
      getCoalescedColors: () => ['#5DADE2', '#82E0AA', '#F7DC6F', '#AF7AC5']
    };
    this.setTheme('cookie');
  }

  // Swaps the background picture; the next draw uses it, and a first load repaints when it arrives.
  setTheme(key) {
    const url = new URL(`./assets/${WHEEL_THEMES[themeKey(key)].file}`, import.meta.url).href;
    if (url === this.cover) return;
    this.cover = url;
    const images = this.painter.imageCache.images;
    if (!images[url]) {
      const image = new Image();
      image.onload = () => this.repaint();
      images[url] = image;
      image.src = url;
    }
  }

  draw(tracks, angle = 0) {
    const entries = tracks.length ? tracks.map(t => ({ text: t.title })) : [{ text: 'Add songs to spin' }];
    const key = JSON.stringify(entries);
    if (key !== this.key) { this.key = key; this.painter.refresh(); }
    this.painter.draw(this.context, angle, entries, entries, this.config, false);
  }
}
