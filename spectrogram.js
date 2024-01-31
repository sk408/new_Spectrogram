const canvas = document.querySelector('.canvas');
const canvasCtx = canvas.getContext("2d", { willReadFrequently: true });
const mainSection = document.querySelector('.main-controls');
var border_canvas_plot_left;

var border_canvas_plot_right;
var border_canvas_plot_bottom;
var border_canvas_plot_top;

applyOrientation();

var imageSpectrogram = new Array(40).fill(0);
var counter = 0;
var stop_sound = 0;

var max_intensity;
var sensibility;
var sensibility_temp;

let animationId;

let audioCtx;
let debounce;
const createAudioGraphDebounced = () => {
    if (!this.audioCtx) {
        this.audioCtx = new AudioContext({
            latencyHint: 'interactive',
            sampleRate: 44100,
        });
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => document.getElementById("stop").checked = !document.getElementById("stop").checked, 100);
};

let time = 0;

const handleGesture = (event) => {
    const elapsedTime = new Date().getTime() - time;
    if (elapsedTime > 250 && elapsedTime > 250) {
        createAudioGraphDebounced();
    }
};
function onKeyDown(e) {
    if (e.key === " ")
        createAudioGraphDebounced();
}

canvas.addEventListener('mousedown', function (event) {
    createAudioGraphDebounced();
});
window.addEventListener("keydown", onKeyDown);
canvas.addEventListener('touchstart', (event) => {

    time = new Date().getTime();
});
canvas.addEventListener('touchend', handleGesture);


if (!navigator.mediaDevices?.enumerateDevices) {
    console.log("enumerateDevices() not supported.");
} else {

    navigator.mediaDevices.enumerateDevices()
        .then(devices => {
            this.mics = devices.filter(device => device.kind === 'audioinput');


            const microphoneSelect = document.getElementById('microphone');
            this.mics.forEach((mic, index) => {
                const option = document.createElement('option');
                option.value = mic.deviceId;
                option.text = mic.label || `Microphone ${index + 1}`;
                microphoneSelect.appendChild(option);
            });


            this.selectAndStartMic(this.mics[0]?.deviceId);
        })
        .catch(err => console.log(err));

}
let currentStream;

function stopCurrentStream() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }
}

function stopCurrentAnimation() {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
}

function onSuccess(stream) {
    currentStream = stream;
    callback(stream);
}

function onError(err) {
    console.log('The following error occured: ' + err);
}

function selectAndStartMic(selected) {
    if (navigator.mediaDevices.getUserMedia) {
        console.log('getUserMedia supported.');

        stopCurrentStream();
        stopCurrentAnimation();

        const constraints = { audio: { deviceId: selected ? { exact: selected } : undefined } };
        navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
    } else {
        console.log('getUserMedia not supported on your browser!');
    }
}
var bufferLength;
var dataTime;
var dataFrec;
var fftSize = parseInt(document.getElementById("sizeFFT").value);

var colormap;
var frec_max1;
var bin_width = 4;
var my_x;
var my_X_abs;
var startTime, endTime;
var f_Nyquist;
var f_min;
var f_max;
var i_min;
var i_max;
var num_bin = Math.floor((900 - border_canvas_plot_left - border_canvas_plot_right) / bin_width);
var analyser;

function lpc(signal, order = 8) {
    let autocorr = (function autoCorrelate(buf) {
        let new_buf = [];
        let n = buf.length;
        let r = [];

        for (let lag = 0; lag < n; lag++) {
            let sum = 0;
            for (let i = 0; i < n - lag; i++) {
                sum += buf[i] * buf[i + lag];
            }
            r[lag] = sum / n;
        }
        return r;
    })(signal);

    let R = autocorr.slice(0, order + 1);
    let a = Array(order + 1).fill(0);
    let e = Array(order + 1).fill(0);

    a[0] = 1.0;
    e[0] = R[0];

    for (let k = 1; k <= order; k++) {
        let lambda = 0;
        for (let j = 0; j < k; j++) {
            lambda -= a[j] * R[k - j];
        }
        lambda /= e[k - 1];

        let U = a.slice(0, k);
        let V = U.slice().reverse().map(x => x * lambda);

        a = [...U, lambda, ...V];

        e[k] = (1 - lambda * lambda) * e[k - 1];
    }

    return a;
}

function evaluatePolynomial(coeffs, x) {
    return coeffs.reduce((acc, curr, i) => acc.add(curr.mul(x.pow(coeffs.length - 1 - i))), new Complex(0, 0));
}

function durandKerner(coeffs, tolerance = 1e-7, maxIterations = 100) {
    const n = coeffs.length - 1; // Degree of the polynomial
    let roots = new Array(n);

    // Initial guess for roots
    for (let i = 0; i < n; i++) {
        roots[i] = new Complex(0.4 + 0.9 * i, 0.9); // Example initial guess
    }

    let iter = 0;
    let maxDiff;

    do {
        maxDiff = 0;
        const newRoots = roots.slice();

        for (let i = 0; i < n; i++) {
            let prod = new Complex(1, 0);
            for (let j = 0; j < n; j++) {
                if (i !== j) {
                    prod = prod.mul(roots[i].sub(roots[j]));
                }
            }
            newRoots[i] = roots[i].sub(evaluatePolynomial(coeffs, roots[i]).div(prod));

            // Calculate the maximum difference to check for convergence
            const diff = newRoots[i].sub(roots[i]).abs();
            if (diff > maxDiff) {
                maxDiff = diff;
            }
        }

        roots = newRoots;
        iter++;
    } while (maxDiff > tolerance && iter < maxIterations);

    return roots;
}

