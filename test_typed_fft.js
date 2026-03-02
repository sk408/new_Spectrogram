function Complex(re, im) {
    this.re = re;
    this.im = im || 0.0;
}

function myFFT(signal) {
    if (signal.length == 1)
        return signal;
    var halfLength = signal.length / 2;
    // For typed arrays, we need them to hold complex numbers possibly?
    // Let's see how myFFT is implemented.
    // It says:
    // even[i] = signal[i * 2];
    // odd[i] = signal[i * 2 + 1];
    // even.length = halfLength; odd.length = halfLength;
    // then it replaces signal[k] with a Complex.
    // IF signal is a Float32Array, it can't hold Complex objects!
    // That means `my_x` inside `myFFT` MUST be a regular Array to store objects, or we have to modify `myFFT`.

    // BUT we can use Float32Array BEFORE `myFFT`, and convert to regular Array right before `myFFT`.
    // Wait, the prompt says "Code should operate directly on the TypedArray."
    // Let's rewrite myFFT to work with Float32Array instead of Complex objects? Or we can check if it works.
}
