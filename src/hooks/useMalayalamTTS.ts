import { useState, useRef, useCallback, useEffect } from 'react';
import { speakMalayalam, stopAudio } from '../utils/tts';

export interface UseMalayalamTTSReturn {
    isDubbingEnabled: boolean;
    toggleDubbing: () => void;
    isSpeaking: boolean;
    speechRate: number;
    setSpeechRate: (rate: number) => void;
    speak: (text: string) => void;
    stop: () => void;
    engineStatus: 'idle' | 'ready' | 'speaking' | 'error';
    engineError: string | null;
}

/**
 * React hook for Malayalam TTS dubbing.
 *
 * Uses Google Translate's free TTS endpoint to fetch and play Malayalam audio.
 * No model download, no API key, no OS voice installation required.
 * Requires an internet connection (same as the translation feature).
 */
export function useMalayalamTTS(): UseMalayalamTTSReturn {
    const [isDubbingEnabled, setIsDubbingEnabled] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [speechRate, setSpeechRate] = useState(0.9);
    const [engineStatus, setEngineStatus] = useState<'idle' | 'ready' | 'speaking' | 'error'>('ready');
    const [engineError, setEngineError] = useState<string | null>(null);

    // Prevent overlapping: if a new sentence comes in while fetching, only speak the latest
    const pendingTextRef = useRef<string | null>(null);
    const isFetchingRef = useRef(false);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopAudio();
        };
    }, []);

    const speak = useCallback(
        (text: string) => {
            if (!isDubbingEnabled || !text.trim()) return;

            // If already fetching audio for a previous sentence, replace it with the latest
            if (isFetchingRef.current) {
                pendingTextRef.current = text;
                stopAudio(); // Cancel any playing audio
                return;
            }

            const doSpeak = async (textToSpeak: string) => {
                isFetchingRef.current = true;
                setEngineStatus('speaking');
                setIsSpeaking(true);
                setEngineError(null);

                await speakMalayalam(
                    textToSpeak,
                    speechRate,
                    () => {
                        // Audio ended
                        setIsSpeaking(false);
                        isFetchingRef.current = false;
                        setEngineStatus('ready');

                        // If a newer sentence was queued while we were fetching, speak it now
                        if (pendingTextRef.current) {
                            const next = pendingTextRef.current;
                            pendingTextRef.current = null;
                            doSpeak(next);
                        }
                    },
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

            doSpeak(text);
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
