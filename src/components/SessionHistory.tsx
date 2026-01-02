import { useState } from 'react';
import { X, Trash2, Download, Clock, MessageSquare, ChevronRight, History, AlertCircle } from 'lucide-react';
import type { Session } from '../types/session';
import { getSessions, deleteSession, exportSessionAsText, formatDuration, getStorageInfo } from '../utils/sessionStorage';

interface SessionHistoryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectSession: (session: Session) => void;
}

export const SessionHistory = ({ isOpen, onClose, onSelectSession }: SessionHistoryProps) => {
    const [sessions, setSessions] = useState<Session[]>(() => getSessions());
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const refreshSessions = () => {
        setSessions(getSessions());
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirmDelete === id) {
            deleteSession(id);
            refreshSessions();
            setConfirmDelete(null);
        } else {
            setConfirmDelete(id);
            // Auto-cancel after 3 seconds
            setTimeout(() => setConfirmDelete(null), 3000);
        }
    };

    const handleExport = (session: Session, e: React.MouseEvent) => {
        e.stopPropagation();
        const text = exportSessionAsText(session);
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lumina-session-${new Date(session.startedAt).toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else if (diffDays === 1) {
            return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        }
    };

    const storageInfo = getStorageInfo();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gradient-to-b from-gray-900 to-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl animate-fade-in">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                    <div className="flex items-center gap-3">
                        <History className="w-5 h-5 text-purple-400" />
                        <h2 className="text-lg font-bold text-white">Session History</h2>
                        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
                            {storageInfo.count} sessions • {storageInfo.estimatedSize}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Sessions List */}
                <div className="flex-1 overflow-y-auto p-4">
                    {sessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <MessageSquare className="w-12 h-12 text-gray-700 mb-4" />
                            <h3 className="text-gray-400 font-medium mb-2">No sessions yet</h3>
                            <p className="text-gray-600 text-sm max-w-xs">
                                Start recording a session by clicking the "Record Session" button on the dashboard.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {sessions.map(session => (
                                <div
                                    key={session.id}
                                    onClick={() => onSelectSession(session)}
                                    className="group bg-gray-900/50 hover:bg-gray-800/70 border border-gray-800 hover:border-gray-700 rounded-xl p-4 cursor-pointer transition-all"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            {/* Date & Duration */}
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="text-sm text-gray-300">
                                                    {formatDate(session.startedAt)}
                                                </span>
                                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                                    <Clock className="w-3 h-3" />
                                                    {formatDuration(session.duration)}
                                                </span>
                                            </div>

                                            {/* Summary Preview */}
                                            {session.summary ? (
                                                <p className="text-sm text-gray-400 line-clamp-2">
                                                    {session.summary.briefSummary}
                                                </p>
                                            ) : (
                                                <div className="flex items-center gap-2 text-sm text-yellow-500/70">
                                                    <AlertCircle className="w-4 h-4" />
                                                    <span>Summary not available</span>
                                                </div>
                                            )}

                                            {/* Topics Tags */}
                                            {session.summary && session.summary.topics.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-2">
                                                    {session.summary.topics.slice(0, 4).map((topic, i) => (
                                                        <span
                                                            key={i}
                                                            className="px-2 py-0.5 bg-purple-500/10 text-purple-300 text-xs rounded-full border border-purple-500/20"
                                                        >
                                                            {topic}
                                                        </span>
                                                    ))}
                                                    {session.summary.topics.length > 4 && (
                                                        <span className="text-xs text-gray-500">
                                                            +{session.summary.topics.length - 4} more
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => handleExport(session, e)}
                                                className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
                                                title="Export session"
                                            >
                                                <Download className="w-4 h-4 text-gray-400" />
                                            </button>
                                            <button
                                                onClick={(e) => handleDelete(session.id, e)}
                                                className={`p-2 rounded-lg transition-colors ${confirmDelete === session.id
                                                        ? 'bg-red-500/20 hover:bg-red-500/30'
                                                        : 'hover:bg-gray-700'
                                                    }`}
                                                title={confirmDelete === session.id ? 'Click again to confirm' : 'Delete session'}
                                            >
                                                <Trash2 className={`w-4 h-4 ${confirmDelete === session.id ? 'text-red-400' : 'text-gray-400'
                                                    }`} />
                                            </button>
                                            <ChevronRight className="w-4 h-4 text-gray-600" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
