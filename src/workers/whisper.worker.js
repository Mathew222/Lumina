import { pipeline, env } from '@xenova/transformers';

/**
 * OFFLINE CONFIGURATION
 * We have downloaded the model files to `public/models/whisper-base.en`.
 * In the built app/dev server, this is served at `/models/whisper-base.en`.
 * 
 * We must enable local models (technically "relative URL" models) 
 * but since we are in browser environment, Transformers.js treats paths as URLs.
 * 
 * IMPORTANT: `allowLocalModels` usually refers to Node.js FS access.
 * We want to disable FS access (fails in Electron renderer) and rely on fetch.
 */
// Enable local models (required for local_files_only: true)
env.allowLocalModels = true;
env.useBrowserCache = false; // We can use cache if we want, but local files are fast. Let's keep it false for dev.

let transcriber = null;

const init = async () => {
    try {
        console.log('[Worker] Loading local model from: models/whisper-base.en');
        self.postMessage({ type: 'debug', message: 'Loading Offline Model...' });

        // Use absolute path from root (public folder) to ensure it's treated as a URL, not a HF ID
        // The models are at %PUBLIC%/models/whisper-base.en, so we access via /models/whisper-base.en
        transcriber = await pipeline('automatic-speech-recognition', '/models/whisper-base.en', {
            local_files_only: true, // Optional: Force it to not even try remote if this fails
        });

        console.log('[Worker] Model loaded successfully');
        self.postMessage({ type: 'debug', message: 'Offline Model Ready!' });
        self.postMessage({ type: 'ready' });
    } catch (error) {
        console.error('[Worker] Fatal Error:', error);
        self.postMessage({ type: 'error', error: "Model Load Failed: " + error.message });
    }
};

self.onmessage = async (event) => {
    const { type, audio } = event.data;

    if (type === 'init') {
        await init();
    } else if (type === 'transcribe') {
        if (!transcriber) return;
        try {
            const output = await transcriber(audio, {
                language: 'english',
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5,
            });
            self.postMessage({ type: 'result', text: output.text });
        } catch (error) {
            console.error('[Worker] Inference error', error);
        }
    }
};
