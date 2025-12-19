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
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState(0);

    const workerRef = useRef<Worker | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    useEffect(() => {
        // Initialize Worker
        workerRef.current = new Worker(new URL('../workers/whisper.worker.js', import.meta.url), { type: 'module' });

        workerRef.current.onmessage = (event) => {
            const { type, text: resultText, error: resultError, message } = event.data;

            if (type === 'ready') {
                console.log('[Hook] Worker reported ready');
                setError(null);
            } else if (type === 'debug') {
                console.log(`[Worker Debug] ${message}`);
            } else if (type === 'result') {
                if (resultText) {
                    const clean = resultText.trim();
                    console.log(`[Hook] Received text: "${clean}"`);
                    if (clean.length > 0) {
                        setText(() => {
                            // Start fresh with new chunk for "Live Subtitle" feel
                            // If we want history, we would do: (prev) => prev + " " + clean
                            return clean;
                        });
                        setInterimText(""); // Clear processing status
                    }
                }
            } else if (type === 'error') {
                console.error('[Hook] Worker Error:', resultError);
                setError("Engine Error: " + resultError);
            }
        };

        workerRef.current.postMessage({ type: 'init' });

        return () => {
            workerRef.current?.terminate();
        };
    }, []);

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
            const CHUNK_SIZE = 16000 * 4; // 4 seconds chunk

            processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);

                // Calculate Volume Meter
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += input[i] * input[i];
                }
                const rms = Math.sqrt(sum / input.length);
                // Normalized rough scale (0-100)
                const level = Math.min(100, Math.round(rms * 1000));
                setAudioLevel(level);

                const chunk = new Float32Array(input);
                buffer.push(chunk);
                bufferLength += chunk.length;

                if (bufferLength >= CHUNK_SIZE) {
                    // console.log(`[Hook] Sending audio chunk (${bufferLength} samples)`);

                    const fullBuffer = new Float32Array(bufferLength);
                    let offset = 0;
                    for (const b of buffer) {
                        fullBuffer.set(b, offset);
                        offset += b.length;
                    }

                    if (workerRef.current) {
                        workerRef.current.postMessage({ type: 'transcribe', audio: fullBuffer });
                        setInterimText("Thinking...");
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

    const stopListening = () => {
        sourceRef.current?.disconnect();
        processorRef.current?.disconnect();
        audioContextRef.current?.close();
        setIsListening(false);
        setAudioLevel(0); // Reset audio level when stopping
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
    };
}