function getFormants(signal, sr) {
    let emphasizedSignal = signal.map((val, index) => index === 0 ? val : val - 0.97 * signal[index - 1]);
    let windowedSignal = emphasizedSignal.map((val, index) => val * (0.54 - 0.46 * Math.cos(2 * Math.PI * index / (emphasizedSignal.length - 1))));

    let lpcCoeffs = lpc(windowedSignal, 8).map(coeff => new Complex(coeff, 0));
    let roots = durandKerner(lpcCoeffs).filter(root => root.im >= 0);

    let angz = roots.map(root => Math.atan2(root.im, root.re));
    let frqs = angz.map(ang => ang * (sr / (2 * Math.PI)));

    frqs.sort((a, b) => a - b);
    return frqs.slice(0, 3);
}
function callback(stream) {
    if (!audioCtx) {
        audioCtx = new AudioContext({
            latencyHint: 'interactive',
            sampleRate: 44100,
        });

    }

    const source = audioCtx.createMediaStreamSource(stream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.minDecibels = -40;

    bufferLength = analyser.frequencyBinCount;

    let scriptNode = audioCtx.createScriptProcessor(16384, 1, 1);

    // Create a buffer to hold the audio data

    // Set up the onaudioprocess event handler
    scriptNode.onaudioprocess = function (audioProcessingEvent) {
        // Get the input buffer
        let inputBuffer = audioProcessingEvent.inputBuffer;
        console.log("test");
        // Loop through the input channels (in this case, just one)
        for (let channel = 0; channel < inputBuffer.numberOfChannels; channel++) {
            let inputData = inputBuffer.getChannelData(channel);

            let formants = getFormants(Array.from(inputData), audioCtx.sampleRate);
            console.log("Detected formants:", formants);
        }
    };

    const sr = audioCtx.sampleRate;

    source.connect(analyser);
    source.connect(scriptNode);

    scriptNode.connect(audioCtx.destination);

    Plot();
}

let lastUpdateTime = 0;
const updateInterval = 1250; // 1/4 second in milliseconds
var persist;


function Plot() {
    const currentTime = Date.now();
    // analyser.fftSize = fftSize;
    bufferLength = analyser.frequencyBinCount;
    dataTime = new Uint8Array(bufferLength * 2);
    dataFrec = new Float32Array(bufferLength);
    YaxisMarks();

    colormap = document.getElementById("colormap").value;
    f_min = parseFloat(document.getElementById("f_min").value);
    f_max = parseFloat(document.getElementById("f_max").value);

    bin_width = parseInt(document.getElementById("speed").value);
    // startTime = performance.now();

    analyser.getByteTimeDomainData(dataTime);
    analyser.getFloatFrequencyData(dataFrec);

    counter += 1;

    my_x = [...dataTime];

    var mean = 0;
    for (var i = 0; i < my_x.length; i++) {
        mean = mean + my_x[i];
    }
    mean = mean / my_x.length
    var window = document.getElementById("window").value;
    let BH7 = new Array(7).fill(0);
    BH7[0] = 0.27105140069342;
    BH7[1] = -0.43329793923448;
    BH7[2] = 0.21812299954311;
    BH7[3] = -0.06592544638803;
    BH7[4] = 0.01081174209837;
    BH7[5] = -0.00077658482522;
    BH7[6] = 0.00001388721735;
    for (var i = 0; i < my_x.length; i++) {

        if (window == "None") {
            my_x[i] = (my_x[i] - mean);
        } else if (window == "Cosine") {
            my_x[i] = (my_x[i] - mean) * Math.sin(Math.PI * i / my_x.length);
        } else if (window == "Hanning") {
            my_x[i] = (my_x[i] - mean) * 0.5 * (1 - Math.cos(2 * Math.PI * i / my_x.length));;

        } else if (window == "BH7") {

            let w = 0;
            for (let j = 0; j < 7; j++) {
                w += BH7[j] * Math.cos(2 * Math.PI * j * i / my_x.length);
            }
            my_x[i] = (my_x[i] - mean) * w;
        }
    }

    PlotMic();
    my_X_abs = new Float64Array(my_x.length / 2).fill(0);

    if (document.getElementById("FFT").value == "myFFT") {
        fft = myFFT(my_x);

        max_intensity = -100;
        for (var i = 1; i < my_x.length / 2; i += 1) {

            my_X_abs[i] = 10 * Math.log10((fft[i].re * fft[i].re + fft[i].im * fft[i].im)) - 20;
            if (my_X_abs[i] > max_intensity) max_intensity = my_X_abs[i];
        }

    } else if (document.getElementById("FFT").value == "WebAudio") {
        const aa = document.getElementById('window')
        aa.value = "None";
        var my_frec = [...dataFrec];
        for (var i = 1; i < my_x.length / 2; i += 1) {
            my_frec[i] = my_frec[i] + 125;
            if (my_frec[i] > max_intensity) max_intensity = my_frec[i];

        }
        my_X_abs = my_frec;
    }
    i_min = Math.floor(my_X_abs.length * f_min / f_Nyquist);
    i_max = Math.floor(my_X_abs.length * f_max / f_Nyquist);


    var ts = new Array(my_x.length / 2).fill(0);
    var frec1 = new Array(my_x.length / 2).fill(0);
    var frec2 = new Array(my_x.length).fill(0);
    const max_frec1 = Math.max(...my_X_abs);
    const index_frec1 = my_X_abs.indexOf(max_frec1);
    frec_max1 = index_frec1 / my_X_abs.length * audioCtx.sampleRate / 2;

    canvasCtx.fillStyle = 'lightblue';
    canvasCtx.fillRect(border_canvas_plot_top, border_canvas_plot_top, canvas.width / 10 + border_canvas_plot_left - 2 * border_canvas_plot_top, canvas.height / 10 - border_canvas_plot_top);
    canvasCtx.fillStyle = 'black';
    canvasCtx.font = getFont(25);

    var centro = (border_canvas_plot_top + canvas.height / 10) / 2;

    canvasCtx.textAlign = 'right';

    if (currentTime - lastUpdateTime > updateInterval) {
        // Update the text here
        // canvasCtx.textAlign = 'right';
        persist = Math.round(calculateFundamentalFrequencyHPS(my_X_abs, 44100)).toString();
        canvasCtx.fillText(persist + " Hz", canvas.width / 8, centro);

        // Update the last update time
        lastUpdateTime = currentTime;
    }
    else {
        canvasCtx.fillText(persist + " Hz", canvas.width / 8, centro);
    }


    canvasCtx.fillStyle = "black";

    PlotFFT();
    PlotSpectro1();

    animationId = requestAnimationFrame(Plot);
}
function calculateFundamentalFrequencyHPS(my_X_abs, sampleRate) {
    // Convert spectrum to magnitude (if it's not already)
    let spectrum = my_X_abs.map(x => Math.abs(x));

    // Number of downsampling steps (harmonics to consider)
    const steps = 5;
    let resultSpectrum = spectrum.slice();

    // Downsample and multiply
    for (let step = 2; step <= steps; step++) {
        const downsampled = downsample(spectrum, step);
        for (let i = 0; i < downsampled.length; i++) {
            resultSpectrum[i] *= downsampled[i];
        }
    }

    // Find the index of the maximum value in the result spectrum
    const maxIndex = resultSpectrum.indexOf(Math.max(...resultSpectrum));

    // Calculate the fundamental frequency
    const fundamentalFrequency = maxIndex * sampleRate / my_X_abs.length;
    return fundamentalFrequency;
}

function downsample(array, factor) {
    return array.filter((element, index) => index % factor === 0);
}

function splitSignal(signal) {
    var halfLength = signal.length / 2;
    var even = [];
    var odd = [];
    even.length = halfLength;
    odd.length = halfLength;
    for (var i = 0; i < halfLength; ++i) {
        even[i] = signal[i * 2];
        odd[i] = signal[i * 2 + 1];
    }
    return { even, odd };
}

function ensureComplex(array) {
    for (var k = 0; k < array.length; ++k) {
        if (!(array[k] instanceof Complex2))
            array[k] = new Complex2(array[k], 0);
    }
    return array;
}

function calculateFFT(even, odd, signal) {
    var halfLength = signal.length / 2;
    for (var k = 0; k < halfLength; ++k) {
        var a = Math.cos(2 * Math.PI * k / signal.length);
        var b = Math.sin(-2 * Math.PI * k / signal.length);
        var temp_k_real = odd[k].re * a - odd[k].im * b;
        var temp_k_imag = odd[k].re * b + odd[k].im * a;
        var A_k = new Complex2(even[k].re + temp_k_real, even[k].im + temp_k_imag);
        var B_k = new Complex2(even[k].re - temp_k_real, even[k].im - temp_k_imag);
        signal[k] = A_k;
        signal[k + halfLength] = B_k;
    }
    return signal;
}

function myFFT(signal) {
    if (signal.length == 1)
        return signal;
    var { even, odd } = splitSignal(signal);
    even = myFFT(even);
    odd = myFFT(odd);
    even = ensureComplex(even);
    odd = ensureComplex(odd);
    return calculateFFT(even, odd, signal);
}

function Complex2(re, im) {
    this.re = re;
    this.im = im || 0.0;
}
const HSLToRGB = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [255 * f(0), 255 * f(8), 255 * f(4)];
};

