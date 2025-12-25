# FacePhys Demo
<img src="./resource/t.svg" alt="FacePhys Logo"/>

**Live Demo:** https://kegangwangccnu.github.io/FacePhys-Demo/
> *Note: A proxy might be required in restricted network regions.*
## Overview

FacePhys Demo is a browser-based remote photoplethysmography (rPPG) monitor. It uses State Space Models (SSMs) to extract heart rate and heart rate variability from facial video feeds via a standard webcam.

The application runs inference locally using LiteRT and WebAssembly. It is designed for edge environments, offering low latency (~5ms) with a model size of approximately 4MB.

## Privacy

* **Zero Data Upload:** All inference occurs on-device.
* **No Cloud Processing:** Video data and physiological signals are never transmitted to a server.
* **Offline Capable:** The application functions without an internet connection once loaded.

## Features

* **State Space Models:** Models heart dynamics as continuous-time controlled ODEs to handle irregular sampling.
* **Multi-threaded Architecture:** Uses Web Workers for inference, PSD calculation, and plotting to maintain UI responsiveness.
* **Visualization:** Displays real-time attention heatmaps, 3D state trajectories, and BVP/PSD waveforms.
* **Interface:** Windows 95/98 style UI.

## Installation (PWA)

This project is a Progressive Web App (PWA) and can be installed as a standalone application.

### Desktop (Chrome / Edge)
1.  Open the [website](https://kegangwangccnu.github.io/FacePhys-Demo/).
2.  Click the Install icon in the address bar.

### Mobile (Android / iOS)
Scan the QR code below to access the application on your mobile device:

<img width="151" height="170" alt="QRcode" src="https://github.com/user-attachments/assets/668f86de-644e-4d17-a6b3-3b00a945894f" />

#### Android
1.  Open the scanned link in Chrome.
2.  Open the menu and select **Add to Home screen** or **Install App**.

#### iOS
1.  Open the scanned link in Safari.
2.  Tap the Share button and select **Add to Home Screen**.

## License & Privacy Protocol

This project is licensed under the **MIT License** with a **Privacy Addendum**.

### The MIT License (MIT)
Copyright (c) 2025 Kegang Wang

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

### Privacy Protection Addendum
**By using or distributing this software, you agree to the following additional terms:**

1.  **Strict Local Processing:** All biometric inference and signal processing must be performed exclusively on the local device. You must **NOT** transmit, upload, or stream user video feeds or physiological metrics to any external server or cloud service for any purpose (storage, analytics, or remote processing).
2.  **Consent Requirement:** You shall not use this Software to collect information or physiological data from any individual without their explicit consent.
3.  **No Backdoors in Distribution:** If you redistribute or modify this code, you must maintain these strict local-processing guarantees. You are prohibited from modifying the software to surreptitiously collect or transmit user data.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
