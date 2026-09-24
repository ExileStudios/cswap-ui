/**
 * Draws the tray icon (a ring around a dot) as a raw BGRA bitmap, so the app
 * ships without binary image assets and stays crisp at any scale factor.
 */

const ACCENT = Object.freeze({ r: 0xd9, g: 0xa0, b: 0x7a });

/** Returns a BGRA buffer of `size`×`size` pixels. */
export function drawTrayBitmap(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size / 2;
  const inner = size * 0.28;
  const dot = size * 0.14;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      // Signed-distance coverage with a 1px anti-aliased edge.
      const ring = Math.min(outer - d, d - inner);
      const coverage = Math.max(0, Math.min(1, Math.max(ring, dot - d) + 0.5));
      if (!coverage) continue;
      const i = (y * size + x) * 4;
      buf[i] = ACCENT.b;
      buf[i + 1] = ACCENT.g;
      buf[i + 2] = ACCENT.r;
      buf[i + 3] = Math.round(coverage * 255);
    }
  }
  return buf;
}

/** @param {typeof import('electron').nativeImage} nativeImage */
export function createTrayIcon(nativeImage) {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const size = 16 * scaleFactor;
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: drawTrayBitmap(size) });
  }
  return image;
}
