/**
 * Session Storage Service
 * Manages persistence of conversation sessions in localStorage
 */

import type { Session } from '../types/session';

const SESSIONS_STORAGE_KEY = 'lumina_sessions';
const MAX_SESSIONS = 50; // Limit to prevent localStorage bloat

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get all saved sessions, sorted by date (newest first)
 */
export function getSessions(): Session[] {
    try {
        const data = localStorage.getItem(SESSIONS_STORAGE_KEY);
        if (!data) return [];

        const sessions: Session[] = JSON.parse(data);
        // Sort by startedAt descending (newest first)
        return sessions.sort((a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
    } catch (error) {
        console.error('[SessionStorage] Failed to load sessions:', error);
        return [];
    }
}

/**
 * Get a single session by ID
 */
export function getSession(id: string): Session | null {
    const sessions = getSessions();
    return sessions.find(s => s.id === id) || null;
}

/**
 * Save a session (adds new or updates existing)
 */
export function saveSession(session: Session): void {
    try {
        let sessions = getSessions();

        // Check if session already exists (update vs add)
        const existingIndex = sessions.findIndex(s => s.id === session.id);
        if (existingIndex !== -1) {
            sessions[existingIndex] = session;
        } else {
            sessions.unshift(session); // Add to beginning (newest first)
        }

        // Enforce max sessions limit
        if (sessions.length > MAX_SESSIONS) {
            sessions = sessions.slice(0, MAX_SESSIONS);
        }

        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    } catch (error) {
        console.error('[SessionStorage] Failed to save session:', error);
        throw new Error('Failed to save session. Storage might be full.');
    }
}

/**
 * Delete a session by ID
 */
export function deleteSession(id: string): void {
    try {
        const sessions = getSessions().filter(s => s.id !== id);
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    } catch (error) {
        console.error('[SessionStorage] Failed to delete session:', error);
    }
}

/**
 * Clear all sessions
 */
export function clearAllSessions(): void {
    try {
        localStorage.removeItem(SESSIONS_STORAGE_KEY);
    } catch (error) {
        console.error('[SessionStorage] Failed to clear sessions:', error);
    }
}

/**
 * Export session as JSON string
 */
export function exportSession(session: Session): string {
    return JSON.stringify(session, null, 2);
}

/**
 * Export session as plain text
 */
export function exportSessionAsText(session: Session): string {
    const lines: string[] = [
        `LUMINA SESSION EXPORT`,
        `=====================`,
        ``,
        `Date: ${new Date(session.startedAt).toLocaleString()}`,
        `Duration: ${formatDuration(session.duration)}`,
        `Language: ${session.language}`,
        ``,
        `--- TRANSCRIPT ---`,
        session.transcript,
        ``
    ];

    if (session.summary) {
        lines.push(
            `--- SUMMARY ---`,
            ``,
            `Brief Summary:`,
            session.summary.briefSummary,
            ``,
            `Key Points:`,
            ...session.summary.keyPoints.map(p => `• ${p}`),
            ``,
            `Topics: ${session.summary.topics.join(', ')}`,
            ``
        );

        if (session.summary.actionItems.length > 0) {
            lines.push(
                `Action Items:`,
                ...session.summary.actionItems.map(a => `☐ ${a}`),
                ``
            );
        }
    }

    return lines.join('\n');
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
        return `${minutes}m ${remainingSeconds}s`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

/**
 * Get storage usage info
 */
export function getStorageInfo(): { count: number; estimatedSize: string } {
    const sessions = getSessions();
    const data = localStorage.getItem(SESSIONS_STORAGE_KEY) || '';
    const sizeBytes = new Blob([data]).size;
    const sizeKB = (sizeBytes / 1024).toFixed(1);

    return {
        count: sessions.length,
        estimatedSize: sizeBytes > 1024 * 1024
            ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
            : `${sizeKB} KB`
    };
}
