let bvpCtx = null;
let bvpWidth = 0;
let bvpHeight = 0;
const BVP_BUFFER_LEN = 225;
let bvpBuffer = new Float32Array(BVP_BUFFER_LEN);
let bvpCursor = 0;
const BVP_Y_MIN = -1.5;
const BVP_Y_MAX = 2.0;
const SCAN_GAP = 30; 

let psdCtx = null;
let psdWidth = 0;
let psdHeight = 0;
const PSD_Y_MIN = 0;
const PSD_Y_MAX = 6000; 
const PSD_X_MIN = 0.5; 
const PSD_X_MAX = 3.0; 

let trendCtx = null;
let trendWidth = 0;
let trendHeight = 0;
const TREND_MAX_POINTS = 300; 
let trendBuffer = []; 
const TREND_Y_MIN = 40;
const TREND_Y_MAX = 180;

let dpr = 1;

self.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        dpr = payload.dpr || 1;

        const bCanvas = payload.bvpCanvas;
        bvpWidth = payload.bvpWidth;
        bvpHeight = payload.bvpHeight;
        bvpCtx = bCanvas.getContext('2d');
        bvpCtx.scale(dpr, dpr);
        bvpBuffer.fill(0);

        const pCanvas = payload.psdCanvas;
        psdWidth = payload.psdWidth;
        psdHeight = payload.psdHeight;
        psdCtx = pCanvas.getContext('2d');
        psdCtx.scale(dpr, dpr);
        
        if (payload.trendCanvas) {
            const tCanvas = payload.trendCanvas;
            trendWidth = payload.trendWidth;
            trendHeight = payload.trendHeight;
            trendCtx = tCanvas.getContext('2d');
            trendCtx.scale(dpr, dpr);
        }

        drawBVP();
        drawPSD([], [], 0); 
        drawTrend();

    } else if (type === 'bvp_data') {
        bvpBuffer[bvpCursor] = payload;
        bvpCursor = (bvpCursor + 1) % BVP_BUFFER_LEN;
        drawBVP();

    } else if (type === 'psd_data') {
        const { psd, freq, peakIdx } = payload;
        drawPSD(psd, freq, peakIdx);

    } else if (type === 'resize_trend') {
        const { width, height, dpr: newDpr } = payload;
        if (trendCtx) {
            dpr = newDpr;
            trendWidth = width;
            trendHeight = height;
            trendCtx.canvas.width = width * dpr;
            trendCtx.canvas.height = height * dpr;
            trendCtx.scale(dpr, dpr);
            drawTrend();
        }

    } else if (type === 'trend_data') {
        const { hr, valid } = payload;
        trendBuffer.push({ hr, valid });
        if (trendBuffer.length > TREND_MAX_POINTS) {
            trendBuffer.shift();
        }
        drawTrend();
    }
};

function drawBVP() {
    if (!bvpCtx) return;

    bvpCtx.fillStyle = "#000";
    bvpCtx.fillRect(0, 0, bvpWidth, bvpHeight);
    bvpCtx.beginPath();
    bvpCtx.strokeStyle = "#1a1a1a";
    bvpCtx.lineWidth = 2;
    bvpCtx.lineCap = "butt"; 
    bvpCtx.lineJoin = "miter";

    const stepX = bvpWidth / 10;
    for(let x=0; x<bvpWidth; x+=stepX) { bvpCtx.moveTo(x, 0); bvpCtx.lineTo(x, bvpHeight); }
    bvpCtx.stroke();

    const range = BVP_Y_MAX - BVP_Y_MIN;
    const padding = 10;
    const drawH = bvpHeight - 2 * padding;
    const stepW = bvpWidth / BVP_BUFFER_LEN;

    bvpCtx.lineWidth = 2;
    bvpCtx.lineJoin = "round";
    bvpCtx.lineCap = "round";
    bvpCtx.strokeStyle = "#00ff00"; 
    bvpCtx.beginPath();

    const cursorX = bvpCursor * stepW;
    const gapStart = cursorX;
    const gapEnd = cursorX + SCAN_GAP;

    let needMove = true;

    for (let i = 0; i < BVP_BUFFER_LEN; i++) {
        let val = bvpBuffer[i];
        if (val < BVP_Y_MIN) val = BVP_Y_MIN;
        if (val > BVP_Y_MAX) val = BVP_Y_MAX;

        const norm = (val - BVP_Y_MIN) / range;
        const x = i * stepW;
        const y = bvpHeight - padding - (norm * drawH);

        let inGap = false;
        
        if (x >= gapStart && x < gapEnd) {
            inGap = true;
        } 
        else if (gapEnd > bvpWidth && x < (gapEnd - bvpWidth)) {
            inGap = true;
        }

        if (inGap) {
            needMove = true;
            continue; 
        }

        if (needMove) {
            bvpCtx.moveTo(x, y);
            needMove = false;
        } else {
            bvpCtx.lineTo(x, y);
        }
    }
    bvpCtx.stroke();

    bvpCtx.fillStyle = "#000";
    if (gapEnd <= bvpWidth) {
        bvpCtx.fillRect(gapStart, 0, SCAN_GAP, bvpHeight);
    } else {
        bvpCtx.fillRect(gapStart, 0, bvpWidth - gapStart, bvpHeight);
        bvpCtx.fillRect(0, 0, gapEnd - bvpWidth, bvpHeight);
    }

    bvpCtx.beginPath();
    bvpCtx.lineWidth = 1;
    bvpCtx.lineCap = "butt"; 
    
    const sharpX = Math.floor(cursorX) + 0.5;
    
    bvpCtx.moveTo(sharpX, 0);
    bvpCtx.lineTo(sharpX, bvpHeight);
    bvpCtx.strokeStyle = "rgba(200, 255, 200, 0.8)";
    bvpCtx.stroke();
}

