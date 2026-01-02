import { useState } from 'react';
import { X, Copy, Check, ChevronDown, ChevronUp, Sparkles, ListChecks, Tag, ClipboardList } from 'lucide-react';
import type { Summary } from '../types/session';

interface SummaryPanelProps {
    summary: Summary | null;
    isLoading: boolean;
    error?: string | null;
    onClose: () => void;
}

export const SummaryPanel = ({ summary, isLoading, error, onClose }: SummaryPanelProps) => {
    const [copied, setCopied] = useState(false);
    const [expandedSections, setExpandedSections] = useState({
        keyPoints: true,
        topics: true,
        actionItems: true,
    });

    const toggleSection = (section: keyof typeof expandedSections) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const copyToClipboard = () => {
        if (!summary) return;

        const text = `Summary: ${summary.briefSummary}\n\nKey Points:\n${summary.keyPoints.map(p => `• ${p}`).join('\n')}\n\nTopics: ${summary.topics.join(', ')}${summary.actionItems.length > 0 ? `\n\nAction Items:\n${summary.actionItems.map(a => `☐ ${a}`).join('\n')}` : ''}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="fixed right-0 top-0 h-full w-96 bg-gradient-to-b from-gray-900/95 to-black/95 backdrop-blur-xl border-l border-gray-800/50 shadow-2xl z-50 flex flex-col animate-slide-in-right">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-800/50">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-400" />
                    <h2 className="text-lg font-bold text-white">AI Summary</h2>
                </div>
                <div className="flex items-center gap-2">
                    {summary && (
                        <button
                            onClick={copyToClipboard}
                            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                            title="Copy summary"
                        >
                            {copied ? (
                                <Check className="w-4 h-4 text-green-400" />
                            ) : (
                                <Copy className="w-4 h-4 text-gray-400" />
                            )}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        <X className="w-4 h-4 text-gray-400" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {isLoading ? (
                    /* Loading Skeleton */
                    <div className="space-y-4 animate-pulse">
                        <div className="h-4 bg-gray-800 rounded w-3/4"></div>
                        <div className="h-4 bg-gray-800 rounded w-full"></div>
                        <div className="h-4 bg-gray-800 rounded w-5/6"></div>
                        <div className="h-20 bg-gray-800/50 rounded-xl mt-6"></div>
                        <div className="h-16 bg-gray-800/50 rounded-xl"></div>
                    </div>
                ) : error ? (
                    /* Error State */
                    <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
                        <p className="text-red-300 text-sm">{error}</p>
                    </div>
                ) : summary ? (
                    <>
                        {/* Brief Summary */}
                        <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 border border-purple-500/20 rounded-xl p-4">
                            <p className="text-gray-200 leading-relaxed">{summary.briefSummary}</p>
                        </div>

                        {/* Key Points */}
                        <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleSection('keyPoints')}
                                className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <ListChecks className="w-4 h-4 text-green-400" />
                                    <span className="text-sm font-medium text-gray-300">Key Points</span>
                                    <span className="text-xs text-gray-600">({summary.keyPoints.length})</span>
                                </div>
                                {expandedSections.keyPoints ? (
                                    <ChevronUp className="w-4 h-4 text-gray-500" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-gray-500" />
                                )}
                            </button>
                            {expandedSections.keyPoints && (
                                <ul className="px-4 pb-3 space-y-2">
                                    {summary.keyPoints.map((point, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                                            <span className="text-green-400 mt-1">•</span>
                                            <span>{point}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Topics */}
                        <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleSection('topics')}
                                className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Tag className="w-4 h-4 text-blue-400" />
                                    <span className="text-sm font-medium text-gray-300">Topics</span>
                                </div>
                                {expandedSections.topics ? (
                                    <ChevronUp className="w-4 h-4 text-gray-500" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-gray-500" />
                                )}
                            </button>
                            {expandedSections.topics && (
                                <div className="px-4 pb-3 flex flex-wrap gap-2">
                                    {summary.topics.map((topic, i) => (
                                        <span
                                            key={i}
                                            className="px-3 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/30"
                                        >
                                            {topic}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Action Items */}
                        {summary.actionItems.length > 0 && (
                            <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
                                <button
                                    onClick={() => toggleSection('actionItems')}
                                    className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        <ClipboardList className="w-4 h-4 text-yellow-400" />
                                        <span className="text-sm font-medium text-gray-300">Action Items</span>
                                        <span className="text-xs text-gray-600">({summary.actionItems.length})</span>
                                    </div>
                                    {expandedSections.actionItems ? (
                                        <ChevronUp className="w-4 h-4 text-gray-500" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4 text-gray-500" />
                                    )}
                                </button>
                                {expandedSections.actionItems && (
                                    <ul className="px-4 pb-3 space-y-2">
                                        {summary.actionItems.map((item, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                                                <span className="text-yellow-400 mt-0.5">☐</span>
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </>
                ) : (
                    <p className="text-gray-500 text-center py-8">No summary available</p>
                )}
            </div>
        </div>
    );
};
