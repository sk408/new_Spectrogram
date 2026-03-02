const { performance } = require('perf_hooks');

const measureBaseline = () => {
    let my_x = new Array(1024).fill(0.5);
    let mean = 0.5;
    let iterations = 10000;

    let start = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
        let BH7 = new Array(7).fill(0);
        BH7[0] = 0.27105140069342;
        BH7[1] = -0.43329793923448;
        BH7[2] = 0.21812299954311;
        BH7[3] = -0.06592544638803;
        BH7[4] = 0.01081174209837;
        BH7[5] = -0.00077658482522;
        BH7[6] = 0.00001388721735;

        for (var i = 0; i < my_x.length; i++) {
            let w = 0;
            for (let j = 0; j < 7; j++) {
                w += BH7[j] * Math.cos(2 * Math.PI * j * i / my_x.length);
            }
            my_x[i] = (my_x[i] - mean) * w;
        }
    }
    let end = performance.now();
    console.log("Baseline time:", end - start, "ms");
}

const measureOptimized = () => {
    let my_x = new Array(1024).fill(0.5);
    let mean = 0.5;
    let iterations = 10000;

    const BH7 = [
        0.27105140069342,
        -0.43329793923448,
        0.21812299954311,
        -0.06592544638803,
        0.01081174209837,
        -0.00077658482522,
        0.00001388721735
    ];

    let start = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
        for (var i = 0; i < my_x.length; i++) {
            let w = 0;
            for (let j = 0; j < 7; j++) {
                w += BH7[j] * Math.cos(2 * Math.PI * j * i / my_x.length);
            }
            my_x[i] = (my_x[i] - mean) * w;
        }
    }
    let end = performance.now();
    console.log("Optimized time:", end - start, "ms");
}

measureBaseline();
measureOptimized();