function getCanvasCoordinates2() {
    let x = canvas.width / 10 + border_canvas_plot_left;
    let centro = (canvas.height / 10 + border_canvas_plot_top) / 2;
    let scale_v = canvas.height / 760;

    return { x, centro, scale_v };
}

function drawMicLine(i, x, centro, scale_v, atenuacion) {
    let y = my_x[i] * atenuacion + centro;
    if (i == 0) {
        canvasCtx.moveTo(x, centro);
    } else {
        y = centro + (y - centro) * scale_v;
        if (y > canvas.height / 10 + border_canvas_plot_top - 1) {
            y = canvas.height / 10 + border_canvas_plot_top - 1;
        }
        canvasCtx.lineTo(x, y);
    }
    x += (.9 * canvas.width - border_canvas_plot_left - border_canvas_plot_right) / my_x.length;
    return x;
}

function PlotMic() {
    let atenuacion = .4;
    f_Nyquist = audioCtx.sampleRate / 2;
    canvasCtx.lineWidth = 1;
    canvasCtx.fillStyle = '#003B5C';
    canvasCtx.fillRect(canvas.width / 10 + border_canvas_plot_left, 0, .9 * canvas.width - border_canvas_plot_right - border_canvas_plot_left, canvas.height / 10 + border_canvas_plot_top);
    canvasCtx.beginPath();
    canvasCtx.strokeStyle = 'white';

    let { x, centro, scale_v } = getCanvasCoordinates2();

    for (let i = 0; i < my_x.length; i++) {
        x = drawMicLine(i, x, centro, scale_v, atenuacion);
    }
    canvasCtx.stroke();
}
function calculateY(i, Y0, deltaY0, i_min, i_max, f_min, f_max, scale) {
    let y;
    if (scale == "Linear") {
        y = Y0 + deltaY0 - deltaY0 * (i - i_min) / (i_max - i_min);
    } else if (scale == "Mel") {
        let freq2 = f_min + (f_max - f_min) * (i - i_min) / (i_max - i_min);
        let mel_i = 1127.01048 * Math.log(freq2 / 700 + 1);
        let mel_i_min = 1127.01048 * Math.log(f_min / 700 + 1);
        let mel_i_max = 1127.01048 * Math.log(f_max / 700 + 1);
        y = Y0 + deltaY0 - deltaY0 * (mel_i - mel_i_min) / (mel_i_max - mel_i_min);
    }
    return y;
}

function drawLine2(i, y, my_X_abs, scale_h, canvasCtx) {
    let x = -my_X_abs[i] * scale_h + .9 * canvas.width / 10;
    let value = my_X_abs[i] / (sensibility);
    canvasCtx.strokeStyle = 'hsl(' + 360 * (1 - value) + ',100%,50%)';
    canvasCtx.beginPath();
    canvasCtx.moveTo(.9 * canvas.width / 10, y);
    if (my_X_abs[i] > 0) canvasCtx.lineTo(x, y);
    canvasCtx.stroke();
}

