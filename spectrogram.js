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

function callback(stream) {
    if (!audioCtx) {
        audioCtx = new AudioContext({
            latencyHint: 'interactive',
            sampleRate: 44100,
        });

    }

    const source = audioCtx.createMediaStreamSource(stream);

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.minDecibels = -40;

    bufferLength = analyser.frequencyBinCount;

    dataTime = new Float32Array(bufferLength * 2);

    dataFrec = new Float32Array(bufferLength);
    const sr = audioCtx.sampleRate;

    source.connect(analyser);
    // analyser.connect(audioCtx.destination);

    Plot();

    function Plot() {
        analyser.fftSize = fftSize;
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
        analyser.getFloatFrequencyData(dataFrec)

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
        canvasCtx.fillText(Math.round(frec_max1).toString() + " Hz", canvas.width / 8, centro);


        canvasCtx.fillStyle = "black";

        PlotFFT();
        PlotSpectro1();

        animationId = requestAnimationFrame(Plot);
    }
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
        if (!(array[k] instanceof Complex))
            array[k] = new Complex(array[k], 0);
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
        var A_k = new Complex(even[k].re + temp_k_real, even[k].im + temp_k_imag);
        var B_k = new Complex(even[k].re - temp_k_real, even[k].im - temp_k_imag);
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

function Complex(re, im) {
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
function PlotFFT() {
    var scale_h = canvas.width / 1440;

    canvasCtx.lineWidth = 1;
    canvasCtx.strokeStyle = 'hsl(' + 360 * 0 + ',100%,50%)';

    canvasCtx.fillStyle = '#003B5C';

    canvasCtx.fillRect(0, canvas.height / 10 + border_canvas_plot_top, .9 * canvas.width / 10, .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top);

    var y;
    let Y0 = canvas.height / 10 + border_canvas_plot_top;
    var deltaY0 = .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top;

    var deltaY = (canvas.height - canvas.height / 10 - border_canvas_plot_top - border_canvas_plot_bottom) / (i_max - i_min);

    var mel_i_min = 1127.01048 * Math.log(f_min / 700 + 1)
    var mel_i_max = 1127.01048 * Math.log(f_max / 700 + 1)
    for (let i = i_min; i < i_max; i++) {
        var freq2 = f_min + (f_max - f_min) * (i - i_min) / (i_max - i_min);
        if (document.getElementById("scale").value == "Linear") {
            y = Y0 + deltaY0 - deltaY0 * (i - i_min) / (i_max - i_min);
        } else if (document.getElementById("scale").value == "Mel") {
            var mel_i = 1127.01048 * Math.log(freq2 / 700 + 1)

            var y = Y0 + deltaY0 - deltaY0 * (mel_i - mel_i_min) / (mel_i_max - mel_i_min);
        }
        scale_h = canvas.width / 1440;
        let x = -my_X_abs[i] * scale_h + .9 * canvas.width / 10;

        var value = my_X_abs[i] / (sensibility);

        canvasCtx.strokeStyle = 'hsl(' + 360 * (1 - value) + ',100%,50%)';
        canvasCtx.beginPath();

        canvasCtx.moveTo(.9 * canvas.width / 10, y);

        if (my_X_abs[i] > 0) canvasCtx.lineTo(x, y);

        canvasCtx.stroke();

    }

    y = canvas.height - border_canvas_plot_bottom;

    canvasCtx.beginPath();
    canvasCtx.strokeStyle = 'white';
    sensibility = document.getElementById("sensibility").value;;
    for (let i = i_min; i < i_max; i++) {

        if (document.getElementById("scale").value == "Linear") {
            y = Y0 + deltaY0 - deltaY0 * (i - i_min) / (i_max - i_min);
        } else if (document.getElementById("scale").value == "Mel") {
            var freq = f_min + (f_max - f_min) * (i - i_min) / (i_max - i_min)

            var mel_i = 1127.01048 * Math.log(freq / 700 + 1)
            var mel_i_min = 1127.01048 * Math.log(f_min / 700 + 1)
            var mel_i_max = 1127.01048 * Math.log(f_max / 700 + 1)
            y = Y0 + deltaY0 - deltaY0 * (mel_i - mel_i_min) / (mel_i_max - mel_i_min);
        }
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
