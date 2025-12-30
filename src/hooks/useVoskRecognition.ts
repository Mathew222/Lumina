import { useState, useEffect, useRef, useCallback } from 'react';

// Define types for Vosk (the library is loaded dynamically)
interface VoskModel {
    ready: boolean;
    KaldiRecognizer: new (sampleRate: number, grammar?: string) => VoskRecognizer;
    terminate: () => void;
    on: (event: string, callback: (message: any) => void) => void;
}

interface VoskRecognizer {
    on: (event: string, callback: (message: any) => void) => void;
    setWords: (words: boolean) => void;
    acceptWaveformFloat: (buffer: Float32Array, sampleRate: number) => void;
    retrieveFinalResult: () => void;
    remove: () => void;
}

declare global {
    interface Window {
        Vosk: {
            createModel: (modelUrl: string, logLevel?: number) => Promise<VoskModel>;
        };
    }
}

export interface UseVoskRecognitionReturn {
    text: string;
    interimText: string;
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
    hasSupport: boolean;
    error: string | null;
    audioLevel: number;
    isModelLoading: boolean;
    reloadModel: () => void;
}

export function useVoskRecognition(): UseVoskRecognitionReturn {
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const [isModelLoading, setIsModelLoading] = useState(true);

    const modelRef = useRef<VoskModel | null>(null);
    const recognizerRef = useRef<VoskRecognizer | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [retryCount, setRetryCount] = useState(0);

    const isModelLoadingRef = useRef(isModelLoading);

    useEffect(() => {
        isModelLoadingRef.current = isModelLoading;
    }, [isModelLoading]);

    // Load Vosk library dynamically
    useEffect(() => {
        const loadVosk = async () => {
            try {
                console.log('[Vosk] Loading Vosk library...');
                setIsModelLoading(true);
                setError(null);

                // Load the Vosk script
                if (!window.Vosk?.createModel) {
                    await new Promise<void>((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = '/vosk/vosk.js';
                        script.onload = () => {
                            console.log('[Vosk] Script loaded');
                            resolve();
                        };
                        script.onerror = (e) => {
                            console.error('[Vosk] Script load error:', e);
                            reject(new Error('Failed to load Vosk library'));
                        };
                        document.head.appendChild(script);
                    });
                }

                // Wait for createModel to be available
                let attempts = 0;
                while (!window.Vosk?.createModel && attempts < 20) {
                    await new Promise(r => setTimeout(r, 100));
                    attempts++;
                }

                if (!window.Vosk?.createModel) {
                    throw new Error('createModel not found after loading script');
                }

                console.log('[Vosk] Creating model...');
                const MODEL_URL = '/vosk-model-small-en-us-0.15.zip';

                // Create the model using the proper API
                const model = await window.Vosk.createModel(MODEL_URL, 0);

                console.log('[Vosk] Model created, waiting for ready...');

                // Wait for model ready
                if (!model.ready) {
                    await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Model load timeout'));
                        }, 60000);

                        model.on('load', (message: any) => {
                            clearTimeout(timeout);
                            if (message.result === true) {
                                console.log('[Vosk] Model ready');
                                resolve();
                            } else {
                                reject(new Error('Model load failed'));
                            }
                        });

                        model.on('error', (message: any) => {
                            clearTimeout(timeout);
                            reject(new Error(message.error || 'Unknown error'));
                        });
                    });
                }

                modelRef.current = model;
                console.log('[Vosk] Model loaded successfully');
                setIsModelLoading(false);
                setError(null);

            } catch (err: any) {
                console.error('[Vosk] Load error:', err);
                setError('Model Error: ' + err.message);
                setIsModelLoading(false);
            }
        };

        loadVosk();

        return () => {
            if (recognizerRef.current) {
                recognizerRef.current.remove();
            }
            if (modelRef.current) {
                modelRef.current.terminate();
            }
        };
    }, [retryCount]);

    const stopListening = useCallback(() => {
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (recognizerRef.current) {
            recognizerRef.current.retrieveFinalResult();
        }
        setIsListening(false);
        setAudioLevel(0);
    }, []);

    const reloadModel = useCallback(() => {
        console.log('[Vosk] Reloading model...');
        stopListening();
        if (recognizerRef.current) {
            recognizerRef.current.remove();
            recognizerRef.current = null;
        }
        if (modelRef.current) {
            modelRef.current.terminate();
            modelRef.current = null;
        }
        setIsModelLoading(true);
        setError(null);
        setRetryCount(c => c + 1);
    }, [stopListening]);

    const startListening = useCallback(async () => {
        setError(null);

        if (!modelRef.current) {
            setError('Model not loaded');
            return;
        }

        try {
            console.log('[Vosk] Starting recognition...');

            // Create recognizer
            const SAMPLE_RATE = 16000;
            const recognizer = new modelRef.current.KaldiRecognizer(SAMPLE_RATE);
            recognizerRef.current = recognizer;

            // Set up result handlers
            recognizer.on('result', (message: any) => {
                if (message.result && message.result.text) {
                    const resultText = message.result.text.trim();
                    if (resultText.length > 0) {
                        setText(prev => {
                            if (!prev) return resultText;
                            // Smart append
                            if (resultText.length > prev.length * 1.3) {
                                return resultText;
                            }
                            const prevLower = prev.toLowerCase();
                            const resultLower = resultText.toLowerCase();
                            if (resultLower.includes(prevLower.slice(-20))) {
                                return resultText;
                            }
                            return prev + ' ' + resultText;
                        });
                        setInterimText('');
                    }
                }
            });

            recognizer.on('partialresult', (message: any) => {
                if (message.result && message.result.partial) {
                    const partial = message.result.partial.trim();
                    if (partial.length > 0) {
                        setInterimText(partial);
                    }
                }
            });

            // Get audio stream using Electron's desktopCapturer
            console.log('[Vosk] Requesting audio sources from Electron...');

            if (!(window as any).electron || !(window as any).electron.getAudioSources) {
                throw new Error('Electron API not initialized. Please restart the app.');
            }

            const sources = await (window as any).electron.getAudioSources();
            console.log('[Vosk] Sources received:', sources.length);

            if (!sources || sources.length === 0) {
                throw new Error('No audio sources available');
            }

            // Find screen source
            let screenSource = sources.find((s: any) =>
                s.id.startsWith('screen:') && s.name.toLowerCase().includes('entire screen')
            ) || sources.find((s: any) => s.id.startsWith('screen:')) || sources[0];

            console.log('[Vosk] Selected source:', screenSource.name);

            const constraints: any = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screenSource.id
                    }
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screenSource.id
                    }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            // Stop video track
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
                stream.removeTrack(videoTrack);
            }

            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error('No audio track found. System audio capture may not be supported.');
            }

            // Set up audio processing
            const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                if (isModelLoadingRef.current || !recognizerRef.current) return;

                const input = e.inputBuffer.getChannelData(0);

                // Calculate audio level
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += input[i] * input[i];
                }
                const rms = Math.sqrt(sum / input.length);
                const level = Math.min(100, Math.round(rms * 1000));
                setAudioLevel(level);

                // Send to recognizer
                if (rms > 0.0005) {
                    const audioData = new Float32Array(input);
                    recognizerRef.current.acceptWaveformFloat(audioData, SAMPLE_RATE);
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            // Mute output
            const gain = audioContext.createGain();
            gain.gain.value = 0;
            processor.connect(gain);
            gain.connect(audioContext.destination);

            setIsListening(true);
            console.log('[Vosk] Recognition started');

        } catch (e: any) {
            console.error('[Vosk] Start error:', e);
            setError('Audio Error: ' + e.message);
            setIsListening(false);
        }
    }, []);

    return {
        text,
        interimText,
        isListening,
        startListening,
        stopListening,
        hasSupport: true,
        error,
        audioLevel,
        isModelLoading,
        reloadModel,
    };
}
