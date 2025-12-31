console.log("[Worker] Script loaded and executing...");
import { pipeline, env } from '@xenova/transformers';

/**
 * OFFLINE CONFIGURATION
 * Configure transformers.js to use local models only
 */
env.allowLocalModels = true;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = '/'; // WASM files are in root public/

// For local model loading, we need to set the local path and enable local models
// Don't use remoteHost as it causes path duplication issues
env.localModelPath = '/models/';  // Base path for local models
env.allowRemoteModels = false;    // Disable remote fetching entirely

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
            '/models/whisper-base.en/encoder_model_quantized.onnx',
            '/models/whisper-base.en/decoder_model_quantized.onnx',
            '/models/whisper-base.en/decoder_model_merged_quantized.onnx',
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

        // Use just the model name since localModelPath is set to /models/
        const P_MODEL_PATH = 'whisper-base.en';

        console.log(`[Worker] Attempting to load model from: ${P_MODEL_PATH}`);
        self.postMessage({ type: 'debug', message: `Model path: ${P_MODEL_PATH}` });

        transcriber = await pipeline('automatic-speech-recognition', P_MODEL_PATH, {
            local_files_only: true,  // Only use local files from localModelPath
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
        // Reduced logging for performance
        // self.postMessage({ type: 'debug', message: `Processing ${audio.length} samples...` });

        if (!transcriber) {
            self.postMessage({ type: 'error', error: "Transcriber not initialized!" });
            return;
        }

        try {
            const start = performance.now();

            // Calculate actual duration for optimal chunk_length_s
            const durationSeconds = audio.length / 16000;
            const chunkLength = Math.max(0.5, Math.min(30, Math.ceil(durationSeconds))); // Match actual duration

            // Accuracy-optimized settings for refinement (not real-time)
            const output = await transcriber(audio, {
                language: 'english',
                task: 'transcribe',
                chunk_length_s: 30,           // Longer chunks for better context
                return_timestamps: false,
                // Accuracy-focused settings
                temperature: 0.0,             // Deterministic output
                beam_size: 5,                 // More beams = better accuracy
                best_of: 3,                   // Multiple candidates
                // Standard thresholds for quality
                no_speech_threshold: 0.6,     // Standard threshold
                logprob_threshold: -1.0,      // Standard threshold
            });

            const end = performance.now();
            const duration = (end - start).toFixed(0);

            // Handle different output formats
            let text = '';
            if (typeof output === 'string') {
                text = output;
            } else if (output && output.text) {
                text = output.text;
            } else if (output && output.transcription) {
                text = output.transcription;
            }

            const trimmed = text.trim();

            if (trimmed.length > 0) {
                // Reduced logging for performance - only send result
                self.postMessage({ type: 'result', text: trimmed });
            } else {
                // Don't log empty results - just send empty
                self.postMessage({ type: 'result', text: '' });
            }
        } catch (error) {
            console.error('[Worker] Inference error', error);
            self.postMessage({ type: 'error', error: "Inference failed: " + error.message });
        }
    }
};
