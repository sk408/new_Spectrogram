const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html);
const window = dom.window;
const document = window.document;

// We need a minimal mock of the objects used by the code being benchmarked
const canvas = document.querySelector('.canvas');
// Mock canvas methods
canvas.getContext = () => ({
  fillStyle: '',
  fillRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  lineWidth: 1,
  strokeStyle: '',
  font: '',
  textBaseline: '',
  textAlign: '',
  fillText: () => {},
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: () => {}
});

// Since the loop is in PlotSpectro1(), we can isolate that logic for testing
let i_min = 0;
let i_max = 5000;
let f_min = 0;
let f_max = 20000;
let my_X_abs = new Float32Array(5000).fill(10);
let sensibility = 60;
let colormap = 'hot';

function evaluate_cmap(val, cmap, reverse) {
    return "0,0,0";
}

let border_canvas_plot_left = 10;
let border_canvas_plot_right = 10;
let border_canvas_plot_top = 10;
let border_canvas_plot_bottom = 10;
let bin_width = 4;
canvas.width = 800;
canvas.height = 600;

let Y0 = canvas.height / 10 + border_canvas_plot_top;
let deltaY0 = .9 * canvas.height - border_canvas_plot_bottom - border_canvas_plot_top;
let deltaY = deltaY0 / (i_max - i_min);
let X0 = Math.floor(canvas.width / 10 + border_canvas_plot_left);
let deltaX0 = Math.floor(.9 * canvas.width - border_canvas_plot_left - border_canvas_plot_right - bin_width);

const canvasCtx = canvas.getContext("2d");

function test_original() {
    let start = performance.now();
    for (var k=0; k<100; k++) {
        var y;
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


            var value = my_X_abs[i] / (sensibility);
            if (value > 1) value = 1;

            var myrgb = evaluate_cmap(value, colormap, false);
            canvasCtx.strokeStyle = 'rgb(' + myrgb + ')';

            canvasCtx.beginPath();
            if (document.getElementById("scrolling").checked == true) {
                canvasCtx.moveTo(X0 + deltaX0, y);
                canvasCtx.lineTo(X0 + deltaX0 - bin_width, y);
            } else {
                canvasCtx.moveTo(X0, y);
                canvasCtx.lineTo(X0 + bin_width, y);
            }
            canvasCtx.stroke();
        }
    }
    return performance.now() - start;
}

function test_optimized() {
    let start = performance.now();
    for (var k=0; k<100; k++) {
        var y;
        var scaleType = document.getElementById("scale").value;
        var mel_i_min = 1127.01048 * Math.log(f_min / 700 + 1);
        var mel_i_max = 1127.01048 * Math.log(f_max / 700 + 1);
        var isScrolling = document.getElementById("scrolling").checked;

        for (let i = i_min; i < i_max; i++) {
            if (scaleType == "Linear") {
                y = Y0 + deltaY0 - deltaY0 * (i - i_min) / (i_max - i_min);
            } else if (scaleType == "Mel") {
                var freq = f_min + (f_max - f_min) * (i - i_min) / (i_max - i_min);
                var mel_i = 1127.01048 * Math.log(freq / 700 + 1);
                y = Y0 + deltaY0 - deltaY0 * (mel_i - mel_i_min) / (mel_i_max - mel_i_min);
            }

            var value = my_X_abs[i] / (sensibility);
            if (value > 1) value = 1;

            var myrgb = evaluate_cmap(value, colormap, false);
            canvasCtx.strokeStyle = 'rgb(' + myrgb + ')';

            canvasCtx.beginPath();
            if (isScrolling) {
                canvasCtx.moveTo(X0 + deltaX0, y);
                canvasCtx.lineTo(X0 + deltaX0 - bin_width, y);
            } else {
                canvasCtx.moveTo(X0, y);
                canvasCtx.lineTo(X0 + bin_width, y);
            }
            canvasCtx.stroke();
        }
    }
    return performance.now() - start;
}

console.log("Original Time: " + test_original() + " ms");
console.log("Optimized Time: " + test_optimized() + " ms");
