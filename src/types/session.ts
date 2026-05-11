/**
 * Session and Summary Types for Conversation Recording Feature
 */

export interface Summary {
    briefSummary: string;
    keyPoints: string[];
    topics: string[];
    actionItems: string[];
}

export interface Session {
    id: string;
    startedAt: string; // ISO date string for JSON serialization
    endedAt: string;
    transcript: string;
    summary: Summary | null;
    /**
     * Cache summaries per output language (e.g. "en", "ml") so we don't re-request.
     * Backward-compatible: older sessions may not have this field.
     */
    summariesByLanguage?: Record<string, Summary>;
    /**
     * Cache formatted transcripts per language.
     */
    formattedTranscriptsByLanguage?: Record<string, string>;
    language: string;
    duration: number; // in seconds
}

export interface SessionRecordingState {
    isRecording: boolean;
    startTime: number | null;
    transcriptBuffer: string[];
}
