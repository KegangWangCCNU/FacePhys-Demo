import { FaceDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm";
let currentSqi = 0;          
let currentCaptureTime = 0;       
let dval = 1/30;
let lastTrendUpdateTime = 0;
let virtualTime = 0;
let isCameraSwitching = false;
const INPUT_BUFFER_SIZE = 450;
const SQI_THRESHOLD = 0.45;
const DB_NAME = "VitalMonitorDB";
const STORE_NAME = "states";
const MODEL_FILES = {
    model: './models/model.tflite',
    proj: './models/proj.tflite',
    sqi: './models/sqi_model.tflite',
    psd: './models/psd_model.tflite',
    state: './models/state.gz'
};
let currentFacingMode = 'user';
let hasBackCamera = false;
const videoElement = document.getElementById('videoInput');
const previewCanvas = document.getElementById('previewCanvas');
const previewCtx = previewCanvas.getContext('2d', { alpha: false });
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');

const largeStartBtn = document.getElementById('largeStartBtn'); 
const saveBtn = document.getElementById('saveBtn');

const plotCanvas = document.getElementById('plotCanvas'); 
const psdCanvas = document.getElementById('psdCanvas');
const trendCanvas = document.getElementById('trendCanvas'); 

const heatmapCanvas = document.getElementById('heatmapCanvas');
const heatmapCtx = heatmapCanvas.getContext('2d');
const trajCanvas = document.getElementById('trajCanvas');
const trajCtx = trajCanvas.getContext('2d');
const cropDisplayCanvas = document.getElementById('cropDisplayCanvas');
const cropDisplayCtx = cropDisplayCanvas.getContext('2d');
const layerBtns = document.querySelectorAll('.layer-btn');

const elHr = document.getElementById('hrVal');
const elFps = document.getElementById('fpsVal');
const elLatency = document.getElementById('latencyVal');
const elSqi = document.getElementById('sqiVal');
const elFrame = document.getElementById('frameVal');

const inferenceWorker = new Worker('./inference_worker.js');
const psdWorker = new Worker('./psd_worker.js');
const plotWorker = new Worker('./plot_worker.js');


let faceDetector = null;
let isRunning = false;
let stream = null;
let inputBuffer = new Float32Array(INPUT_BUFFER_SIZE); 
let bufferPtr = 0; 
let bufferFull = false;

let lastPsdTime = 0;
let lastHrUpdate = 0; 
let lastLatencyUpdateTime = 0;
let lastFrameTime = 0;
let frameCount = 0;
let lastFrameCount = 0;
let lastFpsTime = 0;

let bvpLog = []; 
let hrLog = [];  
let lastFaceDetectTime = 0;
let lastHrValue = 70; 

let kfX, kfY, kfW, kfH;

const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
});

async function saveStateToDB(stateData) {
    const db = await dbPromise;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(stateData, "lastState");
}

