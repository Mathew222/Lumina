import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseHybridSpeechRecognitionReturn {
    text: string;           // Final refined text (from Whisper)
    interimText: string;    // Real-time interim text (from Vosk)
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
    hasSupport: boolean;
    error: string | null;
    audioLevel: number;
    isModelLoading: boolean;
    reloadModel: () => void;
    engineStatus: {
        vosk: 'loading' | 'ready' | 'error';
        whisper: 'loading' | 'ready' | 'error';
    };
}

/**
 * Hybrid Speech Recognition Hook
 * 
 * Uses Vosk for real-time low-latency display and Whisper for accuracy refinement.
 * - Vosk provides immediate partial/interim results (< 300ms latency)
 * - Whisper refines completed sentences for better accuracy (2-3s delay)
 */
export function useHybridSpeechRecognition(): UseHybridSpeechRecognitionReturn {
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const [isModelLoading, setIsModelLoading] = useState(true);
    const [engineStatus, setEngineStatus] = useState<{
        vosk: 'loading' | 'ready' | 'error';
        whisper: 'loading' | 'ready' | 'error';
    }>({ vosk: 'loading', whisper: 'loading' });

    // Worker references
    const voskWorkerRef = useRef<Worker | null>(null);
    const whisperWorkerRef = useRef<Worker | null>(null);

    // Audio processing refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    // Buffer for Whisper refinement
    const whisperBufferRef = useRef<Float32Array[]>([]);
    const whisperBufferLengthRef = useRef(0);
    const lastSpeechTimeRef = useRef(0);
    const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Track last Vosk result for comparison
    const lastVoskResultRef = useRef('');

    const [retryCount, setRetryCount] = useState(0);
    const isModelLoadingRef = useRef(isModelLoading);

    useEffect(() => {
        isModelLoadingRef.current = isModelLoading;
    }, [isModelLoading]);

    // Check if at least one engine is ready (graceful degradation)
    useEffect(() => {
        const bothReady = engineStatus.vosk === 'ready' && engineStatus.whisper === 'ready';
        const atLeastOneReady = engineStatus.vosk === 'ready' || engineStatus.whisper === 'ready';
        const bothDone = engineStatus.vosk !== 'loading' && engineStatus.whisper !== 'loading';

        if (bothReady) {
            // Both engines ready - optimal hybrid mode
            setIsModelLoading(false);
            setError(null);
        } else if (atLeastOneReady && bothDone) {
            // At least one engine ready, other failed - graceful degradation
            setIsModelLoading(false);
            // Don't set error - we can still operate with one engine
            const workingEngine = engineStatus.vosk === 'ready' ? 'Vosk' : 'Whisper';
            const failedEngine = engineStatus.vosk === 'error' ? 'Vosk' : 'Whisper';
            console.log(`[Hybrid] Running with ${workingEngine} only (${failedEngine} failed)`);
        } else if (bothDone && !atLeastOneReady) {
            // Both engines failed
            setIsModelLoading(false);
            setError('Both speech engines failed to load');
        }
    }, [engineStatus]);

    // Initialize both workers
    useEffect(() => {
        // Initialize Vosk Worker (low latency)
        voskWorkerRef.current = new Worker(new URL('../workers/vosk.worker.js', import.meta.url));
        voskWorkerRef.current.onmessage = (event) => {
            const { type, text: resultText, error: resultError, message } = event.data;

            if (type === 'ready') {
                console.log('[Hybrid] Vosk worker ready');
                setEngineStatus(prev => ({ ...prev, vosk: 'ready' }));
            } else if (type === 'debug') {
                console.log(`[Vosk Debug] ${message}`);
            } else if (type === 'partial') {
                // Real-time partial results from Vosk
                if (resultText) {
                    const clean = resultText.trim();
                    if (clean.length > 0) {
                        setInterimText(clean);
                    }
                }
            } else if (type === 'result') {
                // Vosk final result for current chunk
                if (resultText) {
                    const clean = resultText.trim();
                    if (clean.length > 0) {
                        lastVoskResultRef.current = clean;
                        // Show Vosk result immediately (will be refined by Whisper)
                        setText(prev => {
                            if (!prev) return clean;
                            // Append if new content
                            if (clean.length > prev.length * 1.3) return clean;
                            const prevLower = prev.toLowerCase();
                            const cleanLower = clean.toLowerCase();
                            if (cleanLower.includes(prevLower.slice(-20))) return clean;
                            return prev + ' ' + clean;
                        });
                        setInterimText('');
                    }
                }
            } else if (type === 'error') {
                console.error('[Hybrid] Vosk Error:', resultError);
                setEngineStatus(prev => ({ ...prev, vosk: 'error' }));
                setError("Vosk Error: " + resultError);
            }
        };
        voskWorkerRef.current.postMessage({ type: 'init' });

        // Initialize Whisper Worker (high accuracy)
        whisperWorkerRef.current = new Worker(
            new URL('../workers/whisper.worker.js', import.meta.url),
            { type: 'module' }
        );
        whisperWorkerRef.current.onmessage = (event) => {
            const { type, text: resultText, error: resultError, message } = event.data;

            if (type === 'ready') {
                console.log('[Hybrid] Whisper worker ready');
                setEngineStatus(prev => ({ ...prev, whisper: 'ready' }));
            } else if (type === 'debug') {
                console.log(`[Whisper Debug] ${message}`);
            } else if (type === 'result') {
                // Whisper refined result - replace Vosk's text with more accurate version
                if (resultText) {
                    const clean = resultText.trim();
                    if (clean.length > 0) {
                        console.log('[Hybrid] Whisper refinement:', clean);
                        // Replace with Whisper's more accurate transcription
                        setText(prev => {
                            // If Whisper result is substantially different, use it
                            if (!prev) return clean;

                            // Smart merge: Whisper is more accurate, so prefer it
                            // but keep any text that came after the Whisper audio chunk
                            const prevWords = prev.toLowerCase().split(' ');
                            const cleanWords = clean.toLowerCase().split(' ');

                            // Find overlap point
                            const lastWhisperWord = cleanWords[cleanWords.length - 1];
                            const overlapIdx = prevWords.lastIndexOf(lastWhisperWord);

                            if (overlapIdx !== -1 && overlapIdx < prevWords.length - 1) {
                                // Keep any words that came after the overlap
                                const newWords = prevWords.slice(overlapIdx + 1);
                                return clean + ' ' + newWords.join(' ');
                            }

                            return clean;
                        });
                    }
                }
            } else if (type === 'error') {
                console.error('[Hybrid] Whisper Error:', resultError);
                setEngineStatus(prev => ({ ...prev, whisper: 'error' }));
                // Don't set main error - Vosk can still work
                console.warn('[Hybrid] Whisper failed, falling back to Vosk only');
            }
        };
        whisperWorkerRef.current.postMessage({ type: 'init' });

        return () => {
            voskWorkerRef.current?.terminate();
            whisperWorkerRef.current?.terminate();
        };
    }, [retryCount]);

    const stopListening = useCallback(() => {
        sourceRef.current?.disconnect();
        processorRef.current?.disconnect();
        audioContextRef.current?.close();
        setIsListening(false);
        setAudioLevel(0);

        // Clear Whisper buffer
        whisperBufferRef.current = [];
        whisperBufferLengthRef.current = 0;
        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
        }
    }, []);

    const reloadModel = useCallback(() => {
        console.log('[Hybrid] Reloading models...');
        stopListening();
        setIsModelLoading(true);
        setError(null);
        setEngineStatus({ vosk: 'loading', whisper: 'loading' });
        setRetryCount(c => c + 1);
    }, [stopListening]);

    const sendToWhisper = useCallback(() => {
        if (!whisperWorkerRef.current || whisperBufferLengthRef.current < 16000) {
            // Need at least 1 second of audio
            return;
        }

        // Only send if Whisper is ready
        if (engineStatus.whisper !== 'ready') {
            console.log('[Hybrid] Whisper not ready, skipping refinement');
            return;
        }

        // Combine buffer chunks
        const fullBuffer = new Float32Array(whisperBufferLengthRef.current);
        let offset = 0;
        for (const chunk of whisperBufferRef.current) {
            fullBuffer.set(chunk, offset);
            offset += chunk.length;
        }

        console.log(`[Hybrid] Sending ${(whisperBufferLengthRef.current / 16000).toFixed(2)}s to Whisper for refinement`);
        whisperWorkerRef.current.postMessage({ type: 'transcribe', audio: fullBuffer });

        // Clear buffer after sending
        whisperBufferRef.current = [];
        whisperBufferLengthRef.current = 0;
    }, [engineStatus.whisper]);

    const startListening = useCallback(async () => {
        setError(null);
        try {
            console.log('[Hybrid] Starting audio capture...');

            if (!(window as any).electron || !(window as any).electron.getAudioSources) {
                throw new Error('Electron API not initialized. Please restart the app.');
            }

            const sources = await (window as any).electron.getAudioSources();
            if (!sources || sources.length === 0) {
                throw new Error('No audio sources available');
            }

            // Select screen source for system audio
            let screenSource = sources.find((s: any) =>
                s.id.startsWith('screen:') && s.name.toLowerCase().includes('entire screen')
            ) || sources.find((s: any) => s.id.startsWith('screen:')) || sources[0];

            console.log('[Hybrid] Selected source:', screenSource.name);

            const constraints: any = {
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screenSource.id
                    }
                } as any,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screenSource.id
                    } as any
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints as any);

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

            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            const processor = audioContext.createScriptProcessor(2048, 1, 1);  // 128ms buffer for low latency
            processorRef.current = processor;

            let voskBuffer: Float32Array[] = [];
            let voskBufferLength = 0;
            const VOSK_CHUNK_SIZE = 16000 * 0.15;  // 0.15s (150ms) for ultra-low latency
            const VOSK_MIN_INTERVAL = 100;        // 100ms min between sends
            let lastVoskSendTime = 0;

            const WHISPER_SILENCE_THRESHOLD = 1500; // Send to Whisper after 1.5s of silence
            const SPEECH_THRESHOLD = 0.001;

            processor.onaudioprocess = (e) => {
                if (isModelLoadingRef.current) return;

                const input = e.inputBuffer.getChannelData(0);

                // Calculate audio level
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += input[i] * input[i];
                }
                const rms = Math.sqrt(sum / input.length);
                const level = Math.min(100, Math.round(rms * 1000));
                setAudioLevel(level);

                const chunk = new Float32Array(input);
                const now = Date.now();

                // Check for speech activity
                const hasSpeech = rms > SPEECH_THRESHOLD;

                if (hasSpeech) {
                    lastSpeechTimeRef.current = now;

                    // Clear any pending silence timeout
                    if (silenceTimeoutRef.current) {
                        clearTimeout(silenceTimeoutRef.current);
                        silenceTimeoutRef.current = null;
                    }
                }

                // Always buffer for Vosk (low latency)
                voskBuffer.push(chunk);
                voskBufferLength += chunk.length;

                // Also buffer for Whisper (accuracy refinement)
                whisperBufferRef.current.push(chunk);
                whisperBufferLengthRef.current += chunk.length;

                // Send to Vosk frequently for low latency
                const shouldSendToVosk = voskBufferLength >= VOSK_CHUNK_SIZE &&
                    (now - lastVoskSendTime) >= VOSK_MIN_INTERVAL;

                if (shouldSendToVosk && rms > 0.0002 && voskWorkerRef.current) {  // Lower threshold for sensitivity
                    const fullBuffer = new Float32Array(voskBufferLength);
                    let offset = 0;
                    for (const b of voskBuffer) {
                        fullBuffer.set(b, offset);
                        offset += b.length;
                    }

                    voskWorkerRef.current.postMessage({ type: 'transcribe', audio: fullBuffer });
                    lastVoskSendTime = now;

                    // Keep minimal overlap for continuity
                    const overlapSamples = Math.floor(16000 * 0.05);  // 50ms overlap
                    if (voskBufferLength > overlapSamples) {
                        const newBuffer: Float32Array[] = [];
                        let newLength = 0;
                        let tempOffset = voskBufferLength - overlapSamples;

                        for (const b of voskBuffer) {
                            if (tempOffset <= 0) {
                                newBuffer.push(b);
                                newLength += b.length;
                            } else if (tempOffset < b.length) {
                                const overlapChunk = b.slice(tempOffset);
                                newBuffer.push(overlapChunk);
                                newLength += overlapChunk.length;
                            }
                            tempOffset -= b.length;
                        }

                        voskBuffer = newBuffer;
                        voskBufferLength = newLength;
                    } else {
                        voskBuffer = [];
                        voskBufferLength = 0;
                    }
                }

                // Send to Whisper after silence (for refinement)
                if (!hasSpeech &&
                    whisperBufferLengthRef.current > 16000 * 2 && // At least 2 seconds
                    (now - lastSpeechTimeRef.current) > WHISPER_SILENCE_THRESHOLD &&
                    !silenceTimeoutRef.current) {

                    // Schedule Whisper refinement
                    silenceTimeoutRef.current = setTimeout(() => {
                        sendToWhisper();
                        silenceTimeoutRef.current = null;
                    }, 500);
                }

                // Limit Whisper buffer size (max 30 seconds)
                const maxWhisperSamples = 16000 * 30;
                if (whisperBufferLengthRef.current > maxWhisperSamples) {
                    // Trim old audio, keep last 30 seconds
                    const trimTarget = whisperBufferLengthRef.current - maxWhisperSamples;
                    let trimmed = 0;
                    while (whisperBufferRef.current.length > 0 && trimmed < trimTarget) {
                        const removed = whisperBufferRef.current.shift();
                        if (removed) {
                            trimmed += removed.length;
                            whisperBufferLengthRef.current -= removed.length;
                        }
                    }
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
        } catch (e: any) {
            console.error('[Hybrid] Error:', e);
            setError("Audio Error: " + e.message);
            setIsListening(false);
        }
    }, [sendToWhisper]);

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
        engineStatus,
    };
}
