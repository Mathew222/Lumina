import { useState, useRef, useCallback, useEffect } from 'react';
import { speakText, stopAudio } from '../utils/tts';

export interface UseSpeechTTSReturn {
    isDubbingEnabled: boolean;
    toggleDubbing: () => void;
    isSpeaking: boolean;
    speechRate: number;
    setSpeechRate: (rate: number) => void;
    speak: (text: string, lang?: string) => void;
    stop: () => void;
    engineStatus: 'idle' | 'ready' | 'speaking' | 'error';
    engineError: string | null;
}

/**
 * React hook for Multi-language TTS dubbing.
 *
 * Uses Google Translate's free TTS endpoint to fetch and play audio.
 */
export function useMalayalamTTS(): UseSpeechTTSReturn {
    const [isDubbingEnabled, setIsDubbingEnabled] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [speechRate, setSpeechRate] = useState(0.9);
    const [engineStatus, setEngineStatus] = useState<'idle' | 'ready' | 'speaking' | 'error'>('ready');
    const [engineError, setEngineError] = useState<string | null>(null);

    // Prevent overlapping: if a new sentence comes in while fetching, only speak the latest
    const pendingTextRef = useRef<{ text: string; lang: string } | null>(null);
    const isFetchingRef = useRef(false);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopAudio();
        };
    }, []);

    const speak = useCallback(
        (text: string, lang: string = 'ml') => {
            if (!isDubbingEnabled || !text.trim()) return;

            // If already fetching audio for a previous sentence, replace it with the latest
            if (isFetchingRef.current) {
                pendingTextRef.current = { text, lang };
                stopAudio();
                return;
            }

            const doSpeak = async (textToSpeak: string, speakLang: string) => {
                isFetchingRef.current = true;
                setEngineError(null);
                setEngineStatus('speaking');

                await speakText(
                    textToSpeak,
                    speakLang,
                    speechRate,
                    // onStart – called when audio ACTUALLY begins playing
                    () => {
                        setIsSpeaking(true);
                    },
                    // onEnd – called when audio finishes
                    () => {
                        setIsSpeaking(false);
                        isFetchingRef.current = false;
                        setEngineStatus('ready');

                        // If a newer sentence was queued while we were fetching, speak it now
                        if (pendingTextRef.current) {
                            const next = pendingTextRef.current;
                            pendingTextRef.current = null;
                            doSpeak(next.text, next.lang);
                        }
                    },
                    // onError
                    (err) => {
                        console.error('[TTS] Error:', err.message);
                        setEngineError(err.message);
                        setEngineStatus('error');
                        setIsSpeaking(false);
                        isFetchingRef.current = false;
                        pendingTextRef.current = null;
                    }
                );
            };

            doSpeak(text, lang);
        },
        [isDubbingEnabled, speechRate]
    );

    const stop = useCallback(() => {
        stopAudio();
        pendingTextRef.current = null;
        isFetchingRef.current = false;
        setIsSpeaking(false);
        setEngineStatus('ready');
    }, []);

    const toggleDubbing = useCallback(() => {
        setIsDubbingEnabled((prev) => {
            if (prev) {
                stop();
            }
            return !prev;
        });
    }, [stop]);

    return {
        isDubbingEnabled,
        toggleDubbing,
        isSpeaking,
        speechRate,
        setSpeechRate,
        speak,
        stop,
        engineStatus,
        engineError,
    };
}