async function loadStateFromDB() {
    const db = await dbPromise;
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get("lastState");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

class KalmanFilter1D {
    constructor(initialValue, processNoise = 1e-2, measurementNoise = 5e-1) {
        this.x = initialValue; 
        this.p = 1.0;          
        this.q = processNoise;
        this.r = measurementNoise;
    }
    update(measurement) {
        const p_pred = this.p + this.q;
        const k = p_pred / (p_pred + this.r);
        this.x = this.x + k * (measurement - this.x);
        this.p = (1 - k) * p_pred;
        return this.x;
    }
}

class VisEngine {
    constructor() {
        this.activeLayer = 0;
        this.historyLen = 300;
        this.trajHistory = [[], [], [], [], []];
        this.currentHeatmaps = [null, null, null, null];
        this.layerRanges = [null, null, null, null]; 
        this.setupUI();
    }

    setupUI() {
        layerBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                layerBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeLayer = parseInt(btn.dataset.layer);
            });
        });
    }

    update(output, value) {
        const ssmKeys = ['ssm1', 'ssm2', 'ssm3', 'ssm4', 'proj'];
        for (let i = 0; i < 5; i++) {
            const key = ssmKeys[i];
            if (output[key]) {
                const arr = output[key];
                this.pushHistory(i, arr[0], arr[1], value);
            }
        }

        const fmKeys = ['fm1', 'fm2', 'fm3', 'fm4'];
        for (let i = 0; i < 4; i++) {
            if (output[fmKeys[i]]) {
                this.currentHeatmaps[i] = output[fmKeys[i]];
            }
        }
    }

    pushHistory(layerIdx, x, y, val) {
        const hist = this.trajHistory[layerIdx];
        hist.push({ x, y, val });
        if (hist.length > this.historyLen) hist.shift();
    }

    draw() {
        let fmIdx = this.activeLayer === 4 ? 3 : this.activeLayer;
        const fmData = this.currentHeatmaps[fmIdx];
        
        heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
        heatmapCtx.fillStyle = "#000";
        heatmapCtx.fillRect(0,0,heatmapCanvas.width, heatmapCanvas.height);

        if (fmData) this.renderHeatmap(fmData, fmIdx);

        trajCtx.clearRect(0, 0, trajCanvas.width, trajCanvas.height);
        trajCtx.strokeStyle = "#333";
        trajCtx.lineWidth = 1;
        trajCtx.beginPath();
        trajCtx.moveTo(trajCanvas.width/2, 0); trajCtx.lineTo(trajCanvas.width/2, trajCanvas.height);
        trajCtx.moveTo(0, trajCanvas.height/2); trajCtx.lineTo(trajCanvas.width, trajCanvas.height/2);
        trajCtx.stroke();

        const hist = this.trajHistory[this.activeLayer];
        if (hist.length > 2) this.renderTrajectory(hist);
    }

    renderHeatmap(data, layerIdx) {
        const size = Math.sqrt(data.length);
        if (size % 1 !== 0) return;

        let localMin = Infinity, localMax = -Infinity;
        for(let v of data) { if(v<localMin) localMin=v; if(v>localMax) localMax=v; }

        if (!this.layerRanges[layerIdx]) {
            this.layerRanges[layerIdx] = { min: localMin, max: localMax };
        }

        const smoothRange = this.layerRanges[layerIdx];
        const alpha = 0.01; 
        
        smoothRange.min = smoothRange.min * (1 - alpha) + localMin * alpha;
        smoothRange.max = smoothRange.max * (1 - alpha) + localMax * alpha;

        const range = smoothRange.max - smoothRange.min || 1;
        const minVal = smoothRange.min;

        const imgData = heatmapCtx.createImageData(size, size);

        for (let i = 0; i < data.length; i++) {
            let norm = (data[i] - minVal) / range;
            if (norm < 0) norm = 0;
            if (norm > 1) norm = 1;
            
            const idx = i * 4;
            let r, g, b;
            if (norm < 0.25) { 
                const t = norm / 0.25; r = t * 60; g = 0; b = t * 100; 
            } else if (norm < 0.5) { 
                const t = (norm - 0.25) / 0.25; r = 60 + t * 195; g = 0; b = 100 - t * 80; 
            } else if (norm < 0.75) { 
                const t = (norm - 0.5) / 0.25; r = 255; g = t * 150; b = 20; 
            } else { 
                const t = (norm - 0.75) / 0.25; r = 255; g = 150 + t * 105; b = 20 + t * 235;
            }

            imgData.data[idx] = r; imgData.data[idx+1] = g; imgData.data[idx+2] = b; imgData.data[idx+3] = 255;
        }

        const tempC = document.createElement('canvas');
        tempC.width = size; tempC.height = size;
        const tempCtx = tempC.getContext('2d');
        tempCtx.putImageData(imgData, 0, 0);

        const destSize = Math.min(heatmapCanvas.width, heatmapCanvas.height) * 0.95;
        const dx = (heatmapCanvas.width - destSize) / 2;
        const dy = (heatmapCanvas.height - destSize) / 2;
        heatmapCtx.imageSmoothingEnabled = false;
        heatmapCtx.drawImage(tempC, dx, dy, destSize, destSize);
    }

    renderTrajectory(hist) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for(let p of hist) {
            if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
            if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y;
        }
        let rangeX = maxX - minX; let rangeY = maxY - minY;
        if (rangeX < 1e-6) rangeX = 0.001; if (rangeY < 1e-6) rangeY = 0.001;
        const padX = rangeX * 0.1; const padY = rangeY * 0.1;
        minX -= padX; maxX += padX; minY -= padY; maxY += padY;

        const scaleX = trajCanvas.width / (maxX - minX);
        const scaleY = trajCanvas.height / (maxY - minY);
        
        const toScreen = (p) => ({
            x: (p.x - minX) * scaleX,
            y: trajCanvas.height - (p.y - minY) * scaleY 
        });

        trajCtx.lineCap = 'round'; trajCtx.lineJoin = 'round'; trajCtx.lineWidth = 3;

        let p0 = toScreen(hist[0]);
        for (let i = 1; i < hist.length - 1; i++) {
            const p1 = toScreen(hist[i]);
            const p2 = toScreen(hist[i+1]);
            const val = hist[i].val;
            
            let r, g, b;
            const t = (val - (-1.5)) / (1.6 - (-1.5)); 
            if (t < 0.5) { const lt = t * 2; r = lt * 150; g = 20; b = 255 - lt * 100; } 
            else { const lt = (t - 0.5) * 2; r = 150 + lt * 105; g = 20; b = 155 - lt * 155; }
            
            r = Math.max(0,Math.min(255,r)); b = Math.max(0,Math.min(255,b));
            const alpha = Math.pow(i / hist.length, 2); 

            trajCtx.strokeStyle = `rgba(${Math.floor(r)}, ${g}, ${Math.floor(b)}, ${alpha})`;
            trajCtx.beginPath();
            const midX = (p1.x + p2.x) / 2; const midY = (p1.y + p2.y) / 2;
            trajCtx.moveTo(p0.x, p0.y);
            trajCtx.quadraticCurveTo(p1.x, p1.y, midX, midY);
            trajCtx.stroke();
            p0 = {x: midX, y: midY};
        }
    }
}