function PlotFFT() {
    var scale_h = canvas.width / 1440;
    canvasCtx.lineWidth = 1;
    canvasCtx.strokeStyle = 'hsl(' + 360 * 0 + ',100%,50%)';
    canvasCtx.fillStyle = '#003B5C';
    canvasCtx.fillRect(0, canvas.height / 10 + border_canvas_plot_top, .9 * canvas.width / 10, .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top);

    let Y0 = canvas.height / 10 + border_canvas_plot_top;
    let deltaY0 = .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top;
    let deltaY = (canvas.height - canvas.height / 10 - border_canvas_plot_top - border_canvas_plot_bottom) / (i_max - i_min);
    let scale = document.getElementById("scale").value;

    for (let i = i_min; i < i_max; i++) {
        let y = calculateY(i, Y0, deltaY0, i_min, i_max, f_min, f_max, scale);
        drawLine2(i, y, my_X_abs, scale_h, canvasCtx);
    }

    let y = canvas.height - border_canvas_plot_bottom;
    canvasCtx.beginPath();
    canvasCtx.strokeStyle = 'white';
    sensibility = document.getElementById("sensibility").value;;

    for (let i = i_min; i < i_max; i++) {
        y = calculateY(i, Y0, deltaY0, i_min, i_max, f_min, f_max, scale);
        let x = -my_X_abs[i] * scale_h + .9 * canvas.width / 10;
        if (i === i_min) {
            canvasCtx.moveTo(.9 * canvas.width / 10, y);
        } else {
            if (my_X_abs[i] > 0) canvasCtx.lineTo(x, y);
        }
        y -= deltaY;
    }
    canvasCtx.stroke();

    if (max_intensity > sensibility) {
        sensibility_temp = max_intensity;
        ColormapMarks();
    } else {
        sensibility_temp = sensibility;
    }
    ColormapMarks();
    document.getElementById("output_sensibility").innerHTML = Math.floor(sensibility_temp);
    document.getElementById("sensibility").value = Math.floor(sensibility_temp);

    canvasCtx.moveTo(-sensibility_temp * scale_h + .9 * canvas.width / 10, Y0);
    canvasCtx.lineTo(-sensibility_temp * scale_h + .9 * canvas.width / 10, Y0 + deltaY0);
    canvasCtx.stroke();
}
function calculateYPosition(scale, i, Y0, deltaY0, f_min, f_max, mel_i_min, mel_i_max) {
    if (scale === "Linear") {
        return Y0 + deltaY0 - deltaY0 * (i - i_min) / (i_max - i_min);
    } else if (scale === "Mel") {
        const freq = f_min + (f_max - f_min) * (i - i_min) / (i_max - i_min);
        const mel_i = 1127.01048 * Math.log(freq / 700 + 1);
        return Y0 + deltaY0 - deltaY0 * (mel_i - mel_i_min) / (mel_i_max - mel_i_min);
    }
}

function drawLine(scrolling, X0, deltaX0, y, bin_width) {
    canvasCtx.beginPath();
    if (scrolling) {
        canvasCtx.moveTo(X0 + deltaX0, y);
        canvasCtx.lineTo(X0 + deltaX0 - bin_width, y);
    } else {
        canvasCtx.moveTo(X0, y);
        canvasCtx.lineTo(X0 + bin_width, y);
    }
    canvasCtx.stroke();
}

function getCanvasCoordinates() {
    let X0 = Math.floor(canvas.width / 10 + border_canvas_plot_left);
    let deltaX0 = Math.floor(.9 * canvas.width - border_canvas_plot_left - border_canvas_plot_right - bin_width);
    let Y0 = canvas.height / 10 + border_canvas_plot_top;
    var deltaY0 = .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top;

    return { X0, deltaX0, Y0, deltaY0 };
}

function getCanvasSettings() {
    const scale = document.getElementById("scale").value;
    const scrolling = document.getElementById("scrolling").checked;
    const stop = document.getElementById("stop").checked;

    return { scale, scrolling, stop };
}

function shiftImageData({ X0, deltaX0, Y0, deltaY0 }, { scrolling, stop }) {
    if (!stop) {
        const imgData = canvasCtx.getImageData(X0 + (scrolling ? bin_width : 1), Y0, deltaX0 - bin_width - (scrolling ? 0 : 1), deltaY0);
        canvasCtx.putImageData(imgData, X0 + (scrolling ? 0 : bin_width), Y0);
    }
}

function drawSpectrogramLines({ X0, Y0, deltaY0, deltaX0 }, { scale, scrolling }, mel_i_min, mel_i_max) {
    for (let i = i_min; i < i_max; i++) {
        const y = calculateYPosition(scale, i, Y0, deltaY0, f_min, f_max, mel_i_min, mel_i_max);
        const value = Math.min(my_X_abs[i] / sensibility, 1);
        const myrgb = evaluate_cmap(value, colormap, false);
        canvasCtx.strokeStyle = 'rgb(' + myrgb + ')';
        drawLine(scrolling, X0, deltaX0, y, bin_width);
    }
}

function PlotSpectro1() {
    fftSize = parseInt(document.getElementById("sizeFFT").value);
    canvasCtx.lineWidth = 1;
    canvasCtx.fillStyle = 'white';

    const { X0, deltaX0, Y0, deltaY0 } = getCanvasCoordinates();
    const { scale, scrolling, stop } = getCanvasSettings();

    shiftImageData({ X0, deltaX0, Y0, deltaY0 }, { scrolling, stop });

    const mel_i_min = 1127.01048 * Math.log(f_min / 700 + 1);
    const mel_i_max = 1127.01048 * Math.log(f_max / 700 + 1);

    drawSpectrogramLines({ X0, Y0, deltaY0, deltaX0 }, { scale, scrolling }, mel_i_min, mel_i_max);
    canvasCtx.font = getFont(10);
}

function drawYAxisBackground() {
    canvasCtx.fillStyle = 'white';
    let X0 = canvas.width / 10 + border_canvas_plot_left;
    let Y0 = canvas.height / 10 + border_canvas_plot_top;
    var deltaY0 = .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top;

    canvasCtx.fillRect(.9 * canvas.width / 10, Y0 - border_canvas_plot_top, .1 * canvas.width / 10 + border_canvas_plot_left, Y0 + deltaY0);
    canvasCtx.fillStyle = "black";
    canvasCtx.font = getFont(10);
    canvasCtx.textAlign = 'right';

    return { X0, Y0, deltaY0 };
}

function drawYAxisMarks(Yaxis, X0, Y0, deltaY0, calculateY) {
    for (var j = 0; j < Yaxis.length; j++) {
        var y = calculateY(Yaxis[j], Y0, deltaY0);
        if (Yaxis[j] <= f_max) {
            canvasCtx.textBaseline = "middle";
            canvasCtx.fillText(Yaxis[j].toString() + " Hz", X0 - border_canvas_plot_top, y);
        }
        canvasCtx.strokeStyle = "black";
        canvasCtx.beginPath();
        if (Yaxis[j] <= f_max) {
            canvasCtx.moveTo(X0, y);
            canvasCtx.lineTo(X0 - 4, y);
            canvasCtx.moveTo(.9 * canvas.width / 10, y);
            canvasCtx.lineTo(.9 * canvas.width / 10 + 4, y);
        }
        canvasCtx.stroke();
    }
}

