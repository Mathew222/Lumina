import { useState, useEffect, useRef } from 'react';
import * as Vosk from 'vosk-browser';

export interface UseSpeechRecognitionReturn {
    text: string;
    interimText: string;
    isListening: boolean;
    startListening: () => void;
    stopListening: () => void;
    hasSupport: boolean;
    error: string | null;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
    const [text, setText] = useState('');
    const [interimText, setInterimText] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [hasSupport] = useState(true); // Vosk is supported generally
    const [error, setError] = useState<string | null>(null);

    const recognizerRef = useRef<any>(null);
    const modelRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);

    useEffect(() => {
        const initModel = async () => {
            try {
                // Load model from CDN to avoid local fs issues in Electron renderer
                const model = await Vosk.createModel('https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.zip');
                modelRef.current = model;
                console.log("Vosk model loaded");
            } catch (e: any) {
                console.error("Failed to load Vosk model", e);
                setError("Model Load Failed: " + e.message);
            }
        };
        initModel();

        return () => {
            if (modelRef.current) {
                modelRef.current.terminate();
            }
        };
    }, []);

    const startListening = async () => {
        if (!modelRef.current) {
            setError("Model loading...");
            return;
        }
        setError(null);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    channelCount: 1,
                    sampleRate: 16000
                }
            });

            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            // Create recognizer
            const recognizer = new modelRef.current.KaldiRecognizer(16000.0);
            recognizerRef.current = recognizer;

            recognizer.on("result", (message: any) => {
                const result = message.result;
                if (result.text) {
                    setText(() => {
                        // Simple concatenation for demo, or just replace
                        return result.text;
                    });
                    setInterimText('');
                }
            });

            recognizer.on("partialresult", (message: any) => {
                const partial = message.result.partial;
                if (partial) {
                    setInterimText(partial);
                }
            });

            // Process audio
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (event) => {
                if (recognizerRef.current) {
                    try {
                        recognizerRef.current.acceptWaveform(event.inputBuffer);
                    } catch (error) {
                        console.error(error);
                    }
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination); // Mute feedback? Ideally connect to nothing if just processing, but ScriptProcessor needs destination? 
            // Actually ScriptProcessor is deprecated. AudioWorklet is better.
            // But for quick fix...
            // Note: to stop feedback loop, ensure we don't output to speakers.
            // processor.connect(audioContext.destination) might cause feedback if mic->speak.
            // Just connect to a Gain(0)?
            const gain = audioContext.createGain();
            gain.gain.value = 0;
            processor.connect(gain);
            gain.connect(audioContext.destination);

            setIsListening(true);

        } catch (e: any) {
            console.error(e);
            setError(e.message || "Mic Error");
            setIsListening(false);
        }
    };

    const stopListening = () => {
        if (recognizerRef.current) {
            // recognizerRef.current.remove(); // if needed
            recognizerRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
        }
        if (processorRef.current) {
            processorRef.current.disconnect();
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setIsListening(false);
    };

    return {
        text,
        interimText,
        isListening,
        startListening,
        stopListening,
        hasSupport,
        error,
    };
}