const visEngine = new VisEngine();

function updateWorkerModes() {
    const isNarrow = window.innerWidth <= 800;
    inferenceWorker.postMessage({ type: 'setMode', payload: { isLowPower: isNarrow } });
    psdWorker.postMessage({ type: 'setMode', payload: { isLowPower: isNarrow } });
}
updateWorkerModes();

async function detectCameras() {
    try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(track => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();

        hasBackCamera = devices.some(device => 
            device.kind === 'videoinput' && 
            /back|rear|environment/i.test(device.label)
        );

        if (!hasBackCamera) {
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            if (videoDevices.length > 1) {
                hasBackCamera = true; 
            }
        }
        console.log("Has back camera:", hasBackCamera);
    } catch (e) {
        console.error("Camera detection error:", e);
        hasBackCamera = true; 
    }
}

async function init() {
    largeStartBtn.innerText = "System Init...";
    
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
        );
        try{
            faceDetector = await FaceDetector.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "models/blaze_face_short_range.tflite",
                    delegate: "GPU" 
                },
                runningMode: "VIDEO"
            });
        } catch(err) {
            faceDetector = await FaceDetector.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "models/blaze_face_short_range.tflite",
                    delegate: "CPU"
                },
                runningMode: "VIDEO"
            });
            console.log("FaceDetector GPU delegate not available, using CPU.");
        }

        const [modelRes, projRes, sqiRes, psdRes] = await Promise.all([
            fetch(MODEL_FILES.model),
            fetch(MODEL_FILES.proj),
            fetch(MODEL_FILES.sqi),
            fetch(MODEL_FILES.psd)
        ]);

        if (!modelRes.ok || !projRes.ok || !sqiRes.ok || !psdRes.ok) {
            throw new Error(`Fetch failed.`);
        }

        const modelBuffer = await modelRes.arrayBuffer();
        const projBuffer = await projRes.arrayBuffer();
        const sqiBuffer = await sqiRes.arrayBuffer();
        const psdBuffer = await psdRes.arrayBuffer();

        let stateJson;
        const cachedState = await loadStateFromDB();

        if (cachedState) {
            stateJson = cachedState;
        } else {
            const stateRes = await fetch(MODEL_FILES.state);
            const ds = new DecompressionStream('gzip');
            const stateStream = stateRes.body.pipeThrough(ds);
            stateJson = await new Response(stateStream).json();
        }

        inferenceWorker.onmessage = (e) => {
            if (e.data.type === 'initDone') {} 
            else if (e.data.type === 'result') handleInferenceResult(e.data.payload);
            else if (e.data.type === 'state_exported') {
                saveStateToDB(e.data.payload);
            }
        };
        inferenceWorker.postMessage({
            type: 'init',
            payload: { modelBuffer: modelBuffer, stateJson: stateJson, projBuffer: projBuffer }
        }, [modelBuffer, projBuffer]);

        psdWorker.onmessage = (e) => {
            if (e.data.type === 'initDone') {} 
            else if (e.data.type === 'result') handlePsdResult(e.data.payload);
        };
        psdWorker.postMessage({
            type: 'init',
            payload: { sqiBuffer: sqiBuffer, psdBuffer: psdBuffer }
        }, [sqiBuffer, psdBuffer]);

        const bvpRect = plotCanvas.getBoundingClientRect();
        const psdRect = psdCanvas.getBoundingClientRect();
        const trendRect = trendCanvas.getBoundingClientRect();
        
        const dpr = window.devicePixelRatio || 1;
        plotCanvas.width = bvpRect.width * dpr; 
        plotCanvas.height = bvpRect.height * dpr;
        psdCanvas.width = psdRect.width * dpr; 
        psdCanvas.height = psdRect.height * dpr;
        trendCanvas.width = trendRect.width * dpr;
        trendCanvas.height = trendRect.height * dpr;

        const offBvp = plotCanvas.transferControlToOffscreen();
        const offPsd = psdCanvas.transferControlToOffscreen();
        const offTrend = trendCanvas.transferControlToOffscreen();

        plotWorker.postMessage({
            type: 'init',
            payload: { 
                bvpCanvas: offBvp, 
                bvpWidth: bvpRect.width, 
                bvpHeight: bvpRect.height, 
                psdCanvas: offPsd,
                psdWidth: psdRect.width,
                psdHeight: psdRect.height,
                trendCanvas: offTrend, 
                trendWidth: trendRect.width,
                trendHeight: trendRect.height,
                dpr: dpr 
            }
        }, [offBvp, offPsd, offTrend]);

        const updateCanvasSizes = () => {
             const hRect = heatmapCanvas.parentElement.getBoundingClientRect();
             heatmapCanvas.width = hRect.width; heatmapCanvas.height = hRect.height;
             const tRect = trajCanvas.parentElement.getBoundingClientRect();
             trajCanvas.width = tRect.width; trajCanvas.height = tRect.height;
             
             const cRect = cropDisplayCanvas.parentElement.getBoundingClientRect();
             cropDisplayCanvas.width = cRect.width; cropDisplayCanvas.height = cRect.height;
             const trendRect = document.getElementById('trendCanvas').getBoundingClientRect();
             const dpr = window.devicePixelRatio || 1;
             plotWorker.postMessage({
                 type: 'resize_trend',
                 payload: {
                     width: trendRect.width,
                     height: trendRect.height,
                     dpr: dpr
                 }
             });
        }
        const videoContainer = document.getElementById('video-frame');
            const isPortrait = window.innerHeight > window.innerWidth;
            if (videoElement.srcObject) {
                if (isPortrait) {
                    videoContainer.style.aspectRatio = "1 / 1";
                } else {
                    videoContainer.style.aspectRatio = "4 / 3";
                }
            }
        updateCanvasSizes();
        window.addEventListener('resize', () => {
            updateCanvasSizes();
            updateWorkerModes();
        });
        largeStartBtn.disabled = false;
        largeStartBtn.innerText = "Start";
        largeStartBtn.addEventListener('click', startSystem);

        saveBtn.addEventListener('click', handleSaveData);

    } catch (err) {
        largeStartBtn.innerText = "Error";
        alert("Error: " + err.message);
    }
}

