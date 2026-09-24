import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drawTrayBitmap } from '../src/main/tray-icon.js';

const alphaAt = (buf, size, x, y) => buf[(y * size + x) * 4 + 3];

describe('drawTrayBitmap', () => {
  for (const size of [16, 32]) {
    it(`draws a ${size}px ring with a centre dot`, () => {
      const buf = drawTrayBitmap(size);
      assert.equal(buf.length, size * size * 4);
      assert.equal(alphaAt(buf, size, 0, 0), 0, 'corners are transparent');
      assert.ok(alphaAt(buf, size, size / 2, size / 2) > 200, 'centre dot is opaque');
      assert.ok(alphaAt(buf, size, size / 2, 1) > 200, 'ring is opaque');
      // Midway between the dot (r = 0.14·size) and the ring's inner edge (r = 0.28·size).
      const gapY = Math.round((size - 1) / 2 - size * 0.21);
      assert.equal(alphaAt(buf, size, size / 2, gapY), 0, 'gap between ring and dot');
    });
  }
});
