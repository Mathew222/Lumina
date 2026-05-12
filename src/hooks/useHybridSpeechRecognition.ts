import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseHybridSpeechRecognitionReturn {
    text: string;           // Final refined text (from Whisper)
    interimText: string;    // Real-time interim text (from Vosk)
    lastWhisperText: string; // Most recent Whisper-only segment (for TTS dubbing)
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
    hasSupport: boolean;
    error: string | null;
    audioLevel: number;
    monitorVolume: number;
    setMonitorVolume: (volume: number) => void;
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
export interface UseHybridOptions {
    isMuted?: boolean;
}

export function useHybridSpeechRecognition(options?: UseHybridOptions): UseHybridSpeechRecognitionReturn {
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [lastWhisperText, setLastWhisperText] = useState(''); // Fires only on Whisper segments
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const [monitorVolume, setMonitorVolume] = useState(0); // Default to muted
    const [isModelLoading, setIsModelLoading] = useState(true);
    const [engineStatus, setEngineStatus] = useState<{
        vosk: 'loading' | 'ready' | 'error';
        whisper: 'loading' | 'ready' | 'error';
    }>({ vosk: 'loading', whisper: 'loading' });

    // Ref mirror of engineStatus.whisper so audio-processor closures always read
    // the live value without stale-closure bugs
    const whisperReadyRef = useRef(false);
    const voskReadyRef = useRef(false);

    // Worker references
    const voskWorkerRef = useRef<Worker | null>(null);
    const whisperWorkerRef = useRef<Worker | null>(null);

    // Audio processing refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const monitorGainRef = useRef<GainNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Update gain value when monitorVolume changes
    useEffect(() => {
        if (monitorGainRef.current && audioContextRef.current) {
            monitorGainRef.current.gain.setTargetAtTime(monitorVolume, audioContextRef.current.currentTime, 0.05);
        }
    }, [monitorVolume]);

    // Buffer for Whisper refinement
    const whisperBufferRef = useRef<Float32Array[]>([]);
    const whisperBufferLengthRef = useRef(0);
    const lastSpeechTimeRef = useRef(0);
    const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Track last Vosk result for comparison
    const lastVoskResultRef = useRef('');

    const [retryCount, setRetryCount] = useState(0);
    const isModelLoadingRef = useRef(isModelLoading);
    const isMutedRef = useRef(options?.isMuted || false);
    // Rolling Whisper timer: fires every N seconds of continuous speech
    // so we get results even without a silence gap
    const whisperRollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const WHISPER_ROLLING_INTERVAL_MS = 3000; // send to Whisper at least every 3s

    useEffect(() => {
        isModelLoadingRef.current = isModelLoading;
    }, [isModelLoading]);

    useEffect(() => {
        isMutedRef.current = options?.isMuted || false;
    }, [options?.isMuted]);

    // Start as soon as Vosk is ready (fast) - don't wait for Whisper (slow)
    useEffect(() => {
        // Vosk-first approach: start immediately when Vosk is ready
        if (engineStatus.vosk === 'ready') {
            setIsModelLoading(false);
            setError(null);
            console.log('[Hybrid] Vosk ready - starting immediately (Whisper will load in background)');
        } else if (engineStatus.vosk === 'error') {
            // Vosk failed, fall back to waiting for Whisper
            if (engineStatus.whisper === 'ready') {
                setIsModelLoading(false);
                setError(null);
                console.log('[Hybrid] Running with Whisper only (Vosk failed)');
            } else if (engineStatus.whisper === 'error') {
                // Both engines failed
                setIsModelLoading(false);
                setError('Both speech engines failed to load');
            }
            // else: still waiting for Whisper
        }
        // else: still waiting for Vosk (don't wait for Whisper)
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
                voskReadyRef.current = true;
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
                // Vosk final result — only used for live interim display, NOT for transcript
                // Whisper is the authoritative transcript source
                if (resultText) {
                    const clean = resultText.trim();
                    if (clean.length > 0) {
                        lastVoskResultRef.current = clean;
                        // Show as interim so the user sees real-time feedback
                        // but do NOT update `text` — Whisper owns the transcript
                        setInterimText(clean);
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
        whisperWorkerRef.current.onerror = (e) => {
            console.error('[Hybrid] Whisper Worker crashed:', e);
            setEngineStatus(prev => ({ ...prev, whisper: 'error' }));
        };
        whisperWorkerRef.current.onmessage = (event) => {
            const { type, text: resultText, error: resultError, message } = event.data;

            if (type === 'ready') {
                console.log('[Hybrid] Whisper worker ready');
                setEngineStatus(prev => ({ ...prev, whisper: 'ready' }));
                whisperReadyRef.current = true;
            } else if (type === 'debug') {
                console.log(`[Whisper Debug] ${message}`);
            } else if (type === 'result') {
                // Whisper refined result - replace Vosk's text with more accurate version
                if (resultText) {
                    const clean = resultText.trim();
                    if (clean.length > 0) {
                        console.log('[Hybrid] Whisper refinement:', clean);
                        // Update the lastWhisperText to trigger TTS in Dashboard
                        setLastWhisperText(clean);
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
        monitorGainRef.current?.disconnect();
        audioContextRef.current?.close();
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setIsListening(false);
        setAudioLevel(0);

        // Clear all buffers and timers
        whisperBufferRef.current = [];
        whisperBufferLengthRef.current = 0;
        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
        }
        if (whisperRollingTimerRef.current) {
            clearTimeout(whisperRollingTimerRef.current);
            whisperRollingTimerRef.current = null;
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

    // Use a stable callback that reads whisperReadyRef (live value) to avoid
    // the stale-closure bug where engineStatus.whisper was always 'loading'.
    const sendToWhisper = useCallback(() => {
        if (!whisperWorkerRef.current) return;
        // Need at least 0.8s of audio
        if (whisperBufferLengthRef.current < 16000 * 0.8) return;

        // Read live ready-state via ref — avoids stale closure
        if (!whisperReadyRef.current) {
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

        whisperWorkerRef.current.postMessage({ type: 'transcribe', audio: fullBuffer }, [fullBuffer.buffer]);

        // Clear buffer after sending
        whisperBufferRef.current = [];
        whisperBufferLengthRef.current = 0;
    }, []);

    const startListening = useCallback(async () => {
        setError(null);
        try {
            console.log('[Hybrid] Starting audio capture...');
            let stream: MediaStream;
            const electronApi = (window as any).electron;
            const canUseDesktopCapture = !!electronApi?.getAudioSources;

            if (canUseDesktopCapture) {
                try {
                    const sources = await electronApi.getAudioSources();
                    if (!sources || sources.length === 0) {
                        throw new Error('No audio sources available');
                    }

                    // Select screen source for system audio
                    const screenSource = sources.find((s: any) =>
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

                    stream = await navigator.mediaDevices.getUserMedia(constraints as any);
                } catch (desktopError) {
                    console.warn('[Hybrid] Desktop audio capture failed, falling back to microphone:', desktopError);
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                }
            } else {
                console.warn('[Hybrid] Electron API unavailable. Using microphone capture fallback.');
                stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            }
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

            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            const processor = audioContext.createScriptProcessor(512, 1, 1);  // 32ms buffer for ultra-low latency
            processorRef.current = processor;

            // Monitoring Gain Node - for controlled loopback
            const monitorGain = audioContext.createGain();
            monitorGain.gain.value = monitorVolume;
            monitorGainRef.current = monitorGain;

            // Connect raw source to the monitor gain, and monitor gain to speakers
            source.connect(monitorGain);
            monitorGain.connect(audioContext.destination);

            // Dummy silent gain to ensure processor events fire in Chrome
            const dummyGain = audioContext.createGain();
            dummyGain.gain.value = 0;
            processor.connect(dummyGain);
            dummyGain.connect(audioContext.destination);

            let voskBuffer: Float32Array[] = [];
            let voskBufferLength = 0;
            const VOSK_CHUNK_SIZE = 16000 * 0.03;  // 30ms chunks for lower latency
            const VOSK_MIN_INTERVAL = 20;            // 20ms min between sends
            let lastVoskSendTime = 0;

            const WHISPER_SILENCE_THRESHOLD = 200;  // Send to Whisper after 200ms of silence
            const SPEECH_THRESHOLD = 0.001;

            // Rolling Whisper timer — fires even during continuous speech
            const scheduleRollingWhisper = () => {
                if (whisperRollingTimerRef.current) clearTimeout(whisperRollingTimerRef.current);
                whisperRollingTimerRef.current = setTimeout(() => {
                    whisperRollingTimerRef.current = null;
                    sendToWhisper();
                    scheduleRollingWhisper();
                }, WHISPER_ROLLING_INTERVAL_MS);
            };
            scheduleRollingWhisper();

            processor.onaudioprocess = (e) => {
                if (isModelLoadingRef.current) return;

                const input = e.inputBuffer.getChannelData(0);

                // If muted (e.g. TTS is speaking), zero out the audio to prevent feedback loop
                // We use zeros instead of returning early to maintain continuous audio stream for Vosk
                if (isMutedRef.current) {
                    for (let i = 0; i < input.length; i++) {
                        input[i] = 0;
                    }
                }

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

                if (shouldSendToVosk && voskWorkerRef.current) {  // Always send to allow Vosk to process silence
                    const fullBuffer = new Float32Array(voskBufferLength);
                    let offset = 0;
                    for (const b of voskBuffer) {
                        fullBuffer.set(b, offset);
                        offset += b.length;
                    }

                    voskWorkerRef.current.postMessage({ type: 'transcribe', audio: fullBuffer });
                    lastVoskSendTime = now;

                    // Minimal overlap for continuity
                    const overlapSamples = Math.floor(16000 * 0.02);  // 20ms overlap (minimum)
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

                // Send to Whisper immediately on short silence
                if (!hasSpeech &&
                    whisperBufferLengthRef.current > 16000 * 0.8 &&
                    (now - lastSpeechTimeRef.current) > WHISPER_SILENCE_THRESHOLD &&
                    !silenceTimeoutRef.current) {

                    silenceTimeoutRef.current = setTimeout(() => {
                        sendToWhisper();
                        silenceTimeoutRef.current = null;
                        // Reset rolling timer since silence already flushed the buffer
                        if (whisperRollingTimerRef.current) clearTimeout(whisperRollingTimerRef.current);
                        scheduleRollingWhisper();
                    }, 50);
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

            setIsListening(true);
        } catch (e: any) {
            console.error('[Hybrid] Error:', e);
            setError("Audio Error: " + e.message);
            setIsListening(false);
        }
    }, [sendToWhisper, monitorVolume]);

    return {
        text,
        interimText,
        lastWhisperText,
        isListening,
        startListening,
        stopListening,
        hasSupport: true,
        error,
        audioLevel,
        monitorVolume,
        setMonitorVolume,
        isModelLoading,
        reloadModel,
        engineStatus,
    };
}