function drawPSD(psdData, freqData, peakIdx) {
    if (!psdCtx) return;

    psdCtx.fillStyle = "#000000"; 
    psdCtx.fillRect(0, 0, psdWidth, psdHeight);

    psdCtx.strokeStyle = "#808080"; 
    psdCtx.lineWidth = 1;
    psdCtx.imageSmoothingEnabled = false; 

    psdCtx.font = "10px monospace"; 
    psdCtx.fillStyle = "#c0c0c0";   
    psdCtx.textAlign = "right";

    const paddingBottom = 20;
    const paddingLeft = 10; 
    const paddingRight = 10;
    const paddingTop = 10;

    const graphW = psdWidth - paddingLeft - paddingRight;
    const graphH = psdHeight - paddingBottom - paddingTop;

    const ySteps = [0, 2000, 4000, 6000];
    for (let val of ySteps) {
        const norm = (val - PSD_Y_MIN) / (PSD_Y_MAX - PSD_Y_MIN);
        const y = Math.floor(psdHeight - paddingBottom - (norm * graphH)) + 0.5; 
        
        psdCtx.beginPath();
        psdCtx.moveTo(paddingLeft, y);
        psdCtx.lineTo(psdWidth - paddingRight, y);
        psdCtx.stroke();
    }

    psdCtx.textAlign = "center";
    for (let f = 0.5; f <= 3.0; f += 0.5) {
        const normX = (f - PSD_X_MIN) / (PSD_X_MAX - PSD_X_MIN);
        const x = Math.floor(paddingLeft + (normX * graphW)) + 0.5;
        
        psdCtx.beginPath();
        psdCtx.moveTo(x, psdHeight - paddingBottom);
        psdCtx.lineTo(x, psdHeight - paddingBottom + 4);
        psdCtx.stroke();
        
        psdCtx.fillText(f.toFixed(1), x, psdHeight - 5);
    }

    if (!psdData || psdData.length === 0) return;

    psdCtx.fillStyle = "#00FFFF"; 

    for (let i = 0; i < psdData.length; i++) {
        const f = freqData[i];
        const p = psdData[i];

        if (f < PSD_X_MIN || f > PSD_X_MAX) continue;

        const normX = (f - PSD_X_MIN) / (PSD_X_MAX - PSD_X_MIN);
        let normY = (p - PSD_Y_MIN) / (PSD_Y_MAX - PSD_Y_MIN);
        
        if (normY > 1) normY = 1; 
        if (normY < 0) normY = 0;

        const x = Math.floor(paddingLeft + normX * graphW);
        const y = Math.floor(psdHeight - paddingBottom - normY * graphH);

        psdCtx.fillRect(x, y, 2, 2);
    }

    if (peakIdx !== undefined && peakIdx >= 0 && peakIdx < freqData.length) {
        const peakFreq = freqData[peakIdx];
        const peakVal = psdData[peakIdx];

        if (peakFreq >= PSD_X_MIN && peakFreq <= PSD_X_MAX) {
            const normX = (peakFreq - PSD_X_MIN) / (PSD_X_MAX - PSD_X_MIN);
            let normY = (peakVal - PSD_Y_MIN) / (PSD_Y_MAX - PSD_Y_MIN);
            if(normY > 1) normY = 1;

            const px = Math.floor(paddingLeft + normX * graphW);
            const py = Math.floor(psdHeight - paddingBottom - normY * graphH);

            const pixelSize = 6; 
            psdCtx.fillStyle = "#FF0000"; 
            psdCtx.fillRect(px - pixelSize/2, py - pixelSize/2, pixelSize, pixelSize);

            const text = `${peakFreq.toFixed(2)} Hz`;
            psdCtx.font = "bold 14px monospace"; 
            const textW = psdCtx.measureText(text).width;
            
            psdCtx.fillStyle = "#000080"; 
            psdCtx.fillRect(px - textW/2 - 4, py - 24, textW + 8, 18);
            
            psdCtx.fillStyle = "#FFFF00"; 
            psdCtx.fillText(text, px, py - 11);
        }
    }
}

