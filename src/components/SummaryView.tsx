import { useState } from 'react';
import { X, Copy, Check, Sparkles, ListChecks, Tag, ClipboardList, FileText, ChevronDown, ChevronUp, Clock, Calendar, Languages } from 'lucide-react';
import type { Summary } from '../types/session';

interface SummaryViewProps {
    summary: Summary | null;
    isLoading: boolean;
    error?: string | null;
    transcript?: string;
    duration?: number;
    recordedAt?: string;
    onClose: () => void;
    onTranslate?: (language: 'en' | 'ml') => void;
    isTranslating?: boolean;
    currentLanguage?: 'en' | 'ml';
}

export const SummaryView = ({
    summary,
    isLoading,
    error,
    transcript,
    duration,
    recordedAt,
    onClose,
    onTranslate,
    isTranslating = false,
    currentLanguage = 'en'
}: SummaryViewProps) => {
    const [copied, setCopied] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);

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
${transcript ? `\n📄 Full Transcript:\n${transcript}` : ''}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-6">
            <div className="w-full max-w-3xl max-h-[90vh] bg-gradient-to-b from-gray-900 to-gray-950 rounded-3xl border border-gray-800 shadow-2xl flex flex-col overflow-hidden">
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
                        {summary && onTranslate && (
                            <button
                                onClick={() => onTranslate(currentLanguage === 'en' ? 'ml' : 'en')}
                                disabled={isTranslating}
                                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm ${isTranslating
                                    ? 'bg-purple-500/30 cursor-wait'
                                    : currentLanguage === 'ml'
                                        ? 'bg-green-500/20 hover:bg-green-500/30 border border-green-500/30'
                                        : 'bg-gray-800 hover:bg-gray-700'
                                    }`}
                            >
                                <Languages className={`w-4 h-4 ${isTranslating ? 'animate-pulse text-purple-400' : currentLanguage === 'ml' ? 'text-green-400' : 'text-gray-400'}`} />
                                <span className={currentLanguage === 'ml' ? 'text-green-400' : 'text-gray-300'}>
                                    {isTranslating ? 'Translating...' : currentLanguage === 'ml' ? 'മലയാളം ✓' : 'മലയാളം'}
                                </span>
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {isLoading ? (
                        /* Loading State */
                        <div className="space-y-6">
                            <div className="bg-gray-800/50 rounded-2xl p-6 animate-pulse">
                                <div className="h-4 bg-gray-700 rounded w-3/4 mb-3"></div>
                                <div className="h-4 bg-gray-700 rounded w-full mb-3"></div>
                                <div className="h-4 bg-gray-700 rounded w-5/6"></div>
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
                            <p className="text-center text-sm text-gray-500 flex items-center justify-center gap-2">
                                <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></span>
                                Generating summary with AI...
                            </p>
                        </div>
                    ) : error ? (
                        /* Error State */
                        <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-6 text-center">
                            <p className="text-red-300">{error}</p>
                            <button
                                onClick={onClose}
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
                                            <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap bg-gray-900/50 rounded-xl p-4 max-h-64 overflow-y-auto">
                                                {transcript}
                                            </p>
                                        </div>
                                    )}
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
                        onClick={onClose}
                        className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl transition-colors"
                    >
                        Close Summary
                    </button>
                </div>
            </div>
        </div>
    );
};
