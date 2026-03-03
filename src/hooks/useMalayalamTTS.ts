import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchAudioBuffer, playAudioBuffer, stopAudio } from '../utils/tts';

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
 * TTS hook with gap-free playback via lookahead prefetch.
 *
 * While segment N plays, segment N+1 is fetched in the background.
 * When N ends, N+1 starts instantly — no silence between segments.
 */
export function useMalayalamTTS(): UseSpeechTTSReturn {
    const [isDubbingEnabled, setIsDubbingEnabled] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [speechRate, setSpeechRate] = useState(0.9);
    const [engineStatus, setEngineStatus] = useState<'idle' | 'ready' | 'speaking' | 'error'>('ready');
    const [engineError, setEngineError] = useState<string | null>(null);

    // FIFO queue of items to speak
    const queueRef = useRef<Array<{ text: string; lang: string }>>([]);
    // Prefetched audio buffer for next segment
    const prefetchRef = useRef<Promise<AudioBuffer | null> | null>(null);
    const isProcessingRef = useRef(false);
    const speechRateRef = useRef(speechRate);
    useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);

    useEffect(() => { return () => { stopAudio(); }; }, []);

    const processQueue = useCallback(async () => {
        if (isProcessingRef.current || queueRef.current.length === 0) return;
        isProcessingRef.current = true;

        while (queueRef.current.length > 0) {
            const { text, lang } = queueRef.current.shift()!;
            setEngineStatus('speaking');
            setEngineError(null);

            // Start prefetching next segment immediately (runs in parallel with current play)
            if (queueRef.current.length > 0) {
                const next = queueRef.current[0];
                prefetchRef.current = fetchAudioBuffer(next.text, lang, speechRateRef.current);
            }

            // Fetch current segment (or use already-prefetched buffer)
            let buf: AudioBuffer | null = null;
            try {
                if (prefetchRef.current && queueRef.current.length === 0) {
                    // We already prefetched this one (it was N+1, now N)
                    buf = await prefetchRef.current;
                    prefetchRef.current = null;
                } else {
                    buf = await fetchAudioBuffer(text, lang, speechRateRef.current);
                }
            } catch (err: any) {
                console.error('[TTS] fetch error:', err.message);
                setEngineError(err.message);
                setEngineStatus('error');
                continue; // skip to next item
            }

            if (!buf) continue;

            // Play the buffer
            await new Promise<void>((resolve) => {
                playAudioBuffer(
                    buf!,
                    speechRateRef.current,
                    () => setIsSpeaking(true),
                    () => { setIsSpeaking(false); resolve(); },
                    (err) => {
                        setEngineError(err.message);
                        setEngineStatus('error');
                        setIsSpeaking(false);
                        resolve();
                    }
                );
            });
        }

        setEngineStatus('ready');
        isProcessingRef.current = false;
    }, []);

    const speak = useCallback((text: string, lang = 'ml') => {
        if (!isDubbingEnabled || !text.trim()) return;
        queueRef.current.push({ text, lang });
        processQueue();
    }, [isDubbingEnabled, processQueue]);

    const stop = useCallback(() => {
        queueRef.current = [];
        prefetchRef.current = null;
        isProcessingRef.current = false;
        stopAudio();
        setIsSpeaking(false);
        setEngineStatus('ready');
    }, []);

    const toggleDubbing = useCallback(() => {
        setIsDubbingEnabled(prev => { if (prev) stop(); return !prev; });
    }, [stop]);

    return { isDubbingEnabled, toggleDubbing, isSpeaking, speechRate, setSpeechRate, speak, stop, engineStatus, engineError };
}
