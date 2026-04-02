const assert = require('node:assert');
const test = require('node:test');
const fs = require('fs');
const vm = require('vm');

test('evaluate_cmap parameter validation', async (t) => {
    const code = fs.readFileSync('js-colormaps.js', 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    const evaluate_cmap = sandbox.evaluate_cmap;

    // Test valid input. deepEqual is needed because array might come from another realm
    assert.deepEqual(evaluate_cmap(0, 'viridis', false), [68, 1, 84]);
    assert.deepEqual(evaluate_cmap(0.5, 'viridis', false), [33, 144, 141]);
    assert.deepEqual(evaluate_cmap(1, 'viridis', false), [253, 231, 37]);

    // Test reverse valid input
    assert.deepEqual(evaluate_cmap(1, 'viridis', true), [68, 1, 84]);

    // Test out of bounds
    assert.throws(() => evaluate_cmap(-0.1, 'viridis', false), /Illegal value for x/);
    assert.throws(() => evaluate_cmap(1.1, 'viridis', false), /Illegal value for x/);

    // Test invalid type
    assert.throws(() => evaluate_cmap('0.5', 'viridis', false), /Illegal value for x/);
    assert.throws(() => evaluate_cmap(NaN, 'viridis', false), /Illegal value for x/);

    // Test invalid colormap
    assert.throws(() => evaluate_cmap(0.5, 'nonexistent', false), /Colormap nonexistent does not exist/);

    // Test prototype pollution attempt
    assert.throws(() => evaluate_cmap(0.5, '__proto__', false), /Colormap __proto__ does not exist/);
});
