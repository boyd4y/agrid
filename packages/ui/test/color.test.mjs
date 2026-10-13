import assert from 'node:assert/strict';
import test from 'node:test';
import { hexToHsv, hsvToHex, normalizeColorHex } from '../src/lib/color.ts';

test('HEX accepts complete RGB/RRGGBB input and rejects incomplete or non-HEX values', () => {
  assert.equal(normalizeColorHex(' #AbC '), '#aabbcc');
  assert.equal(normalizeColorHex('Ff0022'), '#ff0022');
  for (const input of ['', '#', '#12', '#abcd', '#1234567', 'rgb(1,2,3)', '#ggg']) {
    assert.equal(normalizeColorHex(input), null);
    assert.equal(hexToHsv(input), null);
  }
});

test('HSV handles every hue sector, black/white and achromatic colors', () => {
  const primaries = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];
  primaries.forEach((hex, index) => {
    assert.deepEqual(hexToHsv(hex), { h: index * 60, s: 1, v: 1 });
    assert.equal(hsvToHex({ h: index * 60, s: 1, v: 1 }), hex);
  });
  assert.deepEqual(hexToHsv('#000'), { h: 0, s: 0, v: 0 });
  assert.deepEqual(hexToHsv('#fff'), { h: 0, s: 0, v: 1 });
  assert.deepEqual(hexToHsv('#808080'), { h: 0, s: 0, v: 128 / 255 });
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), '#ff0000');
  assert.equal(hsvToHex({ h: -60, s: 1, v: 1 }), '#ff00ff');
  assert.equal(hsvToHex({ h: 10, s: 2, v: -1 }), '#000000');
  assert.equal(hsvToHex({ h: 10, s: -1, v: 2 }), '#ffffff');
});

test('RGB/HSV round trips preserve saved colors without channel rounding drift', () => {
  // Exercise hue-sector boundaries, near-black, near-white and varied saved HEX.
  for (const r of [0, 1, 15, 64, 127, 128, 192, 254, 255]) {
    for (const g of [0, 1, 64, 128, 254, 255]) {
      for (const b of [0, 1, 64, 128, 254, 255]) {
        const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
        assert.equal(hsvToHex(hexToHsv(hex)), hex);
      }
    }
  }
});
