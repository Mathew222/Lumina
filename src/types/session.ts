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
    language: string;
    duration: number; // in seconds
}

export interface SessionRecordingState {
    isRecording: boolean;
    startTime: number | null;
    transcriptBuffer: string[];
}
