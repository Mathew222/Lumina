console.log("[Vosk Worker] Script loaded and executing...");

// Import Vosk from the public directory
// Note: importScripts only works in non-module workers
try {
    importScripts('/vosk/vosk.js');
    console.log('[Vosk Worker] Vosk library loaded via importScripts');
} catch (e) {
    console.error('[Vosk Worker] Failed to load vosk.js:', e);
    self.postMessage({ type: 'error', error: `Failed to load Vosk library: ${e.message}` });
}

let model = null;
let recognizer = null;
const SAMPLE_RATE = 16000;

const init = async () => {
    try {
        console.log('[Vosk Worker] Starting initialization...');
        self.postMessage({ type: 'debug', message: 'Loading Vosk Model...' });

        // Vosk model URL - use relative path from public directory
        // Vosk will load the model files directly from the directory
        const MODEL_URL = '/vosk-model-small-en-us-0.15';
        
        // Note: Vosk might try to download/extract if it thinks it's a remote URL
        // Make sure the model is already extracted in public/
        
        console.log(`[Vosk Worker] Attempting to load model from: ${MODEL_URL}`);
        self.postMessage({ type: 'debug', message: `Model path: ${MODEL_URL}` });
        
        // Verify model directory exists by checking for key files
        const requiredFiles = [
            'conf/model.conf',
            'am/final.mdl',
            'graph/HCLr.fst'
        ];
        
        for (const file of requiredFiles) {
            try {
                const testUrl = `${MODEL_URL}/${file}`;
                const response = await fetch(testUrl);
                if (!response.ok) {
                    throw new Error(`Required model file not found: ${file} (${response.status})`);
                }
                console.log(`[Vosk Worker] ✓ Found ${file}`);
            } catch (e) {
                console.error(`[Vosk Worker] ✗ Missing required file: ${file}`, e);
                throw new Error(`Model file missing: ${file}. Make sure the model is fully extracted in public/vosk-model-small-en-us-0.15/`);
            }
        }
        
        console.log('[Vosk Worker] ✓ All required model files found');

        // Debug: Check what's available after importScripts
        console.log('[Vosk Worker] Checking for Vosk exports...', {
            hasExports: typeof exports !== 'undefined',
            exportsKeys: typeof exports !== 'undefined' ? Object.keys(exports) : [],
            hasVosk: typeof Vosk !== 'undefined',
            hasSelfVosk: typeof self !== 'undefined' && typeof self.Vosk !== 'undefined',
            hasGlobalThis: typeof globalThis !== 'undefined' && typeof globalThis.Vosk !== 'undefined'
        });

        // Get Model class directly - this bypasses createModel's promise that rejects on archive errors
        let ModelClass = null;
        
        // Try exports first (CommonJS/UMD) - this is how Vosk exports it
        if (typeof exports !== 'undefined' && exports.Model) {
            ModelClass = exports.Model;
            console.log('[Vosk Worker] ✓ Found Model class in exports');
        } 
        // Try global Vosk object
        else if (typeof Vosk !== 'undefined' && Vosk.Model) {
            ModelClass = Vosk.Model;
            console.log('[Vosk Worker] ✓ Found Model class in Vosk');
        } 
        // Try self.Vosk
        else if (typeof self !== 'undefined' && self.Vosk && self.Vosk.Model) {
            ModelClass = self.Vosk.Model;
            console.log('[Vosk Worker] ✓ Found Model class in self.Vosk');
        }
        // Try globalThis
        else if (typeof globalThis !== 'undefined' && globalThis.Vosk && globalThis.Vosk.Model) {
            ModelClass = globalThis.Vosk.Model;
            console.log('[Vosk Worker] ✓ Found Model class in globalThis.Vosk');
        }
        
        if (!ModelClass) {
            // Debug: log what's available
            const debugInfo = {
                hasExports: typeof exports !== 'undefined',
                exportsKeys: typeof exports !== 'undefined' ? Object.keys(exports) : [],
                hasVosk: typeof Vosk !== 'undefined',
                hasSelfVosk: typeof self !== 'undefined' && typeof self.Vosk !== 'undefined',
                hasGlobalThis: typeof globalThis !== 'undefined' && typeof globalThis.Vosk !== 'undefined'
            };
            console.error('[Vosk Worker] ✗ Model class not found. Debug info:', debugInfo);
            self.postMessage({ type: 'debug', message: `Debug: ${JSON.stringify(debugInfo)}` });
            throw new Error('Vosk Model class not found. Make sure vosk.js is loaded correctly.');
        }
        
        // Use direct Model constructor to bypass createModel's promise rejection on archive errors
        // The archive extraction error happens but shouldn't prevent the model from loading
        console.log('[Vosk Worker] Creating model directly (bypassing createModel to avoid archive error)...');
        self.postMessage({ type: 'debug', message: 'Creating model directly...' });
        
        try {
            // Create model directly - this avoids the createModel promise that might reject on archive error
            model = new ModelClass(MODEL_URL, 0);
            console.log('[Vosk Worker] Model instance created, waiting for load event...');
            
            // Wait for load event manually - this gives us more control
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Model load timeout after 90 seconds'));
                }, 90000);
                
                // Listen for load event
                const loadHandler = (message) => {
                    clearTimeout(timeout);
                    model.removeEventListener('load', loadHandler);
                    model.removeEventListener('error', errorHandler);
                    
                    if (message && message.detail) {
                        const loadMessage = message.detail;
                        if (loadMessage.result === true) {
                            console.log('[Vosk Worker] ✓ Model loaded successfully (load event: result=true)');
                            resolve();
                        } else {
                            console.error('[Vosk Worker] ✗ Model load event returned false:', loadMessage);
                            reject(new Error('Model load event returned false'));
                        }
                    } else if (message && message.result !== undefined) {
                        // Handle direct message format
                        if (message.result === true) {
                            console.log('[Vosk Worker] ✓ Model loaded successfully');
                            resolve();
                        } else {
                            reject(new Error('Model load returned false'));
                        }
                    } else {
                        // Assume success if we get a load event
                        console.log('[Vosk Worker] ✓ Model load event received');
                        resolve();
                    }
                };
                
                const errorHandler = (event) => {
                    clearTimeout(timeout);
                    model.removeEventListener('load', loadHandler);
                    model.removeEventListener('error', errorHandler);
                    
                    const errorMsg = event.detail?.error || event.error || 'Unknown error';
                    console.error('[Vosk Worker] Model error event:', errorMsg);
                    
                    // If it's an archive error, we might still be able to use the model
                    if (errorMsg.includes('archive') || errorMsg.includes('Unrecognized') || errorMsg.includes('tar.gz')) {
                        console.warn('[Vosk Worker] Archive extraction error (expected for local models) - checking if model is usable...');
                        // Wait a bit and check if model.ready is true
                        setTimeout(() => {
                            if (model && model.ready) {
                                console.log('[Vosk Worker] ✓ Model is ready despite archive error');
                                resolve();
                            } else {
                                reject(new Error(`Archive extraction error: ${errorMsg}. Model files should be accessible at ${MODEL_URL}`));
                            }
                        }, 2000);
                    } else {
                        reject(new Error(`Model error: ${errorMsg}`));
                    }
                };
                
                // Use both 'on' method and addEventListener
                if (model.on) {
                    model.on('load', loadHandler);
                    model.on('error', errorHandler);
                }
                model.addEventListener('load', loadHandler);
                model.addEventListener('error', errorHandler);
            });
            
            console.log('[Vosk Worker] ✓ Model loaded and ready');
            self.postMessage({ type: 'debug', message: 'Model loaded successfully' });
        } catch (loadError) {
            console.error('[Vosk Worker] Model loading failed:', loadError);
            throw new Error(`Model failed to load: ${loadError.message}`);
        }
        
        if (!model) {
            throw new Error('createModel returned null/undefined');
        }
        
        console.log('[Vosk Worker] Model object created, waiting for ready state...');
        self.postMessage({ type: 'debug', message: 'Model object created, checking ready state...' });
        
        // Wait for model to be ready
        if (!model.ready) {
            console.log('[Vosk Worker] Model not ready, waiting for ready event...');
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Model ready timeout after 30 seconds'));
                }, 30000);
                
                model.addEventListener('ready', () => {
                    clearTimeout(timeout);
                    console.log('[Vosk Worker] Model ready event received');
                    resolve();
                }, { once: true });
                
                // Also listen for errors
                model.addEventListener('error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`Model error: ${e.message || 'Unknown error'}`));
                }, { once: true });
            });
        }
        
        console.log('[Vosk Worker] Model is ready');
        
        // Create a recognizer for 16kHz audio
        recognizer = new model.KaldiRecognizer(SAMPLE_RATE);
        
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
