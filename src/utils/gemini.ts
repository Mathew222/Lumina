/**
 * NVIDIA Build API Integration (DeepSeek V4 Flash)
 * OpenAI-compatible API via integrate.api.nvidia.com
 * Drop-in replacement for Gemini — all exported function signatures are unchanged.
 */

import type { Summary } from '../types/session';

const NVIDIA_API_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = import.meta.env.VITE_NVIDIA_MODEL || 'deepseek-ai/deepseek-v4-flash';

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// NVIDIA free tier: ~60 RPM — we cap at 50 to stay safe
const MAX_RPM = 50;
const WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms))]);

async function acquireRateLimit(): Promise<void> {
    while (true) {
        const now = Date.now();
        while (requestTimestamps.length > 0 && now - requestTimestamps[0] > WINDOW_MS) {
            requestTimestamps.shift();
        }
        if (requestTimestamps.length < MAX_RPM) {
            requestTimestamps.push(now);
            return;
        }
        const waitMs = WINDOW_MS - (now - requestTimestamps[0]) + 100;
        console.warn(`[NVIDIA] Rate limit guard: waiting ${Math.ceil(waitMs / 1000)}s (${requestTimestamps.length}/${MAX_RPM} slots used)`);
        await sleep(waitMs);
    }
}
// ──────────────────────────────────────────────────────────────────────────────

export interface GeminiError {
    message: string;
    code?: string;
}

interface TranscriptChunk {
    id: number;
    text: string;
}

export interface RagCitation {
    chunkId: number;
    excerpt: string;
}

export interface RagAnswer {
    answer: string;
    citations: RagCitation[];
}

/**
 * Streaming version — calls onChunk for each token as it arrives.
 * Returns the full accumulated text when done.
 */
async function callNvidiaAPIStreaming(
    apiKey: string,
    userPrompt: string,
    onChunk: (partial: string) => void,
    temperature = 0.3,
    maxTokens = 700
): Promise<{ success: true; text: string } | { success: false; message: string }> {
    await acquireRateLimit();

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const electron = (window as any).electron;

    if (!electron?.fetchNvidiaAPIStream) {
        return callNvidiaAPI(apiKey, userPrompt, temperature, maxTokens);
    }

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: NVIDIA_MODEL,
            messages: [{ role: 'user', content: userPrompt }],
            temperature,
            top_p: 0.9,
            max_tokens: maxTokens,
            stream: true,
            reasoning_effort: 'none',
        }),
    };

    let accumulated = '';
    const result = await withTimeout(
        electron.fetchNvidiaAPIStream(NVIDIA_API_BASE_URL, options, requestId, (chunk: string) => {
            accumulated += chunk;
            onChunk(accumulated);
        }),
        180_000
    );

    if (!result?.ok) {
        console.error('[NVIDIA Stream] Error:', result);
        return { success: false, message: result?.error || `Stream failed (${result?.status})` };
    }
    if (!accumulated) return { success: false, message: 'Empty streaming response.' };
    return { success: true, text: accumulated };
}

/**
 * Core function: sends a chat message to NVIDIA API and returns the text response.
 */
async function callNvidiaAPI(
    apiKey: string,
    userPrompt: string,
    temperature = 0.3,
    maxTokens = 1024
): Promise<
    | { success: true; text: string }
    | { success: false; status?: number; message: string }
> {
    await acquireRateLimit();

    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
        try {
            let result;
            if (window.electron && window.electron.fetchNvidiaAPI) {
                result = await withTimeout(
                    window.electron.fetchNvidiaAPI(NVIDIA_API_BASE_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify({
                            model: NVIDIA_MODEL,
                            messages: [{ role: 'user', content: userPrompt }],
                            temperature,
                            top_p: 0.9,
                            max_tokens: maxTokens,
                            stream: false,
                            reasoning_effort: 'none', // disable thinking mode for speed
                        }),
                    }),
                    180_000
                );
            } else {
                // Fallback for non-Electron environment (might hit CORS)
                const response = await withTimeout(
                    fetch(NVIDIA_API_BASE_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify({
                            model: NVIDIA_MODEL,
                            messages: [{ role: 'user', content: userPrompt }],
                            temperature,
                            top_p: 0.9,
                            max_tokens: maxTokens,
                            stream: false,
                            reasoning_effort: 'none',
                        }),
                    }),
                    180_000
                );
                const data = await response.json().catch(() => ({}));
                result = {
                    ok: response.ok,
                    status: response.status,
                    data
                };
            }

            if (result.ok) {
                const text = result.data?.choices?.[0]?.message?.content ?? '';
                if (!text) return { success: false, message: 'Empty response from API.' };
                return { success: true, text };
            }

            // Log full error for debugging
            console.error('[NVIDIA API] Error response:', JSON.stringify(result));

            const errorData = result.data;
            const errorMessage = errorData?.message
                || result.error  // catch the { error: '...' } shape from main process
                || `API request failed with status ${result.status}`;

            if (result.status === 401 || result.status === 403) {
                return { success: false, status: result.status, message: 'Invalid NVIDIA API key. Check VITE_NVIDIA_API_KEY in your .env file.' };
            }

            if (result.status === 429) {
                attempt++;
                if (attempt < maxAttempts) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.warn(`[NVIDIA] Rate limit hit, retrying in ${delay / 1000}s...`);
                    await sleep(delay);
                    continue;
                }
                return { success: false, status: 429, message: 'NVIDIA API rate limit reached. Please wait a moment.' };
            }

            return { success: false, status: result.status, message: errorMessage };
        } catch (err) {
            console.error('[NVIDIA API] Caught exception:', err);
            return {
                success: false,
                message: err instanceof Error ? err.message : 'Network error connecting to NVIDIA API.'
            };
        }
    }

    return { success: false, message: 'All retry attempts failed.' };
}

