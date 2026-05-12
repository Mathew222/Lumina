import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, Globe, ChevronDown, Settings, Type, Palette, Circle, Square, History, Volume2, VolumeX, Gauge } from 'lucide-react';
import { useMalayalamTTS } from '../hooks/useMalayalamTTS';
import { useHybridSpeechRecognition } from '../hooks/useHybridSpeechRecognition';
import { BROADCAST_CHANNEL_NAME, sendMessage } from '../utils/broadcast';
import { translateText, translateInterim, translateLongText, LANGUAGES, clearTranslationContext } from '../utils/translate';
import type { SupportedLanguage } from '../utils/translate';
import type { Session, Summary } from '../types/session';
import { warmVoice } from '../utils/tts';
import { summarizeConversation, getStoredApiKey } from '../utils/gemini';
import { saveSession, generateSessionId, getSession } from '../utils/sessionStorage';
import { SummaryView } from './SummaryView';
import { SessionHistory } from './SessionHistory';
import { saveSummaryToSupabase } from '../utils/supabase';

export const Dashboard = () => {
    const tts = useMalayalamTTS();
    const { text, interimText, isListening, startListening, stopListening, error, audioLevel, setMonitorVolume, isModelLoading, reloadModel, engineStatus } = useHybridSpeechRecognition({
        isMuted: tts.isSpeaking
    });
    const channelRef = useRef<BroadcastChannel | null>(null);

    // Language state
    const [targetLanguage, setTargetLanguage] = useState<SupportedLanguage>('en');
    const [showLanguageMenu, setShowLanguageMenu] = useState(false);
    const [translatedText, setTranslatedText] = useState('');
    const [translatedInterim, setTranslatedInterim] = useState('');
    const [isTranslating, setIsTranslating] = useState(false);

    // Debug Console State
    const [logs, setLogs] = useState<string[]>([]);

    // Text Customization State
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('md');
    const [showBackground, setShowBackground] = useState(true);
    const [textColor, setTextColor] = useState('#e5e5e5'); // Default gray-300

    // Session Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const transcriptBufferRef = useRef<string[]>([]);
    const isSummarizingRef = useRef(false);

    // Summary Panel State
    const [showSummaryPanel, setShowSummaryPanel] = useState(false);
    const [currentSummary, setCurrentSummary] = useState<Summary | null>(null);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [isTranslatingTranscript, setIsTranslatingTranscript] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [currentTranscript, setCurrentTranscript] = useState<string>('');
    const [currentFormattedTranscript, setCurrentFormattedTranscript] = useState<string>('');
    const [currentRecordedAt, setCurrentRecordedAt] = useState<string>('');
    const [currentDuration, setCurrentDuration] = useState<number>(0);
    const [currentSessionId, setCurrentSessionId] = useState<string>('');
    const [summaryStreamText, setSummaryStreamText] = useState<string>(''); // live streaming text

    // Session History State
    const [showSessionHistory, setShowSessionHistory] = useState(false);

    // API Key State
    const geminiApiKey = getStoredApiKey();
    const [summaryLanguage, setSummaryLanguage] = useState<'en' | 'ml'>('en'); // en = English, ml = Malayalam

    // Audio Monitoring State
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [autoDucking, setAutoDucking] = useState(true);
    const [monitorSliderVolume, setMonitorSliderVolume] = useState(0.5); // User's preferred monitoring volume

    // Preset colors for text
    const TEXT_COLORS = [
        { name: 'White', value: '#ffffff' },
        { name: 'Gray', value: '#e5e5e5' },
        { name: 'Yellow', value: '#fbbf24' },
        { name: 'Green', value: '#4ade80' },
        { name: 'Cyan', value: '#22d3ee' },
        { name: 'Purple', value: '#c084fc' },
    ];

    // Font size classes
    const FONT_SIZES = {
        sm: 'text-lg md:text-xl',
        md: 'text-xl md:text-2xl',
        lg: 'text-2xl md:text-3xl',
        xl: 'text-3xl md:text-4xl',
    };

    // Debounce ref for interim translation
    const interimTranslateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // TTS: reads from translatedInterim (the already-computed Malayalam subtitle text) directly.
    // This means zero additional translation latency AND the audio matches what the subtitle shows.
    // We track English interimText for sentence/word detection and Malayalam translatedInterim for speaking.
    const lastEnglishSpokenLenRef = useRef(0);  // offset into interimText
    const lastMLSpokenLenRef = useRef(0);       // offset into translatedInterim
    const ttsPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // While dubbing is off, keep the pointers caught up so we only speak
        // the current unfinished sentence when dubbing is later enabled.
        if (!tts.isDubbingEnabled) {
            if (interimText) {
                const lastPunctuationMatch = [...interimText.matchAll(/[.!?]/g)].pop();
                if (lastPunctuationMatch && lastPunctuationMatch.index !== undefined) {
                    lastEnglishSpokenLenRef.current = lastPunctuationMatch.index + 1;
                } else {
                    lastEnglishSpokenLenRef.current = 0;
                }
            }
            if (translatedInterim) {
                const lastPunctuationMatch = [...translatedInterim.matchAll(/[.!?।]/g)].pop();
                if (lastPunctuationMatch && lastPunctuationMatch.index !== undefined) {
                    lastMLSpokenLenRef.current = lastPunctuationMatch.index + 1;
                } else {
                    lastMLSpokenLenRef.current = 0;
                }
            }
            return;
        }

        if (ttsPendingTimerRef.current) clearTimeout(ttsPendingTimerRef.current);
        if (!interimText || !translatedInterim) { return; }
        if (interimText.length < lastEnglishSpokenLenRef.current) { lastEnglishSpokenLenRef.current = 0; lastMLSpokenLenRef.current = 0; }

        const newEnglish = interimText.slice(lastEnglishSpokenLenRef.current).trim();
        const newML = translatedInterim.slice(lastMLSpokenLenRef.current).trim();
        if (!newEnglish || !newML) return;

        const speakNow = () => {
            const phraseML = translatedInterim.slice(lastMLSpokenLenRef.current).trim();
            if (!phraseML) return;
            lastEnglishSpokenLenRef.current = interimText.length;
            lastMLSpokenLenRef.current = translatedInterim.length;
            // Speak the already-translated Malayalam — no API call needed!
            if (targetLanguage !== 'en') {
                tts.speak(phraseML, targetLanguage);
            } else {
                tts.speak(interimText.slice(lastEnglishSpokenLenRef.current).trim() || phraseML, targetLanguage);
            }
        };

        if (/[.!?]$/.test(interimText.trim())) {
            speakNow();
        } else {
            const wordCount = newEnglish.split(/\s+/).filter(Boolean).length;
            const delay = wordCount >= 6 ? 300 : 1000;
            ttsPendingTimerRef.current = setTimeout(speakNow, delay);
        }

        return () => { if (ttsPendingTimerRef.current) clearTimeout(ttsPendingTimerRef.current); };
    }, [interimText, translatedInterim, tts.isDubbingEnabled, targetLanguage]);

    // When Whisper refines text, advance the spoken pointer to avoid re-speaking.
    useEffect(() => {
        if (!tts.isDubbingEnabled || !text) return;
        if (text.length > lastEnglishSpokenLenRef.current) {
            lastEnglishSpokenLenRef.current = text.length;
        }
        if (translatedText && translatedText.length > lastMLSpokenLenRef.current) {
            lastMLSpokenLenRef.current = translatedText.length;
        }
    }, [text, translatedText]);

    // Immediately speak when dubbing is turned ON (no waiting for next text update)
    const prevDubbingRef = useRef(false);
    useEffect(() => {
        const wasOff = !prevDubbingRef.current;
        const isNowOn = tts.isDubbingEnabled;
        prevDubbingRef.current = isNowOn;

        if (!wasOff || !isNowOn) return;

        // Speak whatever Malayalam is already on screen since the last sentence
        const phraseML = translatedInterim
            ? translatedInterim.slice(lastMLSpokenLenRef.current).trim()
            : '';
        if (phraseML && targetLanguage !== 'en') {
            lastEnglishSpokenLenRef.current = interimText.length;
            lastMLSpokenLenRef.current = translatedInterim.length;
            tts.speak(phraseML, targetLanguage);
        }
    }, [tts.isDubbingEnabled]);

    // Reset on language change + pre-warm TTS for new language
    useEffect(() => {
        tts.stop();
        lastEnglishSpokenLenRef.current = 0;
        lastMLSpokenLenRef.current = 0;
        if (ttsPendingTimerRef.current) clearTimeout(ttsPendingTimerRef.current!);
        warmVoice(targetLanguage);
    }, [targetLanguage]);



    // Auto-Ducking Logic
    useEffect(() => {
        if (!isMonitoring) {
            setMonitorVolume(0);
            return;
        }
        // Duck when TTS is speaking
        if (autoDucking && tts.isSpeaking) {
            setMonitorVolume(0);
        } else {
            setMonitorVolume(monitorSliderVolume);
        }
    }, [isMonitoring, autoDucking, tts.isSpeaking, setMonitorVolume, monitorSliderVolume]);

    // Update recording duration timer
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;
        if (isRecording && recordingStartTime) {
            interval = setInterval(() => {
                setRecordingDuration(Math.floor((Date.now() - recordingStartTime) / 1000));
            }, 1000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isRecording, recordingStartTime]);

    // Capture transcript while recording
    useEffect(() => {
        if (isRecording && text) {
            const lastEntry = transcriptBufferRef.current[transcriptBufferRef.current.length - 1] || '';
            // text may be a rolling/cumulative transcript — only store the new delta
            if (text !== lastEntry) {
                if (lastEntry && text.startsWith(lastEntry)) {
                    // Rolling transcript: store only the newly added words
                    const newPart = text.slice(lastEntry.length).trim();
                    if (newPart) transcriptBufferRef.current.push(newPart);
                } else {
                    // New distinct segment
                    transcriptBufferRef.current.push(text);
                }
            }
        }
    }, [text, isRecording]);

    useEffect(() => {
        // Hook into console.log to capture logs on screen
        const originalLog = console.log;
        const originalError = console.error;

        console.log = (...args) => {
            const msg = args.map(a => {
                if (typeof a === 'object') {
                    try {
                        return JSON.stringify(a);
                    } catch {
                        return '[Object]';
                    }
                }
                return String(a);
            }).join(' ');
            setLogs(prev => [msg, ...prev].slice(0, 10)); // Keep last 10 logs
            originalLog(...args);
        };
        console.error = (...args) => {
            const msg = "ERR: " + args.map(a => String(a)).join(' ');
            setLogs(prev => [msg, ...prev].slice(0, 10));
            originalError(...args);
        };

        return () => {
            console.log = originalLog;
            console.error = originalError;
        };
    }, []);

    useEffect(() => {
        channelRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        return () => {
            channelRef.current?.close();
        };
    }, []);

    // Translate final text - only translate new portions to keep existing text stable
    const lastTranslatedLengthRef = useRef(0);
    const stableTranslatedRef = useRef('');

    useEffect(() => {
        if (targetLanguage === 'en') {
            setTranslatedText(text);
            lastTranslatedLengthRef.current = 0;
            stableTranslatedRef.current = '';
            return;
        }

        if (!text) {
            setTranslatedText('');
            lastTranslatedLengthRef.current = 0;
            stableTranslatedRef.current = '';
            return;
        }

        // Only translate new content (what was added since last translation)
        const previousLength = lastTranslatedLengthRef.current;

        // If text is shorter or same, just update (probably a correction)
        if (text.length <= previousLength) {
            // Re-translate everything for corrections
            setIsTranslating(true);
            translateText(text, targetLanguage, true)
                .then(translated => {
                    stableTranslatedRef.current = translated;
                    setTranslatedText(translated);
                    lastTranslatedLengthRef.current = text.length;
                    setIsTranslating(false);
                })
                .catch(() => {
                    setTranslatedText(stableTranslatedRef.current || text);
                    setIsTranslating(false);
                });
            return;
        }

        // Text got longer - only translate the new part and append
        const newContent = text.slice(previousLength).trim();
        if (newContent.length > 0) {
            setIsTranslating(true);
            translateText(newContent, targetLanguage, false)
                .then(translated => {
                    const combined = stableTranslatedRef.current
                        ? stableTranslatedRef.current + ' ' + translated
                        : translated;
                    stableTranslatedRef.current = combined;
                    setTranslatedText(combined);
                    lastTranslatedLengthRef.current = text.length;
                    setIsTranslating(false);
                })
                .catch(() => {
                    setTranslatedText(stableTranslatedRef.current || text);
                    setIsTranslating(false);
                });
        }
    }, [text, targetLanguage]);

    // Translate interim text with debouncing - seamless like English
    const lastInterimRef = useRef('');

    useEffect(() => {
        if (targetLanguage === 'en') {
            setTranslatedInterim(interimText);
            return;
        }

        if (!interimText) {
            setTranslatedInterim('');
            lastInterimRef.current = '';
            return;
        }

        // Keep showing last translation while waiting (prevents blank state)
        // Only update lastInterimRef when we get a new translation

        // Debounce interim translation
        if (interimTranslateTimeoutRef.current) {
            clearTimeout(interimTranslateTimeoutRef.current);
        }

        interimTranslateTimeoutRef.current = setTimeout(() => {
            translateInterim(interimText, targetLanguage)
                .then(translated => {
                    lastInterimRef.current = translated;
                    setTranslatedInterim(translated);
                })
                .catch(() => {
                    // On error, keep last known translation or show original
                    setTranslatedInterim(lastInterimRef.current || interimText);
                });
        }, 50); // 50ms debounce for fastest translation

        return () => {
            if (interimTranslateTimeoutRef.current) {
                clearTimeout(interimTranslateTimeoutRef.current);
            }
        };
    }, [interimText, targetLanguage]);

    // Send text and style settings to overlay IMMEDIATELY for low latency
    // Use refs for style to avoid extra dependencies
    const styleRef = useRef({ fontSize, showBackground, textColor });
    useEffect(() => {
        styleRef.current = { fontSize, showBackground, textColor };
    }, [fontSize, showBackground, textColor]);

    // Immediate send function for lowest latency
    const sendToOverlay = useCallback((displayText: string, displayInterim: string) => {
        const styleSettings = styleRef.current;

        if (channelRef.current) {
            sendMessage(channelRef.current, 'TRANSCRIPT', {
                text: displayText,
                interim: displayInterim,
                style: styleSettings
            });
        }
        if (window.electron) {
            window.electron.sendTranscript({
                text: displayText,
                interim: displayInterim,
                style: styleSettings
            });
        }
    }, []);

    // For English: Send immediately without translation delay
    useEffect(() => {
        if (targetLanguage === 'en') {
            sendToOverlay(text, interimText);
        }
    }, [text, interimText, targetLanguage, sendToOverlay]);

    // For other languages: Send when translation completes
    useEffect(() => {
        if (targetLanguage !== 'en') {
            sendToOverlay(translatedText, translatedInterim);
        }
    }, [translatedText, translatedInterim, targetLanguage, sendToOverlay]);

    // Also send when style changes
    useEffect(() => {
        const displayText = targetLanguage === 'en' ? text : translatedText;
        const displayInterim = targetLanguage === 'en' ? interimText : translatedInterim;
        sendToOverlay(displayText, displayInterim);
    }, [fontSize, showBackground, textColor]);

    const openPopup = () => {
        if (window.electron) {
            window.electron.toggleOverlay();
        } else {
            window.open(
                window.location.origin + '?mode=popup',
                'SubtitlePopup',
                'width=800,height=200,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
            );
        }
    };

    const toggleListening = useCallback(() => {
        if (isListening) {
            stopListening();
        } else {
            // Clear translation context when starting new session
            clearTranslationContext();
            setTranslatedText('');
            setTranslatedInterim('');
            startListening();
        }
    }, [isListening, startListening, stopListening]);

    const handleLanguageChange = (lang: SupportedLanguage) => {
        setTargetLanguage(lang);
        setShowLanguageMenu(false);
        // Clear context when changing language
        clearTranslationContext();
        lastEnglishSpokenLenRef.current = 0;
        // Re-translate current text
        if (text && lang !== 'en') {
            setIsTranslating(true);
            translateText(text, lang, false)
                .then(translated => {
                    setTranslatedText(translated);
                    setIsTranslating(false);
                });
        } else {
            setTranslatedText(text);
        }
    };

    // Session Recording Functions
    const startRecording = useCallback(() => {
        transcriptBufferRef.current = [];
        setRecordingStartTime(Date.now());
        setRecordingDuration(0);
        setIsRecording(true);
        setCurrentSummary(null);
        setSummaryError(null);

        // Also start listening if not already
        if (!isListening) {
            clearTranslationContext();
            setTranslatedText('');
            setTranslatedInterim('');
            startListening();
        }
    }, [isListening, startListening]);

    const stopRecording = useCallback(async () => {
        // Guard against multiple clicks - prevent duplicate API calls
        if (isSummarizingRef.current) {
            console.log('[Dashboard] Summarization already in progress, ignoring click');
            return;
        }
        isSummarizingRef.current = true;

        setIsRecording(false);
        const endTime = Date.now();
        const startTime = recordingStartTime || endTime;
        const duration = Math.floor((endTime - startTime) / 1000);

        // Collect all transcript text
        const fullTranscript = transcriptBufferRef.current.join(' ').trim();

        if (!fullTranscript) {
            setSummaryError('No transcript captured during recording.');
            isSummarizingRef.current = false;
            return;
        }

        // Create session object
        const sessionId = generateSessionId();
        const session: Session = {
            id: sessionId,
            startedAt: new Date(startTime).toISOString(),
            endedAt: new Date(endTime).toISOString(),
            transcript: fullTranscript,
            summary: null,
            language: targetLanguage,
            duration
        };

        // Save session first (without summary)
        saveSession(session);

        // Store transcript and metadata for display
        setCurrentSessionId(sessionId);
        setCurrentTranscript(fullTranscript);
        setCurrentFormattedTranscript(''); // reset until generated
        setCurrentRecordedAt(new Date(startTime).toISOString());
        setCurrentDuration(duration);

        // Show summary panel with loading state
        setShowSummaryPanel(true);
        setIsSummarizing(true);
        setCurrentFormattedTranscript(''); // reset translated transcript
        setSummaryError(null);

        // Summary via DeepSeek streaming (runs independently)
        const handleSummary = async () => {
            try {
                setSummaryStreamText(''); // clear any previous stream
                const summaryResult = await summarizeConversation(
                    fullTranscript,
                    geminiApiKey,
                    summaryLanguage,
                    (partial) => setSummaryStreamText(partial) // update live as tokens arrive
                );
                if (summaryResult.success) {
                    setCurrentSummary(summaryResult.summary);
                    session.summary = summaryResult.summary;
                    session.summariesByLanguage = {
                        ...(session.summariesByLanguage || {}),
                        [summaryLanguage]: summaryResult.summary
                    };
                    saveSummaryToSupabase(
                        sessionId,
                        fullTranscript,
                        JSON.stringify(summaryResult.summary),
                        summaryLanguage
                    );
                } else {
                    setSummaryError(summaryResult.error.message);
                }
            } catch (err: any) {
                console.error("Summarization error:", err);
                setSummaryError("An unexpected error occurred while generating the summary.");
            } finally {
                setSummaryStreamText('');
                setIsSummarizing(false);
                isSummarizingRef.current = false;
                try { saveSession(session); } catch (e: any) { console.warn("Storage warning:", e.message); }
            }
        };

        // Transcript: no formatting, just save raw. Translation happens on language switch.
        setCurrentFormattedTranscript(''); // English = no translation needed

        handleSummary();
    }, [recordingStartTime, geminiApiKey, targetLanguage, summaryLanguage]);

    const handleSelectSession = (session: Session) => {
        setCurrentSessionId(session.id);
        const cached = session.summariesByLanguage?.en || session.summary;
        setCurrentSummary(cached);
        setCurrentTranscript(session.transcript);
        setCurrentFormattedTranscript(''); // Reset — translate on demand
        setCurrentRecordedAt(session.startedAt);
        setCurrentDuration(session.duration);
        setSummaryLanguage('en'); // Reset language for historical sessions
        setSummaryError(null);
        setIsSummarizing(false);
        setShowSessionHistory(false);
        setShowSummaryPanel(true);
    };

    // Handle translate summary to different language
    const handleTranslateSummary = useCallback(async (language: 'en' | 'ml') => {
        if (!currentTranscript || isSummarizing) return;

        setSummaryLanguage(language);
        setSummaryError(null);

        // If switching back to English: show raw transcript, load cached English summary
        if (language === 'en') {
            setCurrentFormattedTranscript('');
            const stored = currentSessionId ? getSession(currentSessionId) : null;
            const cachedEn = stored?.summariesByLanguage?.['en'];
            if (cachedEn) {
                setCurrentSummary(cachedEn);
                return;
            }
            // Fetch English summary if not cached
            setIsSummarizing(true);
            try {
                const res = await summarizeConversation(currentTranscript, geminiApiKey, 'en');
                if (res.success) {
                    setCurrentSummary(res.summary);
                    if (currentSessionId) {
                        const s = getSession(currentSessionId);
                        if (s) {
                            s.summariesByLanguage = { ...(s.summariesByLanguage || {}), en: res.summary };
                            try { saveSession(s); } catch {}
                        }
                    }
                } else {
                    setSummaryError(res.error.message);
                }
            } catch { setSummaryError('An unexpected error occurred.'); }
            finally { setIsSummarizing(false); }
            return;
        }

        // Malayalam: translate the English summary fields via Google Translate (fast) + transcript via Google Translate
        const stored = currentSessionId ? getSession(currentSessionId) : null;
        const cachedSummary = stored?.summariesByLanguage?.[language];
        const cachedTranscript = stored?.formattedTranscriptsByLanguage?.[language];

        const doSummary = async () => {
            if (cachedSummary) { setCurrentSummary(cachedSummary); return; }

            // Get English summary first (from cache or DeepSeek — one-time cost)
            let enSummary = stored?.summariesByLanguage?.['en'] || currentSummary;
            if (!enSummary) {
                setIsSummarizing(true);
                try {
                    const res = await summarizeConversation(currentTranscript, geminiApiKey, 'en');
                    if (res.success) enSummary = res.summary;
                    else { setSummaryError(res.error.message); return; }
                } catch { setSummaryError('An unexpected error occurred.'); return; }
                finally { setIsSummarizing(false); }
            }

            // Translate each summary field via Google Translate — fast, no extra DeepSeek call
            setIsSummarizing(true);
            try {
                const [brief, ...kpRaw] = await Promise.all([
                    translateLongText(enSummary.briefSummary, language),
                    ...enSummary.keyPoints.map(p => translateLongText(p, language)),
                ]);
                const topicsTranslated = await Promise.all(enSummary.topics.map(t => translateLongText(t, language)));
                const actionsTranslated = await Promise.all(enSummary.actionItems.map(a => translateLongText(a, language)));

                const mlSummary = {
                    briefSummary: brief,
                    keyPoints: kpRaw,
                    topics: topicsTranslated,
                    actionItems: actionsTranslated,
                };
                setCurrentSummary(mlSummary);

                if (currentSessionId && stored) {
                    stored.summariesByLanguage = { ...(stored.summariesByLanguage || {}), [language]: mlSummary };
                    try { saveSession(stored); } catch (e: any) { console.warn('Storage warning:', e.message); }
                }
            } catch (err) {
                console.error('Summary translation error:', err);
            } finally {
                setIsSummarizing(false);
            }
        };

        const doTranscript = async () => {
            if (cachedTranscript) { setCurrentFormattedTranscript(cachedTranscript); return; }
            setIsTranslatingTranscript(true);
            try {
                const translated = await translateLongText(currentTranscript, language);
                setCurrentFormattedTranscript(translated);
                if (currentSessionId && stored) {
                    stored.formattedTranscriptsByLanguage = {
                        ...(stored.formattedTranscriptsByLanguage || {}),
                        [language]: translated
                    };
                    try { saveSession(stored); } catch (e: any) { console.warn('Storage warning:', e.message); }
                }
            } catch (err) {
                console.error('Transcript translation error:', err);
                setCurrentFormattedTranscript(currentTranscript); // fallback: show raw
            } finally {
                setIsTranslatingTranscript(false);
            }
        };

        doSummary();
        doTranscript();
    }, [currentTranscript, geminiApiKey, isSummarizing, currentSessionId, currentSummary]);

    // Sync state to widget
    useEffect(() => {
        if (channelRef.current) {
            sendMessage(channelRef.current, 'APP_STATE', {
                isListening,
                isRecording,
                targetLanguage
            });
        }
    }, [isListening, isRecording, targetLanguage]);

    // Handle widget commands
    useEffect(() => {
        if (!channelRef.current) return;
        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === 'WIDGET_COMMAND') {
                const { command, value } = event.data.payload;
                if (command === 'TOGGLE_LISTENING') {
                    toggleListening();
                } else if (command === 'TOGGLE_RECORDING') {
                    if (isRecording) stopRecording();
                    else startRecording();
                } else if (command === 'SET_LANGUAGE') {
                    handleLanguageChange(value);
                }
            }
        };
        channelRef.current.addEventListener('message', handleMessage);
        return () => {
            channelRef.current?.removeEventListener('message', handleMessage);
        };
    }, [toggleListening, isRecording, startRecording, stopRecording, handleLanguageChange]);

    const formatRecordingTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const currentLanguage = LANGUAGES.find(l => l.code === targetLanguage);

    return (
        <div className="h-screen bg-black text-white font-mono flex flex-col justify-between p-8 overflow-hidden select-none">
            {/* Header */}
            <header className="flex justify-between items-start">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center border border-gray-800 relative overflow-hidden">
                        {/* Audio Level Background */}
                        <div
                            className="absolute bottom-0 left-0 right-0 bg-purple-500/20 transition-all duration-75"
                            style={{ height: `${audioLevel}%` }}
                        ></div>
                        <Mic className={`w-6 h-6 z-10 ${isListening ? 'text-purple-500 animate-pulse' : 'text-gray-500'}`} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-wider text-white">LUMINA</h1>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></span>
                            <span className="text-xs text-gray-500 uppercase tracking-widest">
                                {isListening ? 'LISTENING' : 'IDLE'}
                                {isListening && <span className="text-gray-600 ml-2">VOL: {audioLevel}</span>}
                            </span>
                            {/* Recording Indicator */}
                            {isRecording && (
                                <span className="flex items-center gap-1 ml-2 text-red-400">
                                    <Circle className="w-2 h-2 fill-red-500 animate-pulse" />
                                    <span className="text-xs font-mono">{formatRecordingTime(recordingDuration)}</span>
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Session History Button */}
                    <button
                        onClick={() => setShowSessionHistory(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-full border border-gray-800 text-xs font-bold tracking-widest text-gray-400 hover:text-white hover:border-gray-600 transition-all uppercase"
                    >
                        <History className="w-4 h-4" />
                        <span>History</span>
                    </button>

                    {/* Record Session Button */}
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={isModelLoading || isSummarizing}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all uppercase ${isRecording
                            ? 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
                            : 'border border-purple-500/50 text-purple-400 hover:bg-purple-500/20'
                            }`}
                    >
                        {isRecording ? (
                            <>
                                <Square className="w-3 h-3 fill-red-400" />
                                <span>Stop</span>
                            </>
                        ) : (
                            <>
                                <Circle className="w-3 h-3 fill-purple-400" />
                                <span>Record</span>
                            </>
                        )}
                    </button>

                    {/* Language Selector */}
                    <div className="relative">
                        <button
                            onClick={() => setShowLanguageMenu(!showLanguageMenu)}
                            className="flex items-center gap-2 px-4 py-2 rounded-full border border-gray-800 text-xs font-bold tracking-widest text-gray-400 hover:text-white hover:border-gray-600 transition-all uppercase"
                        >
                            <Globe className="w-4 h-4" />
                            <span>{currentLanguage?.nativeName}</span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${showLanguageMenu ? 'rotate-180' : ''}`} />
                        </button>

                        {showLanguageMenu && (
                            <div className="absolute top-full right-0 mt-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl z-50 min-w-[160px]">
                                {LANGUAGES.map(lang => (
                                    <button
                                        key={lang.code}
                                        onClick={() => handleLanguageChange(lang.code)}
                                        className={`w-full px-4 py-3 text-left text-sm hover:bg-gray-800 transition-colors flex items-center justify-between ${lang.code === targetLanguage ? 'bg-gray-800 text-purple-400' : 'text-gray-300'
                                            }`}
                                    >
                                        <span>{lang.nativeName}</span>
                                        <span className="text-xs text-gray-600">{lang.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Dubbing Toggle */}
                    <div className="relative group">
                        <button
                            onClick={() => tts.toggleDubbing(targetLanguage)}
                            title={
                                tts.engineStatus === 'error'
                                    ? `TTS Error: ${tts.engineError}`
                                    : tts.isDubbingEnabled
                                        ? 'Dubbing ON — click to disable'
                                        : `Enable ${currentLanguage?.nativeName} audio dubbing`
                            }
                            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all uppercase border ${tts.engineStatus === 'error'
                                ? 'border-red-700/50 text-red-500 cursor-help'
                                : tts.isDubbingEnabled
                                    ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                                    : 'border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                                }`}
                        >
                            {tts.engineStatus === 'error' ? (
                                <>
                                    <VolumeX className="w-4 h-4" />
                                    <span>Dubbing</span>
                                    <span className="text-red-500 text-[10px]">!</span>
                                </>
                            ) : tts.isDubbingEnabled ? (
                                <>
                                    <Volume2 className={`w-4 h-4 ${tts.isSpeaking ? 'animate-pulse' : ''}`} />
                                    <span>Dubbing</span>
                                    {tts.isSpeaking && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                                </>
                            ) : (
                                <>
                                    <VolumeX className="w-4 h-4" />
                                    <span>Dubbing</span>
                                </>
                            )}
                        </button>
                    </div>


                    {/* Text Customization Settings */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                            className="flex items-center gap-2 px-4 py-2 rounded-full border border-gray-800 text-xs font-bold tracking-widest text-gray-400 hover:text-white hover:border-gray-600 transition-all uppercase"
                        >
                            <Settings className="w-4 h-4" />
                            <span>Style</span>
                        </button>

                        {showSettingsMenu && (
                            <div className="absolute top-full right-0 mt-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl z-50 w-72 p-4">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <Type className="w-4 h-4" />
                                    Text & Audio Settings
                                </h3>

                                {/* Audio Monitoring Toggle */}
                                <div className="mb-4">
                                    <label className="text-xs text-gray-500 block mb-2 flex items-center gap-2">
                                        <Volume2 className="w-3 h-3" />
                                        Audio Monitoring
                                    </label>
                                    <div className="flex gap-2 mb-2">
                                        <button
                                            onClick={() => setIsMonitoring(!isMonitoring)}
                                            className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center justify-center gap-2 ${isMonitoring
                                                ? 'bg-cyan-600 text-white'
                                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                }`}
                                        >
                                            {isMonitoring ? 'Monitor On' : 'Monitor Off'}
                                        </button>
                                        <button
                                            onClick={() => setAutoDucking(!autoDucking)}
                                            className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center justify-center gap-2 ${autoDucking
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                }`}
                                        >
                                            {autoDucking ? 'Auto-Duck On' : 'Auto-Duck Off'}
                                        </button>
                                    </div>
                                    {isMonitoring && (
                                        <div className="mt-2">
                                            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                                <span>Monitor Volume</span>
                                                <span>{Math.round(monitorSliderVolume * 100)}%</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max="1"
                                                step="0.05"
                                                value={monitorSliderVolume}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    setMonitorSliderVolume(v);
                                                    // Only immediately update gain if not currently ducking
                                                    if (isMonitoring && !(autoDucking && tts.isSpeaking)) {
                                                        setMonitorVolume(v);
                                                    }
                                                }}
                                                className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                                            />
                                        </div>
                                    )}
                                    <p className="text-[9px] text-gray-600 mt-2 leading-tight">
                                        * Mute the source application (Chrome/VLC) when using Monitor to avoid echo.
                                    </p>
                                </div>

                                {/* Font Size */}
                                <div className="mb-4">
                                    <label className="text-xs text-gray-500 block mb-2">Font Size</label>
                                    <div className="flex gap-2">
                                        {(['sm', 'md', 'lg', 'xl'] as const).map(size => (
                                            <button
                                                key={size}
                                                onClick={() => setFontSize(size)}
                                                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-colors ${fontSize === size
                                                    ? 'bg-purple-600 text-white'
                                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                    }`}
                                            >
                                                {size}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Background Toggle */}
                                <div className="mb-4">
                                    <label className="text-xs text-gray-500 block mb-2">Background</label>
                                    <button
                                        onClick={() => setShowBackground(!showBackground)}
                                        className={`w-full py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center justify-center gap-2 ${showBackground
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                            }`}
                                    >
                                        <div className={`w-4 h-4 rounded border ${showBackground ? 'bg-black border-white' : 'bg-transparent border-gray-600'}`}></div>
                                        {showBackground ? 'Background On' : 'Background Off'}
                                    </button>
                                </div>

                                {/* Text Color */}
                                <div className="mb-4">
                                    <label className="text-xs text-gray-500 block mb-2 flex items-center gap-2">
                                        <Palette className="w-3 h-3" />
                                        Text Color
                                    </label>
                                    <div className="grid grid-cols-6 gap-2">
                                        {TEXT_COLORS.map(color => (
                                            <button
                                                key={color.value}
                                                onClick={() => setTextColor(color.value)}
                                                className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${textColor === color.value
                                                    ? 'border-white shadow-[0_0_10px_rgba(255,255,255,0.5)]'
                                                    : 'border-gray-700'
                                                    }`}
                                                style={{ backgroundColor: color.value }}
                                                title={color.name}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Summary Language Selector */}
                                <div className="pt-3 border-t border-gray-800">
                                    <label className="text-xs text-gray-500 block mb-2 flex items-center gap-2">
                                        <Globe className="w-3 h-3" />
                                        Summary Language
                                    </label>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSummaryLanguage('en')}
                                            className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-colors ${summaryLanguage === 'en'
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                }`}
                                        >
                                            English
                                        </button>
                                        <button
                                            onClick={() => setSummaryLanguage('ml')}
                                            className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-colors ${summaryLanguage === 'ml'
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                }`}
                                        >
                                            മലയാളം
                                        </button>
                                    </div>
                                </div>

                                <div className="pt-3 border-t border-gray-800">
                                    <label className="text-xs text-gray-500 block mb-2 flex items-center gap-2">
                                        <Gauge className="w-3 h-3" />
                                        Dubbing Speed
                                        <span className="ml-auto text-gray-400 font-mono">{tts.speechRate.toFixed(1)}x</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="0.5"
                                        max="2.0"
                                        step="0.1"
                                        value={tts.speechRate}
                                        onChange={(e) => tts.setSpeechRate(parseFloat(e.target.value))}
                                        className="w-full accent-cyan-500 cursor-pointer"
                                    />
                                    <div className="flex justify-between text-[10px] text-gray-700 mt-1">
                                        <span>Slow</span>
                                        <span>Normal</span>
                                        <span>Fast</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={openPopup}
                        className="px-6 py-2 rounded-full border border-gray-800 text-xs font-bold tracking-widest text-gray-400 hover:text-white hover:border-gray-600 transition-all uppercase"
                    >
                        Overlay View
                    </button>
                    <button
                        onClick={error ? reloadModel : toggleListening}
                        disabled={isModelLoading}
                        className={`px-6 py-2 rounded-full text-xs font-bold tracking-widest transition-all uppercase shadow-[0_0_20px_rgba(255,255,255,0.3)] 
                            ${(isModelLoading)
                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : (error ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-black hover:bg-gray-200')}`}
                    >
                        {error ? 'Retry Connection' : (isModelLoading ? 'Initializing Model...' : (isListening ? 'Stop Feed' : 'Launch Feed'))}
                    </button>
                </div>
            </header>

            {/* Center Content / Visualizer */}
            <main className="flex flex-col items-center justify-center flex-1 relative w-full">
                {/* Debug Console Overlay */}
                <div className="absolute top-0 right-0 p-4 w-96 font-mono text-[10px] text-gray-500 pointer-events-none opacity-50 text-right">
                    {logs.map((log, i) => (
                        <div key={i} className="whitespace-pre-wrap mb-1">{log}</div>
                    ))}
                </div>

                {/* Error Toast */}
                {error && (
                    <div className="absolute top-0 mt-4 px-4 py-2 bg-red-900/80 border border-red-500/50 rounded-full flex items-center gap-2 backdrop-blur-sm animate-pulse z-50">
                        <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                        <span className="text-xs text-red-200 uppercase tracking-wider">{error}</span>
                    </div>
                )}

                {/* Translation Indicator */}
                {isTranslating && targetLanguage !== 'en' && (
                    <div className="absolute top-0 mt-4 px-3 py-1 bg-purple-900/50 border border-purple-500/30 rounded-full flex items-center gap-2 backdrop-blur-sm">
                        <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-purple-300">Translating...</span>
                    </div>
                )}

                {/* Visualizer - Reacts to Audio Level */}
                <div className={`flex items-end gap-2 h-16 mb-8 transition-all duration-500 ${isListening ? 'opacity-100 scale-100' : 'opacity-30 scale-90'}`}>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75" style={{ height: `${Math.max(8, audioLevel * 0.5)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75 delay-75" style={{ height: `${Math.max(12, audioLevel * 0.8)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75" style={{ height: `${Math.max(16, audioLevel * 1.2)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75 delay-75" style={{ height: `${Math.max(12, audioLevel * 0.9)}px` }}></div>
                    <div className="w-2 bg-purple-500 rounded-full transition-all duration-75" style={{ height: `${Math.max(8, audioLevel * 0.6)}px` }}></div>
                </div>

                <div className="text-center max-w-3xl px-8">
                    <p className={`text-gray-600 text-sm tracking-[0.2em] uppercase mb-4 transition-opacity ${isListening ? 'opacity-100' : 'opacity-50'}`}>
                        {error ? 'System Offline' : isListening ? `Capturing Audio Stream${targetLanguage !== 'en' ? ` → ${currentLanguage?.nativeName}` : ''}` : 'System Idle'}
                    </p>
                    {/* Live Transcript Preview */}
                    <div className={`min-h-[60px] px-4 py-2 rounded-xl transition-all ${showBackground ? 'bg-black/80' : ''}`}>
                        {(translatedText || translatedInterim) ? (
                            <p
                                className={`${FONT_SIZES[fontSize]} font-sans leading-relaxed transition-all`}
                                style={{ color: textColor }}
                            >
                                {translatedText} <span className="opacity-70 border-b border-current">{translatedInterim}</span>
                            </p>
                        ) : (
                            <p className="text-gray-800 italic font-serif">...</p>
                        )}
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="grid grid-cols-3 text-[10px] text-gray-600 tracking-widest uppercase border-t border-gray-900/50 pt-8">
                <div>
                    <h3 className="text-gray-500 mb-2 font-bold">Control</h3>
                    <div className="flex items-center gap-2">
                        <span className="border border-gray-700 px-2 py-1 rounded text-gray-400">ESC</span>
                        <span>Toggle Interface</span>
                    </div>
                </div>
                <div>
                    <h3 className="text-gray-500 mb-2 font-bold">Language</h3>
                    <div className="flex items-center gap-2">
                        <Globe className="w-3 h-3 text-purple-500" />
                        <span className="text-purple-400">{currentLanguage?.nativeName}</span>
                        {targetLanguage !== 'en' && (
                            <span className="text-gray-700 normal-case tracking-normal">• Context-aware translation</span>
                        )}
                    </div>
                </div>
                <div>
                    <h3 className="text-gray-500 mb-2 font-bold">Core</h3>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${engineStatus.vosk === 'ready' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' : engineStatus.vosk === 'loading' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`}></span>
                            <span>Vosk</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${engineStatus.whisper === 'ready' ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]' : engineStatus.whisper === 'loading' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`}></span>
                            <span>Whisper</span>
                        </div>
                        {geminiApiKey && (
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]"></span>
                                <span>Gemini</span>
                            </div>
                        )}
                        <div className="flex items-center gap-2" title={
                            tts.engineStatus === 'error' ? `TTS Error: ${tts.engineError}`
                                : tts.engineStatus === 'speaking' ? `${currentLanguage?.name} TTS speaking`
                                    : tts.isDubbingEnabled ? `${currentLanguage?.name} TTS active`
                                        : `${currentLanguage?.name} TTS ready (enable Dubbing)`
                        }>
                            <span className={`w-1.5 h-1.5 rounded-full ${tts.engineStatus === 'error' ? 'bg-red-500'
                                : tts.engineStatus === 'speaking'
                                    ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] animate-pulse'
                                    : tts.isDubbingEnabled
                                        ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]'
                                        : 'bg-gray-600'
                                }`}></span>
                            <span className={tts.isDubbingEnabled ? 'text-cyan-400' : ''}>TTS</span>
                        </div>
                    </div>
                </div>
            </footer>

            {/* Click outside to close menus */}
            {(showLanguageMenu || showSettingsMenu) && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                        setShowLanguageMenu(false);
                        setShowSettingsMenu(false);
                    }}
                />
            )}

            {/* Summary View */}
            {showSummaryPanel && (
                <SummaryView
                    summary={currentSummary}
                    isLoading={isSummarizing}
                    error={summaryError}
                    transcript={currentTranscript}
                    formattedTranscript={currentFormattedTranscript}
                    isFormattingTranscript={isTranslatingTranscript}
                    duration={currentDuration}
                    recordedAt={currentRecordedAt}
                    geminiApiKey={geminiApiKey}
                    streamText={summaryStreamText}
                    onClose={() => {
                        setShowSummaryPanel(false);
                        setSummaryLanguage('en');
                    }}
                    onTranslate={handleTranslateSummary}
                    isTranslating={isSummarizing}
                    currentLanguage={summaryLanguage}
                />
            )}

            {/* Session History Modal */}
            <SessionHistory
                isOpen={showSessionHistory}
                onClose={() => setShowSessionHistory(false)}
                onSelectSession={handleSelectSession}
            />
        </div>
    );
};
