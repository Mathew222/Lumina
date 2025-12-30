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

        // Log worker context info
        console.log('[Worker] self.location:', self.location);
        console.log('[Worker] self.location.origin:', self.location.origin);
        console.log('[Worker] self.location.href:', self.location.href);

        // Try simple relative path first
        const P_MODEL_PATH = 'whisper-base.en';

        console.log(`[Worker] Attempting to load model from: ${P_MODEL_PATH}`);
        self.postMessage({ type: 'debug', message: `Model path: ${P_MODEL_PATH}` });

        transcriber = await pipeline('automatic-speech-recognition', P_MODEL_PATH, {
            local_files_only: false,
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
            
            // Calculate actual duration for optimal chunk_length_s
            const durationSeconds = audio.length / 16000;
            const chunkLength = Math.max(1, Math.min(30, Math.ceil(durationSeconds * 1.2))); // Slightly larger for context
            
            // Optimized settings for faster live transcription
            const output = await transcriber(audio, {
                language: 'english',
                task: 'transcribe',
                chunk_length_s: chunkLength,
                return_timestamps: false,
                // Faster settings for live transcription
                temperature: 0.0,
                // Reduced beam search for speed
                beam_size: 3,      // Reduced from 5 for faster processing
                best_of: 1,         // Reduced from 3 for speed
                // Better for live transcription
                no_speech_threshold: 0.4,
                logprob_threshold: -1.2,
            });
            
            const end = performance.now();
            const duration = (end - start).toFixed(0);

            if (output && output.text) {
                const text = output.text.trim();
                self.postMessage({ type: 'debug', message: `Done in ${duration}ms (${durationSeconds.toFixed(1)}s audio): "${text}"` });
                self.postMessage({ type: 'result', text: text });
            } else {
                self.postMessage({ type: 'debug', message: `No text in output after ${duration}ms` });
            }
        } catch (error) {
            console.error('[Worker] Inference error', error);
            self.postMessage({ type: 'error', error: "Inference failed: " + error.message });
        }
    }
};