// ─── Summarization Prompt ─────────────────────────────────────────────────────

const getSummarizationPrompt = (outputLanguage: string = 'en') => {
    const languageInstruction = outputLanguage === 'ml'
        ? '\n- IMPORTANT: Write ALL text content (briefSummary, keyPoints, topics, actionItems) in Malayalam (മലയാളം). Use Malayalam script.'
        : outputLanguage !== 'en'
            ? `\n- IMPORTANT: Write ALL text content in ${outputLanguage}.`
            : '';

    return `Summarize the following conversation transcript. Output ONLY a raw JSON object — no markdown, no code fences, no explanation text before or after.

TRANSCRIPT:
{transcript}

Output this exact JSON structure with no other text:
{"briefSummary":"2-3 sentence summary","keyPoints":["point 1","point 2","point 3"],"topics":["topic 1","topic 2"],"actionItems":["action 1"]}

Rules:
- briefSummary: 2-3 sentences capturing the main essence
- keyPoints: 3-7 important takeaways (array of strings)
- topics: 2-5 main themes/subjects (short phrases, array of strings)
- actionItems: tasks or next steps mentioned, or empty array []
- Output ONLY the JSON object. No text before or after it.${languageInstruction}`;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Summarize a conversation transcript.
 * Signature unchanged from the Gemini version.
 */
export async function summarizeConversation(
    transcript: string,
    apiKey: string,
    outputLanguage: string = 'en',
    onStreamChunk?: (partial: string) => void
): Promise<{ success: true; summary: Summary } | { success: false; error: GeminiError }> {
    if (!apiKey || apiKey.trim() === '') {
        return {
            success: false,
            error: { message: 'NVIDIA API key is required. Set VITE_NVIDIA_API_KEY in your .env file.', code: 'NO_API_KEY' }
        };
    }

    if (!transcript || transcript.trim().length < 10) {
        return {
            success: false,
            error: { message: 'Transcript is too short to summarize.', code: 'SHORT_TRANSCRIPT' }
        };
    }

    // Truncate to avoid very long prompts which slow the model significantly.
    // 8000 chars ≈ 2000 tokens — more than enough for an accurate summary.
    const MAX_TRANSCRIPT_CHARS = 8000;
    const truncated = transcript.length > MAX_TRANSCRIPT_CHARS
        ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n[...transcript truncated for summary]'
        : transcript;

    try {
        const prompt = getSummarizationPrompt(outputLanguage).replace('{transcript}', truncated);
        const result = onStreamChunk
            ? await callNvidiaAPIStreaming(apiKey, prompt, onStreamChunk, 0.3, 700)
            : await callNvidiaAPI(apiKey, prompt, 0.3, 700);

        if (!result.success) {
            return {
                success: false,
                error: { message: result.message, code: 'API_ERROR' }
            };
        }

        // 1. Strip markdown code fences
        let cleanJson = result.text.trim();
        cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

        // 2. Try direct parse
        const tryParse = (str: string): Summary | null => {
            try {
                const parsed = JSON.parse(str);
                if (parsed.briefSummary && Array.isArray(parsed.keyPoints) &&
                    Array.isArray(parsed.topics) && Array.isArray(parsed.actionItems)) {
                    return parsed as Summary;
                }
            } catch { /* continue */ }
            return null;
        };

        let summary = tryParse(cleanJson);

        // 3. Try extracting JSON object from response (model may have added text before/after)
        if (!summary) {
            const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
            if (jsonMatch) summary = tryParse(jsonMatch[0]);
        }

        if (summary) return { success: true, summary };

        // 4. Last resort: parse plain text into structured fields — NEVER show raw JSON to user
        console.warn('[NVIDIA] Could not parse JSON, building fallback from text.');
        const lines = result.text.split('\n').map(l => l.trim()).filter(Boolean);
        const meaningfulLines = lines.filter(l => !l.startsWith('{') && !l.startsWith('}') && !l.startsWith('"') && l.length > 10);
        return {
            success: true,
            summary: {
                briefSummary: meaningfulLines[0] || 'Summary of the recorded conversation.',
                keyPoints: meaningfulLines.slice(1, 5).length ? meaningfulLines.slice(1, 5) : ['Review the full transcript for details.'],
                topics: ['Conversation'],
                actionItems: []
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error instanceof Error ? error.message : 'Failed to connect to NVIDIA API',
                code: 'NETWORK_ERROR'
            }
        };
    }
}

// ─── Transcript Formatting ────────────────────────────────────────────────────

const getFormattingPrompt = (outputLanguage: string = 'en') => {
    const languageInstruction = outputLanguage === 'ml'
        ? '\nIMPORTANT: You MUST translate the entire formatted transcript into Malayalam (മലയാളം). Use Malayalam script.'
        : outputLanguage !== 'en'
            ? `\nIMPORTANT: You MUST translate the entire formatted transcript into ${outputLanguage}.`
            : '';

    return `You are an expert AI editor and linguist. Your task is to process a raw, machine-generated speech transcript. Speech-to-text engines often mishear words, generating random or nonsensical phrases.

RAW TRANSCRIPT:
{transcript}

Instructions:
1. CORRECT RECOGNITION ERRORS: If any words or phrases seem random, broken, or nonsensical, infer the intended meaning based on the context of the conversation and fix them.
2. MAKE IT MEANINGFUL: Rewrite the text so it flows logically and makes complete sense, while keeping the EXACT SAME level of detail. 
3. DO NOT SUMMARIZE: You must keep the full transcript. Do not shorten it.
4. CLEAN UP: Fix punctuation, capitalization, and grammar. Remove stutters or filler words (um, uh).
5. FORMATTING: Break the text into readable paragraphs. Return pure, clean text without any markdown bolding or headers.${languageInstruction}`;
};

/**
 * Format a raw transcript into readable paragraphs, and optionally translate it.
 */
export async function formatTranscript(
    transcript: string,
    apiKey: string,
    outputLanguage: string = 'en'
): Promise<{ success: true; formattedTranscript: string } | { success: false; error: GeminiError }> {
    if (!apiKey || apiKey.trim() === '') {
        return {
            success: false,
            error: { message: 'NVIDIA API key is required.', code: 'NO_API_KEY' }
        };
    }

    if (!transcript || transcript.trim().length < 10) {
        return {
            success: true,
            formattedTranscript: transcript // too short to format, just return it
        };
    }

    try {
        const prompt = getFormattingPrompt(outputLanguage).replace('{transcript}', transcript);
        const result = await callNvidiaAPI(apiKey, prompt, 0.2, 2048);

        if (!result.success) {
            return {
                success: false,
                error: { message: result.message, code: 'API_ERROR' }
            };
        }

        return { success: true, formattedTranscript: result.text.trim() };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error instanceof Error ? error.message : 'Failed to format transcript',
                code: 'NETWORK_ERROR'
            }
        };
    }
}

