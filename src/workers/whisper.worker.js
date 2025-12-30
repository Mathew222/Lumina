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

        // Use the full URL path to the model in public/models
        const P_MODEL_PATH = self.location.origin + '/models/whisper-base.en';

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

            // Maximum speed settings for live transcription
            const output = await transcriber(audio, {
                language: 'english',
                task: 'transcribe',
                chunk_length_s: chunkLength,
                return_timestamps: false,
                // Maximum speed settings - prioritize speed over accuracy
                temperature: 0.0,
                // Minimal processing for maximum speed
                beam_size: 1,      // Single beam for fastest processing
                best_of: 1,        // Single candidate
                // Very permissive thresholds to catch all speech quickly
                no_speech_threshold: 0.2,  // Very low to catch more speech
                logprob_threshold: -1.5,   // Very permissive
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