function handleInferenceResult(payload) {
    const { value, time, projOutput, timestamp } = payload; 
    const now = performance.now();

    if (isRunning) {
        bvpLog.push([timestamp, value]); 
    }

    plotWorker.postMessage({ type: 'bvp_data', payload: value });

    inputBuffer[bufferPtr] = value;
    bufferPtr = (bufferPtr + 1) % INPUT_BUFFER_SIZE;
    if (bufferPtr === 0) bufferFull = true;

    visEngine.update(projOutput, value);
    visEngine.draw();

    if (now - lastLatencyUpdateTime > 500) {
        elLatency.innerText = time.toFixed(1) + "ms"; 
        lastLatencyUpdateTime = now;
    }

    let orderedData;
    if (!bufferFull) {
        orderedData = new Float32Array(INPUT_BUFFER_SIZE);
        orderedData.set(inputBuffer.slice(0, bufferPtr), INPUT_BUFFER_SIZE - bufferPtr);
    } else {
        orderedData = new Float32Array(INPUT_BUFFER_SIZE);
        orderedData.set(inputBuffer.subarray(bufferPtr), 0);
        orderedData.set(inputBuffer.subarray(0, bufferPtr), INPUT_BUFFER_SIZE - bufferPtr);
    }

    psdWorker.postMessage({ type: 'run', payload: { inputData: orderedData } });
}