function YaxisMarks() {
    const { X0, Y0, deltaY0 } = drawYAxisBackground();

    if (document.getElementById("scale").value == "Linear") {
        var Yaxis = [100, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000];
        drawYAxisMarks(Yaxis, X0, Y0, deltaY0, (value, Y0, deltaY0) => Y0 + deltaY0 - deltaY0 * (value - f_min) / (f_max - f_min));
    } else if (document.getElementById("scale").value == "Mel") {
        var Yaxis = [100, 200, 400, 600, 800, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 13000, 15000, 17000, 20000];
        drawYAxisMarks(Yaxis, X0, Y0, deltaY0, (value, Y0, deltaY0) => {
            var mel_i = 1127.01048 * Math.log(value / 700 + 1)
            var mel_i_min = 1127.01048 * Math.log(f_min / 700 + 1)
            var mel_i_max = 1127.01048 * Math.log(f_max / 700 + 1)
            return Y0 + deltaY0 - deltaY0 * (mel_i - mel_i_min) / (mel_i_max - mel_i_min);
        });
    }
}

window.onresize = function (event) {
    applyOrientation();
}

function applyOrientation() {
    if (window.innerHeight > window.innerWidth) {

        canvas.width = window.innerWidth;
        canvas.height = canvas.width * 400 / 700;

    } else {

        canvas.width = window.innerWidth;
        canvas.height = (window.innerHeight);

    }
    border_canvas_plot_left = canvas.width / 20;
    border_canvas_plot_right = canvas.width / 10;

    var scale_v = canvas.height / 760;
    border_canvas_plot_bottom = 80 * scale_v;
    border_canvas_plot_top = 10 * scale_v;
    plot_colormap();

}

function plot_colormap() {
    colormap = document.getElementById("colormap").value;
    let Y0 = Math.floor(canvas.height / 10 + border_canvas_plot_top);
    var deltaY0 = Math.floor(.9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top);

    for (let y = Y0; y <= Y0 + deltaY0; y++) {
        var myrgb = evaluate_cmap(1 - (y - Y0) / deltaY0, colormap, false);
        canvasCtx.fillStyle = 'rgb(' + myrgb + ')';
        let x0 = Math.floor(.9 * canvas.width + border_canvas_plot_top);
        canvasCtx.fillRect(x0, y, canvas.width / 30, 1);
    }
}

function SetDefaultWindow() {
    if (document.getElementById("FFT").value == "WebAudio") {
        const aa = document.getElementById('window')
        aa.value = "None";

    } else if (document.getElementById("FFT").value == "myFFT") {
        const aa = document.getElementById('window')
        aa.value = "BH7";
    }
}

function ColormapMarks() {
    canvasCtx.fillStyle = "white";
    let x0 = .95 * canvas.width;
    let Y0 = canvas.height / 10 + border_canvas_plot_top;
    var deltaY0 = .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top;
    canvasCtx.fillRect(x0, 0, canvas.width - x0, Y0 + deltaY0 + 10);
    canvasCtx.fillRect(0, canvas.height - .8 * border_canvas_plot_bottom, canvas.width, .8 * border_canvas_plot_bottom + 10);


    canvasCtx.fillStyle = "black";
    canvasCtx.font = getFont(20);

    canvasCtx.textBaseline = "middle";
    var dB = Math.max(sensibility_temp, max_intensity);
    canvasCtx.textAlign = 'left';
    canvasCtx.fillText(Math.floor(dB) + " dB", x0, Y0)
    canvasCtx.fillText(Math.floor(.75 * dB) + " dB", x0, Y0 + .25 * deltaY0)
    canvasCtx.fillText(Math.floor(.5 * dB) + " dB", x0, Y0 + .5 * deltaY0)
    canvasCtx.fillText(Math.floor(.25 * dB) + " dB", x0, Y0 + .75 * deltaY0)
    canvasCtx.fillText(0 + " dB", x0, Y0 + deltaY0)


    canvasCtx.textAlign = 'left';
    canvasCtx.fillText("Time", canvas.width / 2, canvas.height - .5 * border_canvas_plot_bottom);
    canvasCtx.fillText("Loudness (dB)", 10, canvas.height - .5 * border_canvas_plot_bottom);
    canvasCtx.fillText("Color", canvas.width - border_canvas_plot_right, canvas.height - .5 * border_canvas_plot_bottom);


}

function getFont(s) {
    var fontBase = 1000;
    var ratio = s / fontBase;
    var size = canvas.width * ratio;
    return (size | 0) + 'px sans-serif';
}


