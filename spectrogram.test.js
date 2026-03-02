const test = require('node:test');
const assert = require('node:assert');
const { myFFT, Complex } = require('./spectrogram.js');

function assertComplexEqual(actual, expected, tolerance = 1e-9) {
    assert.ok(Math.abs(actual.re - expected.re) <= tolerance, `Expected real part ${expected.re}, but got ${actual.re}`);
    assert.ok(Math.abs(actual.im - expected.im) <= tolerance, `Expected imaginary part ${expected.im}, but got ${actual.im}`);
}

function assertFFTEqual(actual, expected, tolerance = 1e-9) {
    assert.strictEqual(actual.length, expected.length, 'FFT arrays should have the same length');
    for (let i = 0; i < actual.length; i++) {
        let act = actual[i];
        let exp = expected[i];

        if (typeof act === 'number') act = new Complex(act, 0);
        if (typeof exp === 'number') exp = new Complex(exp, 0);

        assertComplexEqual(act, exp, tolerance);
    }
}

test('myFFT: base case (length 1)', () => {
    const input = [42];
    const result = myFFT(input.slice()); // Slice to avoid modifying original
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], 42); // For length 1, it just returns the array
});

test('myFFT: DC Signal', () => {
    // A constant signal of 1s
    const input = [1, 1, 1, 1, 1, 1, 1, 1];
    const result = myFFT(input.slice());

    const expected = [
        new Complex(8, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
    ];

    assertFFTEqual(result, expected);
});

test('myFFT: Nyquist Frequency Signal', () => {
    // Alternating 1 and -1 represents the Nyquist frequency (f_s / 2)
    const input = [1, -1, 1, -1, 1, -1, 1, -1];
    const result = myFFT(input.slice());

    // Should have a single real spike at the Nyquist bin (k = 4 for N = 8)
    const expected = [
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(8, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
    ];

    assertFFTEqual(result, expected);
});

test('myFFT: Linearity', () => {
    const input1 = [1, 2, 3, 4, 1, 2, 3, 4];
    const input2 = [0, 1, 0, -1, 0, 1, 0, -1];
    const sumInput = input1.map((val, i) => val + input2[i]);

    const result1 = myFFT(input1.slice());
    const result2 = myFFT(input2.slice());
    const resultSum = myFFT(sumInput.slice());

    assert.strictEqual(resultSum.length, result1.length);
    for (let i = 0; i < resultSum.length; i++) {
        // Assert that FFT(A + B) = FFT(A) + FFT(B)
        const expectedSumRe = result1[i].re + result2[i].re;
        const expectedSumIm = result1[i].im + result2[i].im;

        assertComplexEqual(resultSum[i], new Complex(expectedSumRe, expectedSumIm));
    }
});

test('myFFT: Impulse Signal', () => {
    // An impulse signal: [1, 0, 0, 0, ...]
    const input = [1, 0, 0, 0, 0, 0, 0, 0];
    const result = myFFT(input.slice());

    // An impulse in time domain translates to equal magnitudes in all frequencies
    const expected = [
        new Complex(1, 0),
        new Complex(1, 0),
        new Complex(1, 0),
        new Complex(1, 0),
        new Complex(1, 0),
        new Complex(1, 0),
        new Complex(1, 0),
        new Complex(1, 0),
    ];

    assertFFTEqual(result, expected);
});

test('myFFT: Sine Wave', () => {
    // A simple sine wave with 2 cycles in 8 samples
    // Math.sin(2 * Math.PI * k * (2 / 8)) = Math.sin(Math.PI / 2 * k)
    // k = 0, 1, 2, 3, 4, 5, 6, 7
    // sin: 0, 1, 0, -1, 0, 1, 0, -1
    const input = [0, 1, 0, -1, 0, 1, 0, -1];
    const result = myFFT(input.slice());

    // Expect spikes at bins corresponding to frequency 2
    // With N=8, f=2, spike at k=2 and k=6 (N-f)
    // Formula for pure real sine: X_k = -i * N / 2 (at k=f) and i * N / 2 (at k=N-f)
    const expected = [
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, -4),  // -i * 8 / 2 = -4i
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 0),
        new Complex(0, 4),   // i * 8 / 2 = 4i
        new Complex(0, 0),
    ];

    assertFFTEqual(result, expected);
});