function handlePsdResult(payload) {
    const { sqi, hr, freq, psd, peak } = payload;
    const now = performance.now();
    
    plotWorker.postMessage({
        type: 'psd_data',
        payload: { psd, freq, peakIdx: peak }
    });

    currentSqi = sqi; 

    const timeSinceFace = performance.now() - lastFaceDetectTime;
    const hasFace = timeSinceFace < 500; 
    const isReliable = (sqi > SQI_THRESHOLD && hasFace);

    if (now - lastHrUpdate > 500) {
        elSqi.innerText = sqi.toFixed(2);
        
        if (isReliable) {
            lastHrValue = hr/30.0/dval;
            elHr.innerText = lastHrValue.toFixed(1);
            elHr.classList.add('active');
        } else {
            elHr.innerText = "-";
            elHr.classList.remove('active');
        }
        lastHrUpdate = now;
    }

    tryUpdateTrend();
}

async function handleSaveData() {
    if (bvpLog.length === 0 && hrLog.length === 0) {
        alert("No data to save.");
        return;
    }

    const zip = new JSZip();

    let bvpCsv = "timestamp,value\n";
    bvpLog.forEach(row => {
        bvpCsv += `${row[0]},${row[1].toFixed(6)}\n`;
    });
    zip.file("bvp.csv", bvpCsv);

    let hrCsv = "timestamp,hr,sqi\n";
    hrLog.forEach(row => {
        hrCsv += `${row[0]},${row[1].toFixed(2)},${row[2].toFixed(4)}\n`;
    });
    zip.file("hr.csv", hrCsv);

    try {
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const sec = String(now.getSeconds()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}T${hour}-${min}-${sec}`;
        a.download = `vital_monitor_data_${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert("Failed to zip data: " + e.message);
    }
}

async function startSystem() {
    if (isCameraSwitching) return;
    isCameraSwitching = true;
    if (stream) {
        currentFacingMode = (currentFacingMode === 'user' && hasBackCamera) ? 'environment' : 'user';
        stream.getTracks().forEach(track => track.stop());
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    try {
        largeStartBtn.style.display = 'none'; 

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: currentFacingMode,
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
            },
            audio: false
        });
        stream.facingMode = currentFacingMode;
        if (!isRunning) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            hasBackCamera = videoDevices.length > 1 || videoDevices.some(device => 
                /back|rear|environment/i.test(device.label)
            );
            console.log("hasBackCamera", hasBackCamera);
        }

        videoElement.srcObject = stream;
        await videoElement.play();

        const vw = videoElement.videoWidth;
        const vh = videoElement.videoHeight;
        const videoContainer = document.getElementById('video-frame');
        const isPortrait = window.innerHeight > window.innerWidth;

        if (isPortrait) {
            videoContainer.style.aspectRatio = "1 / 1";
        } else {
            videoContainer.style.aspectRatio = `${vw} / ${vh}`;
        }
        previewCanvas.width = vw;
        previewCanvas.height = vh;
        overlayCanvas.width = vw;
        overlayCanvas.height = vh;
        if (!isRunning) {
            isRunning = true;
            bvpLog = [];
            hrLog = [];
            lastHrValue = 60; 
            
            lastFrameTime = performance.now();
            lastFpsTime = lastFrameTime;
            frameCount = 0;
            tick();
        }else{
            if(currentCaptureTime>0){
                currentCaptureTime = Date.now()-dval*1000;
            }
        }

    } catch (err) {
        largeStartBtn.style.display = 'block'; 
    } finally {
        isCameraSwitching = false;
    }
}

const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

function tick() {
    if (!isRunning) return;
    const now = performance.now();
    const elapsed = now - lastFrameTime;

    if (elapsed >= FRAME_INTERVAL) {
        lastFrameTime = now - (elapsed % FRAME_INTERVAL);
        
        frameCount++;
        if (elFrame) elFrame.innerText = frameCount;
        if (frameCount % 30 === 0) {
            elFps.innerText = (30/(now - lastFpsTime)*1000).toFixed(1);
            lastFrameCount = frameCount;
            lastFpsTime = now;
        }

        if (frameCount % 60 === 0) {
            inferenceWorker.postMessage({ type: 'export_state' });
        }

        processFrame();
    }
    requestAnimationFrame(tick);
}

const cropCanvas = document.createElement('canvas');
cropCanvas.width = 36;
cropCanvas.height = 36;
const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });

