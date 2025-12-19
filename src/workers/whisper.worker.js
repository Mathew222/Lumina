console.log("[Worker] Script loaded and executing...");
import { pipeline, env } from '@xenova/transformers';

/**
 * OFFLINE CONFIGURATION
 */
env.allowLocalModels = true; // Enable local files (required for local_files_only: true)
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = '/'; // WASM files are in root public/

let transcriber = null;

const init = async () => {
    // Spy on fetch
    const originalFetch = self.fetch;
    self.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        console.log(`[Worker Fetch Spy] Requesting: ${url}`);
        const response = await originalFetch(input, init);
        if (!response.ok) {
            console.error(`[Worker Fetch Spy] 404/Error for: ${url}`);
        }
        // Check for HTML (404 disguised as 200)
        const clone = response.clone();
        const text = await clone.text();
        if (text.trim().startsWith('<')) {
            console.error(`[Worker Fetch Spy] HTML detected for: ${url}`);
            self.postMessage({ type: 'debug', message: `FAIL: ${url} returned HTML` });
        }
        return response;
    };

    try {
        console.log('[Worker] Loading model...');
        self.postMessage({ type: 'debug', message: 'Loading Model...' });

        // DEBUG: Verify critical files exist
        const filesToCheck = [
            '/models/whisper-base.en/config.json',
            '/models/whisper-base.en/tokenizer.json',
            '/models/whisper-base.en/vocab.json',
            '/models/whisper-base.en/preprocessor_config.json',
            '/models/whisper-base.en/special_tokens_map.json',
            '/ort-wasm-simd.wasm'
        ];

        for (const url of filesToCheck) {
            try {
                const resp = await fetch(url);
                const type = resp.headers.get('content-type');
                if (!resp.ok || (type && type.includes('text/html'))) {
                    throw new Error(`File not found (HTML fallback): ${url}`);
                }
                console.log(`[Worker] Checked ${url}: OK`);
            } catch (e) {
                throw new Error(`Missing request file: ${url} error: ${e.message}`);
            }
        }

        // Use absolute URL to prevent double-pathing (e.g. /models/models/...)
        const P_MODEL_PATH = new URL('/models/whisper-base.en', self.location.origin).toString();

        console.log(`[Worker] Initializing pipeline with path: ${P_MODEL_PATH}`);

        // PRE-FLIGHT CHECK: Verify this URL actually works
        try {
            const checkUrl = P_MODEL_PATH + '/config.json';
            const checkResp = await fetch(checkUrl);
            const checkText = await checkResp.text();
            if (checkText.trim().startsWith('<')) {
                throw new Error(`PRE-FLIGHT FAIL: ${checkUrl} returned HTML (404). Check your public folder structure!`);
            }
            console.log(`[Worker] Pre-flight OK: Found config.json (${checkText.length} bytes)`);
        } catch (e) {
            self.postMessage({ type: 'error', error: e.message });
            throw e;
        }

        transcriber = await pipeline('automatic-speech-recognition', P_MODEL_PATH, {
            local_files_only: false, // Allow fetching from "URL" (which is local)
        });

        console.log('[Worker] Model loaded successfully');
        self.postMessage({ type: 'debug', message: 'Model Ready!' });
        self.postMessage({ type: 'ready' });
    } catch (error) {
        console.error('[Worker] Init Failed', error);
        self.postMessage({ type: 'debug', message: `INIT FAILED: ${error.message}` });
        self.postMessage({ type: 'error', error: `Init: ${error.message}` });
    }
};

self.onmessage = async (event) => {
    const { type, audio } = event.data;

    if (type === 'init') {
        await init();
    } else if (type === 'transcribe') {
        self.postMessage({ type: 'debug', message: `Processing ${audio.length} samples...` });

        if (!transcriber) {
            self.postMessage({ type: 'error', error: "Transcriber not initialized!" });
            return;
        }

        try {
            const start = performance.now();
            const output = await transcriber(audio, {
                language: 'english',
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5,
            });
            const end = performance.now();

            const duration = (end - start).toFixed(0);
            self.postMessage({ type: 'debug', message: `Done in ${duration}ms: "${output.text}"` });
            self.postMessage({ type: 'result', text: output.text });
        } catch (error) {
            console.error('[Worker] Inference error', error);
            self.postMessage({ type: 'error', error: "Inference failed: " + error.message });
        }
    }
};