// ─── RAG Helpers ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for',
    'from', 'has', 'have', 'he', 'in', 'is', 'it', 'its', 'of',
    'on', 'or', 'that', 'the', 'their', 'there', 'they', 'this',
    'to', 'was', 'were', 'will', 'with', 'what', 'where', 'when',
    'who', 'why', 'how', 'about', 'can', 'could', 'would', 'should'
]);

function normalizeText(text: string): string {
    return text.toLowerCase().replace(/[^\w\s]/g, ' ');
}

function tokenize(text: string): string[] {
    return normalizeText(text)
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function splitTranscriptIntoChunks(transcript: string, maxWordsPerChunk = 120): TranscriptChunk[] {
    const words = transcript.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const chunks: TranscriptChunk[] = [];
    for (let i = 0; i < words.length; i += maxWordsPerChunk) {
        chunks.push({ id: chunks.length + 1, text: words.slice(i, i + maxWordsPerChunk).join(' ') });
    }
    return chunks;
}

function scoreChunk(queryTokens: string[], chunk: TranscriptChunk): number {
    if (queryTokens.length === 0) return 0;
    const chunkText = normalizeText(chunk.text);
    const chunkTokens = new Set(tokenize(chunk.text));
    let score = 0;
    for (const token of queryTokens) {
        if (chunkTokens.has(token)) score += 2;
        if (chunkText.includes(token)) score += 1;
    }
    return score;
}

function retrieveRelevantChunks(transcript: string, query: string, maxChunks = 4): TranscriptChunk[] {
    const chunks = splitTranscriptIntoChunks(transcript);
    const queryTokens = tokenize(query);
    if (chunks.length === 0) return [];
    if (queryTokens.length === 0) return chunks.slice(0, Math.min(maxChunks, chunks.length));

    const scored = chunks
        .map(chunk => ({ chunk, score: scoreChunk(queryTokens, chunk) }))
        .sort((a, b) => b.score - a.score);

    const relevant = scored.filter(item => item.score > 0).slice(0, maxChunks).map(item => item.chunk);
    return relevant.length > 0 ? relevant : chunks.slice(0, Math.min(maxChunks, chunks.length));
}

function getRagPrompt(question: string, contextChunks: TranscriptChunk[]): string {
    const formattedContext = contextChunks
        .map(chunk => `[Chunk ${chunk.id}] ${chunk.text}`)
        .join('\n\n');

    return `You are a transcript assistant. Answer the user's question ONLY using the provided transcript chunks.

User question:
${question}

Transcript context:
${formattedContext}

Instructions:
- If the answer is not present in the context, say you do not have enough transcript evidence.
- Keep the answer concise but clear.
- Prefer factual statements grounded in the transcript text.
- Return output as strict JSON (no markdown), exactly in this format:
{
  "answer": "your answer text",
  "citations": [
    { "chunkId": 1, "excerpt": "short direct quote or snippet" }
  ]
}
- Citations must reference only chunk IDs from the provided context.
- Include 1-3 citations when possible.`;
}

/**
 * RAG-based Q&A over a transcript.
 * Signature unchanged from the Gemini version.
 */
export async function askTranscriptRag(
    transcript: string,
    question: string,
    apiKey: string
): Promise<{ success: true; result: RagAnswer } | { success: false; error: GeminiError }> {
    if (!apiKey || apiKey.trim() === '') {
        return { success: false, error: { message: 'NVIDIA API key is required.', code: 'NO_API_KEY' } };
    }
    if (!transcript || transcript.trim().length < 10) {
        return { success: false, error: { message: 'Transcript is too short for Q&A.', code: 'SHORT_TRANSCRIPT' } };
    }
    if (!question || question.trim().length < 3) {
        return { success: false, error: { message: 'Please ask a more detailed question.', code: 'SHORT_QUESTION' } };
    }

    const contextChunks = retrieveRelevantChunks(transcript, question);
    if (contextChunks.length === 0) {
        return { success: false, error: { message: 'Could not build context from transcript.', code: 'NO_CONTEXT' } };
    }

    try {
        const prompt = getRagPrompt(question, contextChunks);
        const result = await callNvidiaAPI(apiKey, prompt, 0.2, 768);

        if (!result.success) {
            return { success: false, error: { message: result.message, code: 'API_ERROR' } };
        }

        let cleanJson = result.text.trim();
        cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

        const parsed = JSON.parse(cleanJson) as RagAnswer;

        if (!parsed.answer || !Array.isArray(parsed.citations)) {
            throw new Error('Invalid RAG response shape');
        }

        const validChunkIds = new Set(contextChunks.map(c => c.id));
        const citations = parsed.citations
            .filter(c =>
                typeof c.chunkId === 'number' &&
                validChunkIds.has(c.chunkId) &&
                typeof c.excerpt === 'string' &&
                c.excerpt.trim().length > 0
            )
            .slice(0, 3);

        return { success: true, result: { answer: parsed.answer.trim(), citations } };
    } catch (error) {
        console.error('[NVIDIA][RAG] Request failed:', error);
        return {
            success: false,
            error: {
                message: error instanceof Error ? error.message : 'Failed to run transcript Q&A',
                code: 'RAG_ERROR'
            }
        };
    }
}

/**
 * Validate an NVIDIA API key by making a minimal test request.
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey || apiKey.trim() === '') return false;
    try {
        const result = await callNvidiaAPI(apiKey, 'Say "ok"', 0.1, 10);
        return result.success;
    } catch {
        return false;
    }
}

export function getStoredApiKey(): string {
    try {
        return import.meta.env.VITE_NVIDIA_API_KEY || '';
    } catch {
        return '';
    }
}
