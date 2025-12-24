let LiteRT = null;
let Tensor = null;
let model = null;
let projModel = null;
let currentInputTensors = [];
let loopStep = 0;

const IMG_IDX = 1;
const DT_IDX = 0;
const INPUT_COUNT = 48;
const IMG_SHAPE = [1, 1, 36, 36, 3];
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@litertjs/core@0.2.1/wasm/';

const PROJ_INPUT_SOURCE_INDICES = [4, 5, 12, 15, 16, 23, 26, 27, 34, 37, 38, 40, 41, 46];
const PROJ_OUTPUT_KEYS = ['fm1', 'fm2', 'fm3', 'fm4', 'proj', 'ssm1', 'ssm2', 'ssm3', 'ssm4']; 

const STATE_MAP = [
    { inIdx: 2,  outIdx: 1  }, { inIdx: 3,  outIdx: 12 }, { inIdx: 14, outIdx: 23 }, 
    { inIdx: 25, outIdx: 34 }, { inIdx: 36, outIdx: 42 }, { inIdx: 43, outIdx: 43 }, 
    { inIdx: 44, outIdx: 44 }, { inIdx: 45, outIdx: 45 }, { inIdx: 46, outIdx: 46 }, 
    { inIdx: 47, outIdx: 2  }, { inIdx: 4,  outIdx: 3  }, { inIdx: 5,  outIdx: 4  }, 
    { inIdx: 6,  outIdx: 5  }, { inIdx: 7,  outIdx: 6  }, { inIdx: 8,  outIdx: 7  }, 
    { inIdx: 9,  outIdx: 8  }, { inIdx: 10, outIdx: 9  }, { inIdx: 11, outIdx: 10 }, 
    { inIdx: 12, outIdx: 11 }, { inIdx: 13, outIdx: 13 }, { inIdx: 15, outIdx: 14 }, 
    { inIdx: 16, outIdx: 15 }, { inIdx: 17, outIdx: 16 }, { inIdx: 18, outIdx: 17 }, 
    { inIdx: 19, outIdx: 18 }, { inIdx: 20, outIdx: 19 }, { inIdx: 21, outIdx: 20 }, 
    { inIdx: 22, outIdx: 21 }, { inIdx: 23, outIdx: 22 }, { inIdx: 24, outIdx: 24 }, 
    { inIdx: 26, outIdx: 25 }, { inIdx: 27, outIdx: 26 }, { inIdx: 28, outIdx: 27 }, 
    { inIdx: 29, outIdx: 28 }, { inIdx: 30, outIdx: 29 }, { inIdx: 31, outIdx: 30 }, 
    { inIdx: 32, outIdx: 31 }, { inIdx: 33, outIdx: 32 }, { inIdx: 34, outIdx: 33 }, 
    { inIdx: 35, outIdx: 35 }, { inIdx: 37, outIdx: 36 }, { inIdx: 38, outIdx: 37 }, 
    { inIdx: 39, outIdx: 38 }, { inIdx: 40, outIdx: 39 }, { inIdx: 41, outIdx: 40 }, 
    { inIdx: 42, outIdx: 41 }
];

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    try {
        if (type === 'init') await handleInit(payload);
        else if (type === 'run') await handleRun(payload);
        else if (type === 'export_state') await handleExportState();
    } catch (err) {
        self.postMessage({ type: 'error', msg: err.toString() });
    }
};