function drawTrend() {
    if (!trendCtx) return;

    trendCtx.imageSmoothingEnabled = false; 

    trendCtx.fillStyle = "#000000";
    trendCtx.fillRect(0, 0, trendWidth, trendHeight);

    const padding = 20;
    const paddingBottom = 20;
    const graphW = trendWidth; 
    const graphH = trendHeight - padding - paddingBottom;

    trendCtx.lineWidth = 1;
    trendCtx.strokeStyle = "#004000"; 

    const ySteps = [60, 100, 140];
    trendCtx.beginPath();
    for(let val of ySteps) {
        const norm = (val - TREND_Y_MIN) / (TREND_Y_MAX - TREND_Y_MIN);
        const y = Math.floor(trendHeight - paddingBottom - (norm * graphH)) + 0.5; 
        trendCtx.moveTo(0, y);
        trendCtx.lineTo(trendWidth, y);
    }
    
    const stepX = graphW / (TREND_MAX_POINTS - 1);
    for(let i = 0; i < TREND_MAX_POINTS; i += 60) {
        const x = Math.floor(i * stepX) + 0.5;
        trendCtx.moveTo(x, padding);
        trendCtx.lineTo(x, trendHeight - paddingBottom);
    }
    trendCtx.stroke();

    trendCtx.font = "10px monospace"; 
    trendCtx.fillStyle = "#00FF00";        
    trendCtx.textAlign = "center";
    trendCtx.textBaseline = "top";

    for(let i = 0; i <= TREND_MAX_POINTS; i += 60) {
        const x = Math.floor(i * stepX);
        const timeLabel = (i - TREND_MAX_POINTS) + "s";
        if (i === TREND_MAX_POINTS) {
             trendCtx.fillText("0s", x - 10, trendHeight - paddingBottom + 4);
        } else {
             trendCtx.fillText(timeLabel, x, trendHeight - paddingBottom + 4);
        }
    }

    if (trendBuffer.length < 2) return;

    trendCtx.lineWidth = 2; 
    trendCtx.lineJoin = "round"; 

    for (let i = 1; i < trendBuffer.length; i++) {
        const p1 = trendBuffer[i-1];
        const p2 = trendBuffer[i];

        const x1 = Math.floor((i - 1) * stepX) + 0.5;
        const x2 = Math.floor(i * stepX) + 0.5;

        let y1 = trendHeight - paddingBottom - ((p1.hr - TREND_Y_MIN) / (TREND_Y_MAX - TREND_Y_MIN) * graphH);
        let y2 = trendHeight - paddingBottom - ((p2.hr - TREND_Y_MIN) / (TREND_Y_MAX - TREND_Y_MIN) * graphH);

        y1 = Math.floor(Math.max(padding, Math.min(trendHeight - paddingBottom, y1))) + 0.5;
        y2 = Math.floor(Math.max(padding, Math.min(trendHeight - paddingBottom, y2))) + 0.5;

        trendCtx.beginPath();
        
        if (p2.valid && p1.valid) {
            trendCtx.setLineDash([]); 
            trendCtx.lineCap = "round"; 
            trendCtx.strokeStyle = "#00FF00"; 
        } else {
            trendCtx.setLineDash([9, 9]); 
            trendCtx.lineCap = "butt"; 
            trendCtx.strokeStyle = "#a0a0a0ff"; 
        }

        trendCtx.moveTo(x1, y1);
        trendCtx.lineTo(x2, y2);
        trendCtx.stroke();
    }

    trendCtx.setLineDash([]);
}