// const canvas=document.querySelector(".canvas"),canvasCtx=canvas.getContext("2d",{willReadFrequently:!0}),mainSection=document.querySelector(".main-controls");var border_canvas_plot_left,border_canvas_plot_right,border_canvas_plot_bottom,border_canvas_plot_top;applyOrientation();var max_intensity,sensibility,sensibility_temp,imageSpectrogram=new Array(40).fill(0),counter=0,stop_sound=0;let animationId,audioCtx,debounce;const createAudioGraphDebounced=()=>{this.audioCtx||(this.audioCtx=new AudioContext({latencyHint:"interactive",sampleRate:44100})),clearTimeout(debounce),debounce=setTimeout((()=>document.getElementById("stop").checked=!document.getElementById("stop").checked),100)};let time=0;const handleGesture=t=>{const e=(new Date).getTime()-time;e>250&&e>250&&createAudioGraphDebounced()};function onKeyDown(t){" "===t.key&&createAudioGraphDebounced()}let currentStream;function stopCurrentStream(){currentStream&&currentStream.getTracks().forEach((t=>t.stop()))}function stopCurrentAnimation(){animationId&&cancelAnimationFrame(animationId)}function onSuccess(t){currentStream=t,callback(t)}function onError(t){console.log("The following error occured: "+t)}function selectAndStartMic(t){if(navigator.mediaDevices.getUserMedia){console.log("getUserMedia supported."),stopCurrentStream(),stopCurrentAnimation();const e={audio:{deviceId:t?{exact:t}:void 0}};navigator.mediaDevices.getUserMedia(e).then(onSuccess,onError)}else console.log("getUserMedia not supported on your browser!")}var bufferLength,dataTime,dataFrec;canvas.addEventListener("mousedown",(function(t){createAudioGraphDebounced()})),window.addEventListener("keydown",onKeyDown),canvas.addEventListener("touchstart",(t=>{time=(new Date).getTime()})),canvas.addEventListener("touchend",handleGesture),navigator.mediaDevices?.enumerateDevices?navigator.mediaDevices.enumerateDevices().then((t=>{this.mics=t.filter((t=>"audioinput"===t.kind));const e=document.getElementById("microphone");this.mics.forEach(((t,a)=>{const n=document.createElement("option");n.value=t.deviceId,n.text=t.label||`Microphone ${a+1}`,e.appendChild(n)})),this.selectAndStartMic(this.mics[0]?.deviceId)})).catch((t=>console.log(t))):console.log("enumerateDevices() not supported.");var colormap,frec_max1,my_x,my_X_abs,startTime,endTime,f_Nyquist,f_min,f_max,i_min,i_max,analyser,fftSize=parseInt(document.getElementById("sizeFFT").value),bin_width=4,num_bin=Math.floor((900-border_canvas_plot_left-border_canvas_plot_right)/bin_width);function callback(t){audioCtx||(audioCtx=new AudioContext({latencyHint:"interactive",sampleRate:44100}));const e=audioCtx.createMediaStreamSource(t);(analyser=audioCtx.createAnalyser()).fftSize=fftSize,analyser.minDecibels=-40,bufferLength=analyser.frequencyBinCount;audioCtx.sampleRate;e.connect(analyser),Plot()}function Plot(){bufferLength=analyser.frequencyBinCount,dataTime=new Uint8Array(2*bufferLength),dataFrec=new Float32Array(bufferLength),YaxisMarks(),colormap=document.getElementById("colormap").value,f_min=parseFloat(document.getElementById("f_min").value),f_max=parseFloat(document.getElementById("f_max").value),bin_width=parseInt(document.getElementById("speed").value),analyser.getByteTimeDomainData(dataTime),analyser.getFloatFrequencyData(dataFrec),counter+=1,my_x=[...dataTime];for(var t=0,e=0;e<my_x.length;e++)t+=my_x[e];t/=my_x.length;var a=document.getElementById("window").value;let n=new Array(7).fill(0);n[0]=.27105140069342,n[1]=-.43329793923448,n[2]=.21812299954311,n[3]=-.06592544638803,n[4]=.01081174209837,n[5]=-.00077658482522,n[6]=1388721735e-14;for(e=0;e<my_x.length;e++)if("None"==a)my_x[e]=my_x[e]-t;else if("Cosine"==a)my_x[e]=(my_x[e]-t)*Math.sin(Math.PI*e/my_x.length);else if("Hanning"==a)my_x[e]=.5*(my_x[e]-t)*(1-Math.cos(2*Math.PI*e/my_x.length));else if("BH7"==a){let a=0;for(let t=0;t<7;t++)a+=n[t]*Math.cos(2*Math.PI*t*e/my_x.length);my_x[e]=(my_x[e]-t)*a}if(PlotMic(),my_X_abs=new Float64Array(my_x.length/2).fill(0),"myFFT"==document.getElementById("FFT").value){fft=myFFT(my_x),max_intensity=-100;for(e=1;e<my_x.length/2;e+=1)my_X_abs[e]=10*Math.log10(fft[e].re*fft[e].re+fft[e].im*fft[e].im)-20,my_X_abs[e]>max_intensity&&(max_intensity=my_X_abs[e])}else if("WebAudio"==document.getElementById("FFT").value){document.getElementById("window").value="None";var o=[...dataFrec];for(e=1;e<my_x.length/2;e+=1)o[e]=o[e]+125,o[e]>max_intensity&&(max_intensity=o[e]);my_X_abs=o}i_min=Math.floor(my_X_abs.length*f_min/f_Nyquist),i_max=Math.floor(my_X_abs.length*f_max/f_Nyquist);new Array(my_x.length/2).fill(0),new Array(my_x.length/2).fill(0),new Array(my_x.length).fill(0);const i=Math.max(...my_X_abs),l=my_X_abs.indexOf(i);frec_max1=l/my_X_abs.length*audioCtx.sampleRate/2,canvasCtx.fillStyle="lightblue",canvasCtx.fillRect(border_canvas_plot_top,border_canvas_plot_top,canvas.width/10+border_canvas_plot_left-2*border_canvas_plot_top,canvas.height/10-border_canvas_plot_top),canvasCtx.fillStyle="black",canvasCtx.font=getFont(25);var s=(border_canvas_plot_top+canvas.height/10)/2;canvasCtx.textAlign="right",canvasCtx.fillText(Math.round(frec_max1).toString()+" Hz",canvas.width/8,s),canvasCtx.fillStyle="black",PlotFFT(),PlotSpectro1(),animationId=requestAnimationFrame(Plot)}function splitSignal(t){var e=t.length/2,a=[],n=[];a.length=e,n.length=e;for(var o=0;o<e;++o)a[o]=t[2*o],n[o]=t[2*o+1];return{even:a,odd:n}}function ensureComplex(t){for(var e=0;e<t.length;++e)t[e]instanceof Complex||(t[e]=new Complex(t[e],0));return t}function calculateFFT(t,e,a){for(var n=a.length/2,o=0;o<n;++o){var i=Math.cos(2*Math.PI*o/a.length),l=Math.sin(-2*Math.PI*o/a.length),s=e[o].re*i-e[o].im*l,c=e[o].re*l+e[o].im*i,r=new Complex(t[o].re+s,t[o].im+c),_=new Complex(t[o].re-s,t[o].im-c);a[o]=r,a[o+n]=_}return a}function myFFT(t){if(1==t.length)return t;var{even:e,odd:a}=splitSignal(t);return e=myFFT(e),a=myFFT(a),calculateFFT(e=ensureComplex(e),a=ensureComplex(a),t)}function Complex(t,e){this.re=t,this.im=e||0}const HSLToRGB=(t,e,a)=>{a/=100;const n=e=>(e+t/30)%12,o=(e/=100)*Math.min(a,1-a),i=t=>a-o*Math.max(-1,Math.min(n(t)-3,Math.min(9-n(t),1)));return[255*i(0),255*i(8),255*i(4)]};function getCanvasCoordinates2(){return{x:canvas.width/10+border_canvas_plot_left,centro:(canvas.height/10+border_canvas_plot_top)/2,scale_v:canvas.height/760}}function drawMicLine(t,e,a,n,o){let i=my_x[t]*o+a;return 0==t?canvasCtx.moveTo(e,a):(i=a+(i-a)*n,i>canvas.height/10+border_canvas_plot_top-1&&(i=canvas.height/10+border_canvas_plot_top-1),canvasCtx.lineTo(e,i)),e+=(.9*canvas.width-border_canvas_plot_left-border_canvas_plot_right)/my_x.length}function PlotMic(){f_Nyquist=audioCtx.sampleRate/2,canvasCtx.lineWidth=1,canvasCtx.fillStyle="#003B5C",canvasCtx.fillRect(canvas.width/10+border_canvas_plot_left,0,.9*canvas.width-border_canvas_plot_right-border_canvas_plot_left,canvas.height/10+border_canvas_plot_top),canvasCtx.beginPath(),canvasCtx.strokeStyle="white";let{x:t,centro:e,scale_v:a}=getCanvasCoordinates2();for(let n=0;n<my_x.length;n++)t=drawMicLine(n,t,e,a,.4);canvasCtx.stroke()}function PlotFFT(){var t=canvas.width/1440;canvasCtx.lineWidth=1,canvasCtx.strokeStyle="hsl(0,100%,50%)",canvasCtx.fillStyle="#003B5C",canvasCtx.fillRect(0,canvas.height/10+border_canvas_plot_top,.9*canvas.width/10,.9*canvas.height-border_canvas_plot_bottom-border_canvas_plot_top);let e=canvas.height/10+border_canvas_plot_top;var a=.9*canvas.height-border_canvas_plot_bottom-border_canvas_plot_top,n=(canvas.height-canvas.height/10-border_canvas_plot_top-border_canvas_plot_bottom)/(i_max-i_min),o=1127.01048*Math.log(f_min/700+1),i=1127.01048*Math.log(f_max/700+1);for(let n=i_min;n<i_max;n++){var l=f_min+(f_max-f_min)*(n-i_min)/(i_max-i_min);if("Linear"==document.getElementById("scale").value)s=e+a-a*(n-i_min)/(i_max-i_min);else if("Mel"==document.getElementById("scale").value)var s=e+a-a*(1127.01048*Math.log(l/700+1)-o)/(i-o);t=canvas.width/1440;let r=-my_X_abs[n]*t+.9*canvas.width/10;var c=my_X_abs[n]/sensibility;canvasCtx.strokeStyle="hsl("+360*(1-c)+",100%,50%)",canvasCtx.beginPath(),canvasCtx.moveTo(.9*canvas.width/10,s),my_X_abs[n]>0&&canvasCtx.lineTo(r,s),canvasCtx.stroke()}s=canvas.height-border_canvas_plot_bottom,canvasCtx.beginPath(),canvasCtx.strokeStyle="white",sensibility=document.getElementById("sensibility").value;for(let l=i_min;l<i_max;l++){if("Linear"==document.getElementById("scale").value)s=e+a-a*(l-i_min)/(i_max-i_min);else if("Mel"==document.getElementById("scale").value){var r=f_min+(f_max-f_min)*(l-i_min)/(i_max-i_min);s=e+a-a*(1127.01048*Math.log(r/700+1)-(o=1127.01048*Math.log(f_min/700+1)))/((i=1127.01048*Math.log(f_max/700+1))-o)}let c=-my_X_abs[l]*t+.9*canvas.width/10;l===i_min?canvasCtx.moveTo(.9*canvas.width/10,s):my_X_abs[l]>0&&canvasCtx.lineTo(c,s),s-=n}canvasCtx.stroke(),max_intensity>sensibility?(sensibility_temp=max_intensity,ColormapMarks()):sensibility_temp=sensibility,ColormapMarks(),document.getElementById("output_sensibility").innerHTML=Math.floor(sensibility_temp),document.getElementById("sensibility").value=Math.floor(sensibility_temp),canvasCtx.moveTo(-sensibility_temp*t+.9*canvas.width/10,e),canvasCtx.lineTo(-sensibility_temp*t+.9*canvas.width/10,e+a),canvasCtx.stroke()}function calculateYPosition(t,e,a,n,o,i,l,s){if("Linear"===t)return a+n-n*(e-i_min)/(i_max-i_min);if("Mel"===t){const t=o+(i-o)*(e-i_min)/(i_max-i_min);return a+n-n*(1127.01048*Math.log(t/700+1)-l)/(s-l)}}function drawLine(t,e,a,n,o){canvasCtx.beginPath(),t?(canvasCtx.moveTo(e+a,n),canvasCtx.lineTo(e+a-o,n)):(canvasCtx.moveTo(e,n),canvasCtx.lineTo(e+o,n)),canvasCtx.stroke()}function getCanvasCoordinates(){return{X0:Math.floor(canvas.width/10+border_canvas_plot_left),deltaX0:Math.floor(.9*canvas.width-border_canvas_plot_left-border_canvas_plot_right-bin_width),Y0:canvas.height/10+border_canvas_plot_top,deltaY0:.9*canvas.height-border_canvas_plot_bottom-border_canvas_plot_top}}function getCanvasSettings(){return{scale:document.getElementById("scale").value,scrolling:document.getElementById("scrolling").checked,stop:document.getElementById("stop").checked}}function shiftImageData({X0:t,deltaX0:e,Y0:a,deltaY0:n},{scrolling:o,stop:i}){if(!i){const i=canvasCtx.getImageData(t+(o?bin_width:1),a,e-bin_width-(o?0:1),n);canvasCtx.putImageData(i,t+(o?0:bin_width),a)}}function drawSpectrogramLines({X0:t,Y0:e,deltaY0:a,deltaX0:n},{scale:o,scrolling:i},l,s){for(let c=i_min;c<i_max;c++){const r=calculateYPosition(o,c,e,a,f_min,f_max,l,s),_=Math.min(my_X_abs[c]/sensibility,1),d=evaluate_cmap(_,colormap,!1);canvasCtx.strokeStyle="rgb("+d+")",drawLine(i,t,n,r,bin_width)}}function PlotSpectro1(){fftSize=parseInt(document.getElementById("sizeFFT").value),canvasCtx.lineWidth=1,canvasCtx.fillStyle="white";const{X0:t,deltaX0:e,Y0:a,deltaY0:n}=getCanvasCoordinates(),{scale:o,scrolling:i,stop:l}=getCanvasSettings();shiftImageData({X0:t,deltaX0:e,Y0:a,deltaY0:n},{scrolling:i,stop:l});drawSpectrogramLines({X0:t,Y0:a,deltaY0:n,deltaX0:e},{scale:o,scrolling:i},1127.01048*Math.log(f_min/700+1),1127.01048*Math.log(f_max/700+1)),canvasCtx.font=getFont(10)}function drawYAxisBackground(){canvasCtx.fillStyle="white";let t=canvas.width/10+border_canvas_plot_left,e=canvas.height/10+border_canvas_plot_top;var a=.9*canvas.height-border_canvas_plot_bottom-border_canvas_plot_top;return canvasCtx.fillRect(.9*canvas.width/10,e-border_canvas_plot_top,.1*canvas.width/10+border_canvas_plot_left,e+a),canvasCtx.fillStyle="black",canvasCtx.font=getFont(10),canvasCtx.textAlign="right",{X0:t,Y0:e,deltaY0:a}}function drawYAxisMarks(t,e,a,n,o){for(var i=0;i<t.length;i++){var l=o(t[i],a,n);t[i]<=f_max&&(canvasCtx.textBaseline="middle",canvasCtx.fillText(t[i].toString()+" Hz",e-border_canvas_plot_top,l)),canvasCtx.strokeStyle="black",canvasCtx.beginPath(),t[i]<=f_max&&(canvasCtx.moveTo(e,l),canvasCtx.lineTo(e-4,l),canvasCtx.moveTo(.9*canvas.width/10,l),canvasCtx.lineTo(.9*canvas.width/10+4,l)),canvasCtx.stroke()}}function YaxisMarks(){const{X0:t,Y0:e,deltaY0:a}=drawYAxisBackground();if("Linear"==document.getElementById("scale").value)drawYAxisMarks([100,500,1e3,1500,2e3,2500,3e3,3500,4e3,4500,5e3,5500,6e3,6500,7e3,7500,8e3,8500,9e3,9500,1e4,11e3,12e3,13e3,14e3,15e3,16e3,17e3,18e3,19e3,2e4],t,e,a,((t,e,a)=>e+a-a*(t-f_min)/(f_max-f_min)));else if("Mel"==document.getElementById("scale").value){drawYAxisMarks([100,200,400,600,800,1e3,2e3,3e3,4e3,5e3,6e3,7e3,8e3,9e3,1e4,11e3,13e3,15e3,17e3,2e4],t,e,a,((t,e,a)=>{var n=1127.01048*Math.log(t/700+1),o=1127.01048*Math.log(f_min/700+1);return e+a-a*(n-o)/(1127.01048*Math.log(f_max/700+1)-o)}))}}function applyOrientation(){window.innerHeight>window.innerWidth?(canvas.width=window.innerWidth,canvas.height=400*canvas.width/700):(canvas.width=window.innerWidth,canvas.height=window.innerHeight),border_canvas_plot_left=canvas.width/20,border_canvas_plot_right=canvas.width/10;var t=canvas.height/760;border_canvas_plot_bottom=80*t,border_canvas_plot_top=10*t,plot_colormap()}function plot_colormap(){colormap=document.getElementById("colormap").value;let t=Math.floor(canvas.height/10+border_canvas_plot_top);var e=Math.floor(.9*canvas.height-border_canvas_plot_bottom-border_canvas_plot_top);for(let n=t;n<=t+e;n++){var a=evaluate_cmap(1-(n-t)/e,colormap,!1);canvasCtx.fillStyle="rgb("+a+")";let o=Math.floor(.9*canvas.width+border_canvas_plot_top);canvasCtx.fillRect(o,n,canvas.width/30,1)}}function SetDefaultWindow(){if("WebAudio"==document.getElementById("FFT").value){document.getElementById("window").value="None"}else if("myFFT"==document.getElementById("FFT").value){document.getElementById("window").value="BH7"}}function ColormapMarks(){canvasCtx.fillStyle="white";let t=.95*canvas.width,e=canvas.height/10+border_canvas_plot_top;var a=.9*canvas.height-border_canvas_plot_bottom-border_canvas_plot_top;canvasCtx.fillRect(t,0,canvas.width-t,e+a+10),canvasCtx.fillRect(0,canvas.height-.8*border_canvas_plot_bottom,canvas.width,.8*border_canvas_plot_bottom+10),canvasCtx.fillStyle="black",canvasCtx.font=getFont(20),canvasCtx.textBaseline="middle";var n=Math.max(sensibility_temp,max_intensity);canvasCtx.textAlign="left",canvasCtx.fillText(Math.floor(n)+" dB",t,e),canvasCtx.fillText(Math.floor(.75*n)+" dB",t,e+.25*a),canvasCtx.fillText(Math.floor(.5*n)+" dB",t,e+.5*a),canvasCtx.fillText(Math.floor(.25*n)+" dB",t,e+.75*a),canvasCtx.fillText("0 dB",t,e+a),canvasCtx.textAlign="left",canvasCtx.fillText("Time",canvas.width/2,canvas.height-.5*border_canvas_plot_bottom),canvasCtx.fillText("Loudness (dB)",10,canvas.height-.5*border_canvas_plot_bottom),canvasCtx.fillText("Color",canvas.width-border_canvas_plot_right,canvas.height-.5*border_canvas_plot_bottom)}function getFont(t){var e=t/1e3;return(0|canvas.width*e)+"px sans-serif"}window.onresize=function(t){applyOrientation()};