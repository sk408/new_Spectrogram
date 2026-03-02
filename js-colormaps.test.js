const test = require('node:test');
const assert = require('node:assert');
const { qualitative } = require('./js-colormaps.js');

test('qualitative', () => {
  const colors = [
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
    [0.7, 0.8, 0.9]
  ];

  // Testing x = 0 (should map to the first color)
  assert.deepStrictEqual(qualitative(0, colors), [Math.round(0.1 * 255), Math.round(0.2 * 255), Math.round(0.3 * 255)]);

  // Testing x just below 1/3 (should map to the first color)
  assert.deepStrictEqual(qualitative(0.33, colors), [Math.round(0.1 * 255), Math.round(0.2 * 255), Math.round(0.3 * 255)]);

  // Testing x = 1/3 + epsilon (should map to the second color)
  assert.deepStrictEqual(qualitative(0.34, colors), [Math.round(0.4 * 255), Math.round(0.5 * 255), Math.round(0.6 * 255)]);

  // Testing x = 2/3 + epsilon (should map to the third color)
  assert.deepStrictEqual(qualitative(0.67, colors), [Math.round(0.7 * 255), Math.round(0.8 * 255), Math.round(0.9 * 255)]);

  // Testing x = 1 (should map to the last color)
  assert.deepStrictEqual(qualitative(1, colors), [Math.round(0.7 * 255), Math.round(0.8 * 255), Math.round(0.9 * 255)]);
});
