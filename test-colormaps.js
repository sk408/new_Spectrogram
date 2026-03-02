const assert = require('assert');
const test = require('node:test');
const { interpolated, qualitative } = require('./js-colormaps.js');

test('interpolated function edge cases', async (t) => {
    await t.test('handles lower bound edge case (x = 0)', () => {
        const colors = [
            [0, 0, 0],
            [1, 1, 1]
        ];
        assert.deepStrictEqual(interpolated(0, colors), [0, 0, 0]);
    });

    await t.test('handles upper bound edge case (x = 1)', () => {
        const colors = [
            [0, 0, 0],
            [1, 1, 1]
        ];
        assert.deepStrictEqual(interpolated(1, colors), [255, 255, 255]);
    });

    await t.test('handles exact middle value (x = 0.5) with 3 colors', () => {
        const colors = [
            [0, 0, 0],       // Black
            [0.5, 0.5, 0.5], // Gray
            [1, 1, 1]        // White
        ];
        assert.deepStrictEqual(interpolated(0.5, colors), [128, 128, 128]);
    });

    await t.test('handles interpolation between two colors at x = 0.5', () => {
        const colors = [
            [0, 0, 0],       // Black
            [1, 1, 1]        // White
        ];
        assert.deepStrictEqual(interpolated(0.5, colors), [128, 128, 128]);
    });

    await t.test('handles interpolation between two distinct colors', () => {
        const colors = [
            [1, 0, 0],       // Red
            [0, 0, 1]        // Blue
        ];
        assert.deepStrictEqual(interpolated(0.5, colors), [128, 0, 128]);
    });
});

test('qualitative function edge cases', async (t) => {
    await t.test('handles qualitative evaluation for exact color (x = 0)', () => {
        const colors = [
            [0, 0, 0],       // Black
            [1, 1, 1]        // White
        ];
        assert.deepStrictEqual(qualitative(0, colors), [0, 0, 0]);
    });

    await t.test('handles qualitative evaluation for exact color (x = 1)', () => {
        const colors = [
            [0, 0, 0],       // Black
            [1, 1, 1]        // White
        ];
        assert.deepStrictEqual(qualitative(1, colors), [255, 255, 255]);
    });
});
