import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Sparkles, ListChecks, Tag, ClipboardList, FileText, ChevronDown, ChevronUp, Clock, Calendar, Languages, MessageCircle, Send, Quote, Volume2, Square } from 'lucide-react';
import type { Summary } from '../types/session';
import { askTranscriptRag, type RagAnswer } from '../utils/gemini';
import { speakText, stopAudio, speakLongText, stopLongText, warmVoice } from '../utils/tts';

interface SummaryViewProps {
    summary: Summary | null;
    isLoading: boolean;
    error?: string | null;
    transcript?: string;
    formattedTranscript?: string;
    isFormattingTranscript?: boolean;
    duration?: number;
    recordedAt?: string;
    onClose: () => void;
    geminiApiKey?: string;
    onTranslate?: (language: 'en' | 'ml') => void;
    isTranslating?: boolean;
    currentLanguage?: 'en' | 'ml';
    streamText?: string;
}

export const SummaryView = ({
    summary,
    isLoading,
    error,
    transcript,
    formattedTranscript,
    isFormattingTranscript = false,
    duration,
    recordedAt,
    onClose,
    geminiApiKey = '',
    onTranslate,
    isTranslating = false,
    currentLanguage = 'en',
    streamText = ''
}: SummaryViewProps) => {
    const RAG_COOLDOWN_MS = 8000;
    const [copied, setCopied] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);
    const [question, setQuestion] = useState('');
    const [ragLoading, setRagLoading] = useState(false);
    const [ragError, setRagError] = useState<string | null>(null);
    const [ragHistory, setRagHistory] = useState<Array<{ question: string; result: RagAnswer }>>([]);
    const lastRagRequestAtRef = useRef(0);
    const ragCacheRef = useRef(new Map<string, RagAnswer>());
    const [playingTTS, setPlayingTTS] = useState(false);
    const [activeChunk, setActiveChunk] = useState<string | null>(null);

    // Pre-warm TTS connection as soon as panel opens so first word plays instantly
    useEffect(() => {
        warmVoice(currentLanguage);
    }, [currentLanguage]);

    const handlePlayTTS = () => {
        if (playingTTS) {
            stopLongText();
            stopAudio();
            setPlayingTTS(false);
            setActiveChunk(null);
            return;
        }

        stopLongText();
        stopAudio();
        setPlayingTTS(true);
        setActiveChunk(null);

        const textToRead = formattedTranscript || transcript;
        const langToUse = formattedTranscript ? currentLanguage : 'en';

        if (!textToRead) {
            setPlayingTTS(false);
            return;
        }

        speakLongText(
            textToRead,
            langToUse,
            1.0,
            () => {},
            () => { setPlayingTTS(false); setActiveChunk(null); },
            (err) => { console.error('TTS Error:', err); setPlayingTTS(false); setActiveChunk(null); },
            (chunkText) => setActiveChunk(chunkText),
            () => setActiveChunk(null)
        );
    };

    const formatDuration = (seconds?: number) => {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (isoString?: string) => {
        if (!isoString) return 'Just now';
        const date = new Date(isoString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const copyToClipboard = () => {
        if (!summary) return;

        const text = `📋 CONVERSATION SUMMARY
========================

📝 Summary:
${summary.briefSummary}

✅ Key Points:
${summary.keyPoints.map(p => `• ${p}`).join('\n')}

🏷️ Topics: ${summary.topics.join(', ')}
${summary.actionItems.length > 0 ? `\n📌 Action Items:\n${summary.actionItems.map(a => `☐ ${a}`).join('\n')}` : ''}
${formattedTranscript ? `\n📄 Formatted Transcript:\n${formattedTranscript}` : transcript ? `\n📄 Full Transcript:\n${transcript}` : ''}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleAskQuestion = async () => {
        if (!transcript || !question.trim() || ragLoading) return;

        const now = Date.now();
        const remainingMs = RAG_COOLDOWN_MS - (now - lastRagRequestAtRef.current);
        if (remainingMs > 0) {
            setRagError(`Please wait ${Math.ceil(remainingMs / 1000)}s before asking another question.`);
            return;
        }

        setRagLoading(true);
        setRagError(null);
        const userQuestion = question.trim();
        const cacheKey = userQuestion.toLowerCase();

        const cached = ragCacheRef.current.get(cacheKey);
        if (cached) {
            setRagHistory(prev => [...prev, { question: userQuestion, result: cached }]);
            setQuestion('');
            setRagLoading(false);
            return;
        }

        lastRagRequestAtRef.current = now;

        const result = await askTranscriptRag(transcript, userQuestion, geminiApiKey);
        if (result.success) {
            ragCacheRef.current.set(cacheKey, result.result);
            setRagHistory(prev => [...prev, { question: userQuestion, result: result.result }]);
            setQuestion('');
        } else {
            setRagError(result.error.message);
        }

        setRagLoading(false);
    };

    return (
        <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col">
            <div className="w-full h-full bg-gradient-to-b from-gray-900 to-gray-950 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-800/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Conversation Summary</h2>
                            <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                                {recordedAt && (
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {formatDate(recordedAt)}
                                    </span>
                                )}
                                {duration && (
                                    <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {formatDuration(duration)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {summary && (
                            <button
                                onClick={copyToClipboard}
                                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors flex items-center gap-2 text-sm"
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-4 h-4 text-green-400" />
                                        <span className="text-green-400">Copied!</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4 text-gray-400" />
                                        <span className="text-gray-300">Copy All</span>
                                    </>
                                )}
                            </button>
                        )}
                        {(formattedTranscript || transcript) && (
                            <button
                                onClick={handlePlayTTS}
                                onMouseEnter={() => !playingTTS && warmVoice(currentLanguage)}
                                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm ${playingTTS ? 'bg-purple-500/30 text-purple-300 animate-pulse border border-purple-500/30' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                            >
                                {playingTTS ? (
                                    <>
                                        <Square className="w-4 h-4 fill-current" />
                                        <span>Stop Reading</span>
                                    </>
                                ) : (
                                    <>
                                        <Volume2 className="w-4 h-4" />
                                        <span>Read Transcript</span>
                                    </>
                                )}
                            </button>
                        )}
                        {summary && onTranslate && (
                            <div className="relative flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-gray-700 hover:border-gray-600 focus-within:border-purple-500/50 transition-colors">
                                <Languages className={`w-4 h-4 ${isTranslating ? 'animate-pulse text-purple-400' : 'text-gray-400'}`} />
                                {isTranslating ? (
                                    <span className="text-sm text-purple-400 pr-6">Translating...</span>
                                ) : (
                                    <select
                                        value={currentLanguage}
                                        onChange={(e) => onTranslate(e.target.value as 'en' | 'ml')}
                                        disabled={isTranslating}
                                        className="bg-transparent text-sm text-gray-300 focus:outline-none cursor-pointer appearance-none pr-6"
                                    >
                                        <option value="en" className="bg-gray-900">English</option>
                                        <option value="ml" className="bg-gray-900">Malayalam (മലയാളം)</option>
                                    </select>
                                )}
                                {!isTranslating && <ChevronDown className="w-4 h-4 text-gray-500 absolute right-2 pointer-events-none" />}
                            </div>
                        )}
                        <button
                            onClick={() => {
                                stopLongText();
                                stopAudio();
                                setActiveChunk(null);
                                onClose();
                            }}
                            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-5xl mx-auto w-full p-6 space-y-6">
                        {isLoading ? (
                        /* Loading State */
                        <div className="space-y-6">
                            <div className="bg-gray-800/50 rounded-2xl p-6">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></span>
                                    <p className="text-sm text-gray-400">Generating summary...</p>
                                </div>
                                {streamText ? (
                                    <div className="font-mono text-xs text-purple-300/80 bg-gray-900/60 rounded-xl p-4 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                                        {streamText}
                                        <span className="inline-block w-1.5 h-3.5 bg-purple-400 ml-0.5 animate-pulse align-middle" />
                                    </div>
                                ) : (
                                    <div className="space-y-3 animate-pulse">
                                        <div className="h-4 bg-gray-700 rounded w-3/4"></div>
                                        <div className="h-4 bg-gray-700 rounded w-full"></div>
                                        <div className="h-4 bg-gray-700 rounded w-5/6"></div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
                                    <div className="h-6 bg-gray-700 rounded w-1/2 mb-4"></div>
                                    <div className="space-y-2">
                                        <div className="h-3 bg-gray-700 rounded"></div>
                                        <div className="h-3 bg-gray-700 rounded"></div>
                                        <div className="h-3 bg-gray-700 rounded"></div>
                                    </div>
                                </div>
                                <div className="flex-1 bg-gray-800/50 rounded-2xl p-4 animate-pulse">
                                    <div className="h-6 bg-gray-700 rounded w-1/2 mb-4"></div>
                                    <div className="flex gap-2 flex-wrap">
                                        <div className="h-6 bg-gray-700 rounded-full w-16"></div>
                                        <div className="h-6 bg-gray-700 rounded-full w-20"></div>
                                        <div className="h-6 bg-gray-700 rounded-full w-14"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : error ? (
                        /* Error State */
                        <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-6 text-center">
                            <p className="text-red-300">{error}</p>
                            <button
                                onClick={() => {
                                    stopLongText();
                                    stopAudio();
                                    setActiveChunk(null);
                                    onClose();
                                }}
                                className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    ) : summary ? (
                        <>
                            {/* Brief Summary Card */}
                            <div className="bg-gradient-to-br from-purple-900/40 to-blue-900/40 border border-purple-500/30 rounded-2xl p-6">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 bg-purple-500/30 rounded-lg flex items-center justify-center flex-shrink-0">
                                        <FileText className="w-4 h-4 text-purple-300" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wider mb-2">Summary</h3>
                                        <p className="text-gray-200 leading-relaxed text-lg">{summary.briefSummary}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Key Points & Topics Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Key Points */}
                                <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5">
                                    <div className="flex items-center gap-2 mb-4">
                                        <ListChecks className="w-5 h-5 text-green-400" />
                                        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Key Points</h3>
                                    </div>
                                    <ul className="space-y-3">
                                        {summary.keyPoints.map((point, i) => (
                                            <li key={i} className="flex items-start gap-3 text-gray-300">
                                                <span className="w-5 h-5 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                                    <span className="text-green-400 text-xs font-bold">{i + 1}</span>
                                                </span>
                                                <span className="text-sm">{point}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                {/* Topics */}
                                <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Tag className="w-5 h-5 text-blue-400" />
                                        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Topics</h3>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {summary.topics.map((topic, i) => (
                                            <span
                                                key={i}
                                                className="px-4 py-2 bg-blue-500/20 text-blue-300 text-sm rounded-full border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
                                            >
                                                {topic}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Action Items */}
                            {summary.actionItems.length > 0 && (
                                <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-2xl p-5">
                                    <div className="flex items-center gap-2 mb-4">
                                        <ClipboardList className="w-5 h-5 text-yellow-400" />
                                        <h3 className="text-sm font-semibold text-yellow-300 uppercase tracking-wider">Action Items</h3>
                                    </div>
                                    <ul className="space-y-3">
                                        {summary.actionItems.map((item, i) => (
                                            <li key={i} className="flex items-start gap-3 text-gray-300">
                                                <span className="w-5 h-5 border-2 border-yellow-500/50 rounded flex-shrink-0 mt-0.5"></span>
                                                <span className="text-sm">{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Transcript (Collapsible) */}
                            {transcript && (
                                <div className="bg-gray-800/30 border border-gray-700/50 rounded-2xl overflow-hidden">
                                    <button
                                        onClick={() => setShowTranscript(!showTranscript)}
                                        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-5 h-5 text-gray-500" />
                                            <span className="text-sm font-medium text-gray-400">Full Transcript</span>
                                        </div>
                                        {showTranscript ? (
                                            <ChevronUp className="w-5 h-5 text-gray-500" />
                                        ) : (
                                            <ChevronDown className="w-5 h-5 text-gray-500" />
                                        )}
                                    </button>
                                    {showTranscript && (
                                        <div className="px-5 pb-5">
                                            {isFormattingTranscript ? (
                                                <div className="flex flex-col items-center justify-center p-8 bg-gray-900/50 rounded-xl border border-gray-800/50">
                                                    <span className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4"></span>
                                                    <p className="text-sm text-gray-400">Translating transcript...</p>
                                                </div>
                                            ) : formattedTranscript ? (
                                                <div className="text-sm leading-loose bg-gray-900/50 rounded-xl p-4 max-h-72 overflow-y-auto">
                                                    {formattedTranscript.split(/(?<=[.!?।])\s+/).filter(Boolean).map((sentence, i) => {
                                                        const isActive = activeChunk !== null && sentence.trim().slice(0, 40) === activeChunk.trim().slice(0, 40);
                                                        return (
                                                            <span
                                                                key={i}
                                                                className={`inline transition-all duration-200 rounded px-0.5 ${
                                                                    isActive
                                                                        ? 'bg-purple-500/40 text-white shadow-[0_0_10px_rgba(168,85,247,0.5)] font-medium'
                                                                        : 'text-gray-300'
                                                                }`}
                                                            >
                                                                {sentence}{' '}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            ) : transcript ? (
                                                <div className="text-sm leading-loose bg-gray-900/50 rounded-xl p-4 max-h-72 overflow-y-auto">
                                                    {transcript.split(/(?<=[.!?])\s+/).filter(Boolean).map((sentence, i) => {
                                                        const isActive = activeChunk !== null && sentence.trim().slice(0, 40) === activeChunk.trim().slice(0, 40);
                                                        return (
                                                            <span
                                                                key={i}
                                                                className={`inline transition-all duration-200 rounded px-0.5 ${
                                                                    isActive
                                                                        ? 'bg-purple-500/40 text-white shadow-[0_0_10px_rgba(168,85,247,0.5)] font-medium'
                                                                        : 'text-gray-300'
                                                                }`}
                                                            >
                                                                {sentence}{' '}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            ) : null}

                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Transcript Q&A (RAG) */}
                            {transcript && (
                                <div className="bg-gray-800/30 border border-gray-700/50 rounded-2xl p-5">
                                    <div className="flex items-center gap-2 mb-4">
                                        <MessageCircle className="w-5 h-5 text-cyan-400" />
                                        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Ask About This Transcript</h3>
                                    </div>

                                    <div className="flex gap-2 mb-3">
                                        <input
                                            value={question}
                                            onChange={(e) => setQuestion(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAskQuestion();
                                                }
                                            }}
                                            placeholder="Ask a topic question (e.g. What did we decide about API architecture?)"
                                            className="flex-1 px-4 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                                        />
                                        <button
                                            onClick={handleAskQuestion}
                                            disabled={ragLoading || !question.trim()}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${ragLoading || !question.trim()
                                                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                                : 'bg-cyan-600/80 hover:bg-cyan-600 text-white'
                                                }`}
                                        >
                                            <Send className="w-4 h-4" />
                                            {ragLoading ? 'Asking...' : 'Ask'}
                                        </button>
                                    </div>

                                    {!geminiApiKey && (
                                        <p className="text-xs text-yellow-300 mb-3">
                                            Set `VITE_GEMINI_API_KEY` in your `.env` file to use transcript Q&A.
                                        </p>
                                    )}

                                    {ragError && (
                                        <p className="text-xs text-red-300 mb-3">{ragError}</p>
                                    )}

                                    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                                        {ragHistory.length === 0 ? (
                                            <p className="text-xs text-gray-500">
                                                Ask questions about topics discussed, decisions made, or action items in this transcript.
                                            </p>
                                        ) : (
                                            ragHistory.map((item, index) => (
                                                <div key={`${item.question}-${index}`} className="bg-gray-900/50 border border-gray-700/60 rounded-xl p-4 space-y-2">
                                                    <p className="text-xs uppercase tracking-wider text-cyan-400">Q</p>
                                                    <p className="text-sm text-gray-200">{item.question}</p>
                                                    <p className="text-xs uppercase tracking-wider text-purple-400 pt-2">A</p>
                                                    <p className="text-sm text-gray-300 leading-relaxed">{item.result.answer}</p>
                                                    {item.result.citations.length > 0 && (
                                                        <div className="pt-1 space-y-1">
                                                            {item.result.citations.map((citation, citationIndex) => (
                                                                <div key={`${citation.chunkId}-${citationIndex}`} className="flex items-start gap-2 text-xs text-gray-400">
                                                                    <Quote className="w-3 h-3 mt-0.5 text-gray-500" />
                                                                    <span>
                                                                        <span className="text-gray-500">Chunk {citation.chunkId}:</span> {citation.excerpt}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-gray-500 text-center py-12">No summary available</p>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-800/50">
                    <button
                        onClick={() => {
                            stopLongText();
                            stopAudio();
                            setActiveChunk(null);
                            onClose();
                        }}
                        className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl transition-colors"
                    >
                        Close Summary
                    </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
