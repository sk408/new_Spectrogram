const { test, describe } = require('node:test');
const assert = require('node:assert');

// Mock browser globals before requiring the script
global.document = {
    querySelector: () => ({ getContext: () => ({ fillRect: () => {}, fillStyle: '' }), addEventListener: () => {} }),
    addEventListener: () => {},
    getElementById: () => ({ value: '', scrollIntoView: () => {} })
};
global.window = { addEventListener: () => {}, innerWidth: 1000, innerHeight: 1000 };
global.navigator = { mediaDevices: { enumerateDevices: () => Promise.resolve([]) } };
global.AudioContext = class {};
global.requestAnimationFrame = () => {};
global.screen = { width: 1000, height: 1000 };
global.evaluate_cmap = () => [0, 0, 0];

const { HSLToRGB } = require('./spectrogram.js');

describe('HSLToRGB', () => {
    const cases = [
        { h: 0, s: 100, l: 50, expected: [255, 0, 0], name: 'Red' },
        { h: 120, s: 100, l: 50, expected: [0, 255, 0], name: 'Green' },
        { h: 240, s: 100, l: 50, expected: [0, 0, 255], name: 'Blue' },
        { h: 0, s: 0, l: 100, expected: [255, 255, 255], name: 'White' },
        { h: 0, s: 0, l: 0, expected: [0, 0, 0], name: 'Black' },
        { h: 0, s: 0, l: 50, expected: [127.5, 127.5, 127.5], name: 'Gray' },
        { h: 60, s: 100, l: 50, expected: [255, 255, 0], name: 'Yellow' },
        { h: 180, s: 100, l: 50, expected: [0, 255, 255], name: 'Cyan' },
        { h: 300, s: 100, l: 50, expected: [255, 0, 255], name: 'Magenta' },
        { h: 360, s: 100, l: 50, expected: [255, 0, 0], name: 'Red (360 degrees)' },
    ];

    cases.forEach(({ h, s, l, expected, name }) => {
        test(`should convert HSL(${h}, ${s}%, ${l}%) to RGB accurately (${name})`, () => {
            const actual = HSLToRGB(h, s, l);
            assert.deepStrictEqual(actual.map(v => Math.round(v * 100) / 100), expected.map(v => Math.round(v * 100) / 100));
        });
    });

    test('should handle intermediate values correctly', () => {
        const actual = HSLToRGB(30, 50, 50);
        assert.ok(Math.abs(actual[0] - 191.25) < 0.001, `Expected R around 191.25, got ${actual[0]}`);
    });
});