function processFrame() {
    if (videoElement.readyState < 2) return;

    const captureTime = Date.now();

    if (currentCaptureTime>0){
        dval = dval*0.997 + 0.003*(captureTime - currentCaptureTime) / 1000;
        virtualTime += dval*1000;
        virtualTime = virtualTime*0.997 + 0.003*captureTime;
    }else{
        currentCaptureTime = captureTime;
        virtualTime = currentCaptureTime;
    }

    previewCtx.drawImage(videoElement, 0, 0, previewCanvas.width, previewCanvas.height);
    const detections = faceDetector.detectForVideo(videoElement, performance.now());
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (detections.detections.length > 0) {
        lastFaceDetectTime = performance.now(); 

        const det = detections.detections[0];
        let { originX, originY, width, height } = det.boundingBox;

        if (!kfX) {
            kfX = new KalmanFilter1D(originX); kfY = new KalmanFilter1D(originY);
            kfW = new KalmanFilter1D(width); kfH = new KalmanFilter1D(height);
        } else {
            originX = kfX.update(originX); originY = kfY.update(originY);
            width = kfW.update(width); height = kfH.update(height);
        }

        height *= 1.2;
        originY -= height * 0.2; 

        overlayCtx.strokeStyle = "#ff0000be"; 
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(originX, originY, width, height);

        const sx = Math.max(0, originX);
        const sy = Math.max(0, originY);
        const sw = Math.min(width, previewCanvas.width - sx);
        const sh = Math.min(height, previewCanvas.height - sy);

        if (sw > 0 && sh > 0) {
            cropCtx.drawImage(previewCanvas, sx, sy, sw, sh, 0, 0, 36, 36);
            
            cropDisplayCtx.fillStyle = '#000';
            cropDisplayCtx.fillRect(0, 0, cropDisplayCanvas.width, cropDisplayCanvas.height);
            cropDisplayCtx.imageSmoothingEnabled = false;
            const minDim = Math.min(cropDisplayCanvas.width, cropDisplayCanvas.height) * 0.95;
            const cx = (cropDisplayCanvas.width - minDim) / 2;
            const cy = (cropDisplayCanvas.height - minDim) / 2;
            cropDisplayCtx.drawImage(cropCanvas, cx, cy, minDim, minDim);

            const imgData = cropCtx.getImageData(0, 0, 36, 36);
            const inputFloat32 = new Float32Array(36 * 36 * 3);
            for (let i = 0; i < imgData.data.length; i += 4) {
                const idx = i / 4;
                inputFloat32[idx * 3] = imgData.data[i] / 255.0;
                inputFloat32[idx * 3 + 1] = imgData.data[i+1] / 255.0;
                inputFloat32[idx * 3 + 2] = imgData.data[i+2] / 255.0;
            }
            inferenceWorker.postMessage({ 
                type: 'run', 
                payload: { imgData: inputFloat32, dtVal: dval, timestamp: virtualTime } 
            }, [inputFloat32.buffer]);
        }
    } else {
        plotWorker.postMessage({ type: 'bvp_data', payload: 0 });
        elHr.innerText = "-";
        elHr.classList.remove('active');
        currentSqi = 0;
        tryUpdateTrend();
    }
    currentCaptureTime = captureTime;
}

function tryUpdateTrend() {
    const now = Date.now();
    
    if (now - lastTrendUpdateTime < 1000) {
        return;
    }
    lastTrendUpdateTime = now;

    if (isRunning) {
        hrLog.push([now, lastHrValue, currentSqi]);
    }

    const timeSinceFace = performance.now() - lastFaceDetectTime;
    const hasFace = timeSinceFace < 500;
    const isValid = hasFace && (currentSqi > SQI_THRESHOLD);

    plotWorker.postMessage({
        type: 'trend_data',
        payload: { 
            hr: lastHrValue, 
            valid: isValid 
        }
    });
    const videoContainer = document.getElementById('video-frame');
    videoContainer.style.cursor = 'pointer';

    videoContainer.addEventListener('click', () => {
        if (!isRunning || !hasBackCamera) return;
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        startSystem();
    });
}

init();

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === 'hidden') {
        if (isRunning) {
            isRunning = false;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
            }
            if (videoElement) {
                videoElement.pause();
                videoElement.srcObject = null;
            }
            largeStartBtn.style.display = 'block';
            largeStartBtn.innerText = "Resume"; 
            largeStartBtn.disabled = false;
        }
    }
});