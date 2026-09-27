import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REFRESH_INTERVALS_SEC = Object.freeze([30, 60, 120, 300]);

export const DEFAULT_SETTINGS = Object.freeze({
  x: null,
  y: null,
  pinned: true,
  compact: false,
  privacy: false,
  intervalSec: 60,
});

const SAVE_DEBOUNCE_MS = 400;

const coordinate = (v) => (Number.isInteger(v) ? v : null);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

/** Coerces untrusted (on-disk) settings into a valid settings object. */
export function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    x: coordinate(src.x),
    y: coordinate(src.y),
    pinned: bool(src.pinned, DEFAULT_SETTINGS.pinned),
    compact: bool(src.compact, DEFAULT_SETTINGS.compact),
    privacy: bool(src.privacy, DEFAULT_SETTINGS.privacy),
    intervalSec: REFRESH_INTERVALS_SEC.includes(src.intervalSec) ? src.intervalSec : DEFAULT_SETTINGS.intervalSec,
  };
}

/** JSON-file settings with debounced, atomic (write-then-rename) saves. */
export class SettingsStore {
  #file;
  #data = { ...DEFAULT_SETTINGS };
  #timer = null;
  #writing = Promise.resolve();

  constructor(file) {
    this.#file = file;
  }

  get data() {
    return this.#data;
  }

  async load() {
    try {
      this.#data = sanitizeSettings(JSON.parse(await readFile(this.#file, 'utf8')));
    } catch {
      this.#data = { ...DEFAULT_SETTINGS };
    }
    return this.#data;
  }

  update(patch) {
    this.#data = sanitizeSettings({ ...this.#data, ...patch });
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
    return this.#data;
  }

  async flush() {
    clearTimeout(this.#timer);
    this.#timer = null;
    const json = JSON.stringify(this.#data, null, 2);
    // Serialize writes so an older snapshot can never land after a newer one.
    this.#writing = this.#writing.then(async () => {
      const tmp = `${this.#file}.tmp`;
      try {
        await mkdir(path.dirname(this.#file), { recursive: true });
        await writeFile(tmp, json, 'utf8');
        await rename(tmp, this.#file);
      } catch (error) {
        console.error('cswap-ui: failed to save settings:', error);
      }
    });
    return this.#writing;
  }
}