async function handleInit({ modelBuffer, stateJson, projBuffer }) {
    const litertModule = await import('https://cdn.jsdelivr.net/npm/@litertjs/core@0.2.1/+esm');
    LiteRT = litertModule;
    Tensor = litertModule.Tensor;

    const originalFetch = self.fetch;
    self.fetch = async (input, init) => {
        if (typeof input === 'string' && input.endsWith('.wasm')) {
            const fileName = input.split('/').pop();
            return originalFetch(`${WASM_BASE_URL}${fileName}`, init);
        }
        return originalFetch(input, init);
    };
    
    await LiteRT.loadLiteRt(WASM_BASE_URL);
    self.fetch = originalFetch;

    model = await LiteRT.loadAndCompile(URL.createObjectURL(new Blob([modelBuffer])), { accelerator: 'wasm' });
    projModel = await LiteRT.loadAndCompile(URL.createObjectURL(new Blob([projBuffer])), { accelerator: 'wasm' });

    if (currentInputTensors.length > 0) currentInputTensors.forEach(t => t && t.delete());
    currentInputTensors = new Array(INPUT_COUNT);

    const inputsMeta = model.getInputDetails();
    for (let i = 0; i < INPUT_COUNT; i++) {
        const meta = inputsMeta[i];
        const size = meta.shape.reduce((a, b) => a * b, 1);
        let data;
        
        if (i === IMG_IDX) data = new Float32Array(size);
        else if (i === DT_IDX) data = new Float32Array([1/30]);
        else {
            if (stateJson[meta.name]) {
                const src = stateJson[meta.name];
                data = (src instanceof Float32Array) ? src : new Float32Array(src.flat(Infinity));
            }
            else data = new Float32Array(size);
        }
        currentInputTensors[i] = new Tensor(data, meta.shape);
    }

    loopStep = 0;
    self.postMessage({ type: 'initDone' });
}

async function handleRun({ imgData, dtVal, timestamp }) { 
    if (!model || !projModel) return;
    const start = performance.now();

    if (currentInputTensors[IMG_IDX]) currentInputTensors[IMG_IDX].delete();
    if (currentInputTensors[DT_IDX]) currentInputTensors[DT_IDX].delete();

    currentInputTensors[IMG_IDX] = new Tensor(imgData, IMG_SHAPE);
    currentInputTensors[DT_IDX] = new Tensor(new Float32Array([dtVal]), [1]);

    const results = model.run(currentInputTensors);
    
    const usedOutputIndices = new Set();
    for (const map of STATE_MAP) {
        const outputTensor = results[map.outIdx];
        if (outputTensor) {
            const oldInputState = currentInputTensors[map.inIdx];
            if (oldInputState) oldInputState.delete();
            currentInputTensors[map.inIdx] = outputTensor;
            usedOutputIndices.add(map.outIdx);
        }
    }

    const mainVal = results[0] ? results[0].toTypedArray()[0] : 0;

    for (let i = 0; i < results.length; i++) {
        if (!usedOutputIndices.has(i)) {
            if (results[i]) results[i].delete();
        }
    }

    const projInputTensors = [];
    for (let i = 0; i < PROJ_INPUT_SOURCE_INDICES.length; i++) {
        projInputTensors[i] = currentInputTensors[PROJ_INPUT_SOURCE_INDICES[i]];
    }

    const projResults = projModel.run(projInputTensors);
    const formattedOutput = {};

    for (let i = 0; i < PROJ_OUTPUT_KEYS.length; i++) {
        const tensor = projResults[i];
        if (tensor) {
            formattedOutput[PROJ_OUTPUT_KEYS[i]] = tensor.toTypedArray();
            tensor.delete();
        }
    }

    const end = performance.now();
    loopStep++;

    self.postMessage({ 
        type: 'result', 
        payload: { 
            step: loopStep, 
            value: mainVal, 
            time: end - start,
            projOutput: formattedOutput,
            timestamp: timestamp
        }
    });
}

async function handleExportState() {
    if (!model || !currentInputTensors) return;

    const inputsMeta = model.getInputDetails();
    const stateSnapshot = {};

    for(let i=0; i < inputsMeta.length; i++) {
        const meta = inputsMeta[i];
        if (currentInputTensors[i] && i !== IMG_IDX && i !== DT_IDX) {
            stateSnapshot[meta.name] = Array.from(currentInputTensors[i].toTypedArray());
        }
    }

    self.postMessage({ type: 'state_exported', payload: stateSnapshot });
}