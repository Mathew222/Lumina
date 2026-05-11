console.log("[Worker] Script loaded and executing...");
import { pipeline, env } from '@xenova/transformers';

/**
 * OFFLINE CONFIGURATION
 * Configure transformers.js to use local models only
 */
env.allowLocalModels = true;
env.useBrowserCache = false;

// Resolve the app root (origin / base) from the worker's location.
// The worker lives at one of:
//   DEV:  http://localhost:5173/src/workers/whisper.worker.js  → root = http://localhost:5173/
//   PROD: file:///…/dist/assets/whisper.worker-XYZ.js          → root = file:///…/dist/
const workerHref = self.location.href;
let appRoot;
try {
    const srcIdx = workerHref.indexOf('/src/');
    if (srcIdx !== -1) {
        appRoot = workerHref.slice(0, srcIdx + 1); // e.g. http://localhost:5173/
    } else {
        // Production: worker lives in /dist/assets/ — go up two levels to /dist/
        appRoot = new URL('../../', workerHref).href;
    }
} catch (_) {
    appRoot = new URL('.', workerHref).href;
}

const WORKER_BASE_URL = new URL('.', workerHref);
env.backends.onnx.wasm.wasmPaths = WORKER_BASE_URL.href;

// Models live in `public/models/` which is served from the app root.
env.localModelPath = appRoot + 'models/';
env.allowRemoteModels = false; // Disable remote fetching entirely

console.log('[Worker] Resolved localModelPath:', env.localModelPath);

let transcriber = null;
let isBusy = false; // Prevent queuing multiple transcriptions

const init = async () => {
    try {
        console.log('[Worker] Loading model...');
        self.postMessage({ type: 'debug', message: 'Loading Model...' });

        // Use just the model name since localModelPath points at `.../models/`
        const P_MODEL_PATH = 'whisper-medium.en';

        transcriber = await pipeline('automatic-speech-recognition', P_MODEL_PATH, {
            local_files_only: true,
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
        if (!transcriber) {
            self.postMessage({ type: 'error', error: "Transcriber not initialized!" });
            return;
        }

        // Drop the request if we're already transcribing — prevents piling up
        if (isBusy) {
            return;
        }
        isBusy = true;

        try {
            const durationSeconds = audio.length / 16000;
            // Match chunk_length_s to actual audio so Whisper doesn't pad unnecessarily
            const chunkLength = Math.max(1, Math.min(30, Math.ceil(durationSeconds)));

            // Speed-optimised settings: greedy decode is ~3x faster than beam search
            // and still very accurate for short utterances (< 10s)
            const output = await transcriber(audio, {
                language: 'english',
                task: 'transcribe',
                chunk_length_s: chunkLength,
                return_timestamps: false,
                // Greedy decode — fastest, still accurate
                temperature: 0.0,
                num_beams: 1,
                // Keep quality gates
                no_speech_threshold: 0.3,
                logprob_threshold: -0.5,
            });

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
            self.postMessage({ type: 'result', text: trimmed });
        } catch (error) {
            console.error('[Worker] Inference error', error);
            self.postMessage({ type: 'error', error: "Inference failed: " + error.message });
        } finally {
            isBusy = false;
        }
    }
};
