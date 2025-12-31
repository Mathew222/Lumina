console.log("[Vosk Worker] Script loaded and executing...");

// Import Vosk from the public directory
// Note: importScripts only works in non-module workers
let voskLoaded = false;
try {
    importScripts('/vosk/vosk.js');
    console.log('[Vosk Worker] Vosk library loaded via importScripts');
    voskLoaded = true;
} catch (e) {
    console.error('[Vosk Worker] Failed to load vosk.js:', e);
    self.postMessage({ type: 'error', error: `Failed to load Vosk library: ${e.message}` });
}

let model = null;
let recognizer = null;
const SAMPLE_RATE = 16000;

// Get createModel function from exports
const getCreateModel = () => {
    if (typeof exports !== 'undefined' && exports.createModel) {
        return exports.createModel;
    }
    if (typeof Vosk !== 'undefined' && Vosk.createModel) {
        return Vosk.createModel;
    }
    if (typeof self !== 'undefined' && self.Vosk && self.Vosk.createModel) {
        return self.Vosk.createModel;
    }
    if (typeof globalThis !== 'undefined' && globalThis.Vosk && globalThis.Vosk.createModel) {
        return globalThis.Vosk.createModel;
    }
    return null;
};

const init = async () => {
    if (!voskLoaded) {
        self.postMessage({ type: 'error', error: 'Vosk library not loaded' });
        return;
    }

    try {
        console.log('[Vosk Worker] Starting initialization...');
        self.postMessage({ type: 'debug', message: 'Loading Vosk Model...' });

        // Vosk model URL - use the tar.gz archive (vosk-browser expects tar.gz format)
        const MODEL_URL = self.location.origin + '/vosk-model-small-en-us-0.15.tar.gz';

        console.log(`[Vosk Worker] Attempting to load model from: ${MODEL_URL}`);
        self.postMessage({ type: 'debug', message: `Model path: ${MODEL_URL}` });

        // Verify the tar.gz file exists
        try {
            const response = await fetch(MODEL_URL, { method: 'HEAD' });
            if (!response.ok) {
                throw new Error(`Model archive not found: ${MODEL_URL} (${response.status})`);
            }
            console.log('[Vosk Worker] ✓ Model archive found');
        } catch (e) {
            throw new Error(`Model archive not accessible: ${e.message}`);
        }

        // Get createModel function
        const createModel = getCreateModel();

        if (!createModel) {
            // Debug: log what's available
            const debugInfo = {
                hasExports: typeof exports !== 'undefined',
                exportsKeys: typeof exports !== 'undefined' ? Object.keys(exports) : [],
                hasVosk: typeof Vosk !== 'undefined',
                hasSelfVosk: typeof self !== 'undefined' && typeof self.Vosk !== 'undefined',
                hasGlobalThis: typeof globalThis !== 'undefined' && typeof globalThis.Vosk !== 'undefined'
            };
            console.error('[Vosk Worker] ✗ createModel not found. Debug info:', debugInfo);
            self.postMessage({ type: 'debug', message: `Debug: ${JSON.stringify(debugInfo)}` });
            throw new Error('Vosk createModel not found. Make sure vosk.js is loaded correctly.');
        }

        console.log('[Vosk Worker] ✓ Found createModel function');
        self.postMessage({ type: 'debug', message: 'Creating model...' });

        // Use createModel with the full URL - this is the recommended approach
        try {
            model = await createModel(MODEL_URL, 0);
            console.log('[Vosk Worker] ✓ Model created successfully');
        } catch (modelError) {
            console.error('[Vosk Worker] createModel error:', modelError);

            // Check if model was partially created despite error
            if (model && model.ready) {
                console.log('[Vosk Worker] Model is ready despite error');
            } else {
                throw modelError;
            }
        }

        if (!model) {
            throw new Error('createModel returned null/undefined');
        }

        console.log('[Vosk Worker] Model object created');
        self.postMessage({ type: 'debug', message: 'Model created, initializing recognizer...' });

        // Create a recognizer for 16kHz audio
        recognizer = new model.KaldiRecognizer(SAMPLE_RATE);
        console.log('[Vosk Worker] ✓ Recognizer created');

        // Set up event listeners for results
        recognizer.on('result', (message) => {
            if (message && message.result) {
                try {
                    const result = typeof message.result === 'string'
                        ? JSON.parse(message.result)
                        : message.result;
                    if (result.text && result.text.trim().length > 0) {
                        self.postMessage({ type: 'result', text: result.text });
                    }
                } catch (e) {
                    console.error('[Vosk Worker] Error parsing result:', e);
                }
            }
        });

        recognizer.on('partialresult', (message) => {
            if (message && message.result) {
                try {
                    const result = typeof message.result === 'string'
                        ? JSON.parse(message.result)
                        : message.result;
                    if (result.partial && result.partial.trim().length > 0) {
                        self.postMessage({ type: 'partial', text: result.partial });
                    }
                } catch (e) {
                    console.error('[Vosk Worker] Error parsing partial:', e);
                }
            }
        });

        self.postMessage({ type: 'debug', message: 'Vosk Model Ready!' });
        self.postMessage({ type: 'ready' });
    } catch (error) {
        console.error('[Vosk Worker] Init Failed', error);
        self.postMessage({ type: 'debug', message: `INIT FAILED: ${error.message}` });
        self.postMessage({ type: 'error', error: `Init: ${error.message}` });
    }
};

self.onmessage = async (event) => {
    const { type, audio } = event.data;

    if (type === 'init') {
        await init();
    } else if (type === 'transcribe') {
        if (!recognizer) {
            self.postMessage({ type: 'error', error: "Recognizer not initialized!" });
            return;
        }

        if (!audio || audio.length === 0) {
            self.postMessage({ type: 'error', error: "Empty audio buffer!" });
            return;
        }

        try {
            // Ensure audio is Float32Array
            let audioData = audio;
            if (!(audio instanceof Float32Array)) {
                audioData = new Float32Array(audio);
            }

            // Vosk processes audio in chunks - send directly to recognizer
            // This is very low latency as it processes incrementally
            recognizer.acceptWaveformFloat(audioData, SAMPLE_RATE);

            // Request final result if needed (for end of utterance)
            // For continuous recognition, we rely on partial results
        } catch (error) {
            console.error('[Vosk Worker] Processing error', error);
            self.postMessage({ type: 'error', error: "Processing failed: " + error.message });
        }
    } else if (type === 'finalize') {
        // Request final result for current utterance
        if (recognizer) {
            recognizer.retrieveFinalResult();
        }
    }
};
