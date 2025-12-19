import { useState, useEffect, useRef } from 'react';

export interface UseSpeechRecognitionReturn {
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

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);
    const [isModelLoading, setIsModelLoading] = useState(true);

    const workerRef = useRef<Worker | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const [retryCount, setRetryCount] = useState(0);

    const isModelLoadingRef = useRef(isModelLoading);

    useEffect(() => {
        isModelLoadingRef.current = isModelLoading;
    }, [isModelLoading]);

    useEffect(() => {
        // Initialize Worker
        workerRef.current = new Worker(new URL('../workers/whisper.worker.js', import.meta.url), { type: 'module' });
        workerRef.current.onmessage = (event) => {
            const { type, text: resultText, error: resultError, message } = event.data;

            if (type === 'ready') {
                console.log('[Hook] Worker reported ready');
                setIsModelLoading(false);
                setError(null);
            } else if (type === 'debug') {
                console.log(`[Worker Debug] ${message}`);
            } else if (type === 'result') {
                if (resultText) {
                    const clean = resultText.trim();
                    console.log(`[Hook] Received text: "${clean}"`);
                    if (clean.length > 0) {
                        setText(() => clean);
                        setInterimText("");
                    }
                }
            } else if (type === 'error') {
                console.error('[Hook] Worker Error:', resultError);
                setError("Engine Error: " + resultError);
                setIsModelLoading(false); // Stop loading on error
            }
        };
        workerRef.current.postMessage({ type: 'init' });

        return () => {
            workerRef.current?.terminate();
        };
    }, [retryCount]);

    const stopListening = () => {
        sourceRef.current?.disconnect();
        processorRef.current?.disconnect();
        audioContextRef.current?.close();
        setIsListening(false);
        setAudioLevel(0);
    };

    const reloadModel = () => {
        console.log('[Hook] Reloading model...');
        stopListening(); // Force stop mic to prevent race conditions
        setIsModelLoading(true);
        setError(null);
        setRetryCount(c => c + 1);
    };

    const startListening = async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            // Buffer size 4096 = ~0.256s at 16k
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            let buffer: Float32Array[] = [];
            let bufferLength = 0;
            const CHUNK_SIZE = 16000 * 5; // 5 seconds for better accuracy (more context)

            processor.onaudioprocess = (e) => {
                // GUARD: Do not process if model is loading (checked via Ref to avoid stale closure)
                if (isModelLoadingRef.current) return;

                const input = e.inputBuffer.getChannelData(0);

                // Calculate Volume Meter
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += input[i] * input[i];
                }
                const rms = Math.sqrt(sum / input.length);

                if (rms > 0.05) {
                    // console.log(`[Audio] Input detected, RMS: ${rms.toFixed(4)}`);
                }

                // Normalized rough scale (0-100)
                const level = Math.min(100, Math.round(rms * 1000));
                setAudioLevel(level);

                const chunk = new Float32Array(input);
                buffer.push(chunk);
                bufferLength += chunk.length;

                if (bufferLength >= CHUNK_SIZE) {
                    console.log(`[Hook] Sending audio chunk (${bufferLength} samples) to worker`);

                    const fullBuffer = new Float32Array(bufferLength);
                    let offset = 0;
                    for (const b of buffer) {
                        fullBuffer.set(b, offset);
                        offset += b.length;
                    }

                    if (workerRef.current) {
                        workerRef.current.postMessage({ type: 'transcribe', audio: fullBuffer });
                        setInterimText("Thinking...");
                    } else {
                        console.warn("[Hook] Worker reference is null!");
                    }

                    buffer = [];
                    bufferLength = 0;
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            // Mute output to prevent feedback
            const gain = audioContext.createGain();
            gain.gain.value = 0;
            processor.connect(gain);
            gain.connect(audioContext.destination);

            setIsListening(true);
        } catch (e: any) {
            console.error(e);
            setError("Mic Error: " + e.message);
            setIsListening(false);
        }
    };

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
