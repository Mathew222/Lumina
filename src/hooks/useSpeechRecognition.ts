import { useState, useEffect, useRef } from 'react';

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
    const [hasSupport, setHasSupport] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            setHasSupport(true);
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                let final = '';
                let interim = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                if (final) {
                    setText(final);
                }
                setInterimText(interim);
                setError(null); // Clear error on successful result
            };

            recognition.onend = () => {
                if (recognitionRef.current && recognitionRef.current.shouldRestart) {
                    recognitionRef.current.start();
                } else {
                    setIsListening(false);
                }
            };

            recognition.onerror = (event: any) => {
                console.error('Speech recognition error', event.error);
                setError(event.error);
                if (event.error === 'not-allowed') {
                    setIsListening(false);
                }
            };

            recognitionRef.current = recognition;
        }
    }, []);

    const startListening = () => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.shouldRestart = true;
                recognitionRef.current.start();
                setIsListening(true);
            } catch (e) {
                console.error(e);
            }
        }
    };

    const stopListening = () => {
        if (recognitionRef.current) {
            recognitionRef.current.shouldRestart = false;
            recognitionRef.current.stop();
            setIsListening(false);
        }
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
