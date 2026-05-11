/**
 * Gemini API Integration for Conversation Summarization
 */

import type { Summary } from '../types/session';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL_CANDIDATES = [
    import.meta.env.VITE_GEMINI_MODEL || 'gemini-1.5-flash-8b',
].filter((model): model is string => Boolean(model && model.trim()))
    .filter((model, index, arr) => arr.indexOf(model) === index);

const getSummarizationPrompt = (outputLanguage: string = 'en') => {
    const languageInstruction = outputLanguage === 'ml'
        ? '\n- IMPORTANT: Write ALL text content (briefSummary, keyPoints, topics, actionItems) in Malayalam (മലയാളം). Use Malayalam script.'
        : outputLanguage !== 'en'
            ? `\n- IMPORTANT: Write ALL text content in ${outputLanguage}.`
            : '';

    return `You are an AI assistant that summarizes conversations. Analyze the following transcript and provide a structured summary.

TRANSCRIPT:
{transcript}

Please provide your response in the following JSON format exactly (no markdown, just pure JSON):
{
  "briefSummary": "A concise 2-3 sentence summary of the entire conversation",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "topics": ["Topic 1", "Topic 2", "Topic 3"],
  "actionItems": ["Action item 1", "Action item 2"] 
}

Rules:
- briefSummary should capture the main essence of the conversation
- keyPoints should be 3-7 important takeaways
- topics should be 2-5 main themes/subjects discussed (single words or short phrases)
- actionItems should list any tasks, to-dos, or next steps mentioned (can be empty array if none)
- Keep all text concise and clear
- Return ONLY valid JSON, no additional text${languageInstruction}`;
};

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

function extractGeneratedText(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const candidates = (data as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
    const first = candidates[0];
    if (!first || typeof first !== 'object') return undefined;
    const content = (first as { content?: unknown }).content;
    if (!content || typeof content !== 'object') return undefined;
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts) || parts.length === 0) return undefined;
    const text = (parts[0] as { text?: unknown })?.text;
    return typeof text === 'string' ? text : undefined;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// Hard cap: 12 requests/minute (well under the free-tier 15 RPM limit).
// Uses a sliding-window queue: track timestamps of the last N calls and wait
// until the oldest one is >60 seconds old before allowing a new one.
const MAX_RPM = 12;
const WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

async function acquireRateLimit(): Promise<void> {
    while (true) {
        const now = Date.now();
        // Drop timestamps older than the window
        while (requestTimestamps.length > 0 && now - requestTimestamps[0] > WINDOW_MS) {
            requestTimestamps.shift();
        }
        if (requestTimestamps.length < MAX_RPM) {
            requestTimestamps.push(now);
            return; // Slot available — proceed immediately
        }
        // Window is full — wait until the oldest slot expires
        const waitMs = WINDOW_MS - (now - requestTimestamps[0]) + 100; // +100ms buffer
        console.warn(`[Gemini] Rate limit guard: waiting ${Math.ceil(waitMs / 1000)}s before next request (${requestTimestamps.length}/${MAX_RPM} slots used)`);
        await sleep(waitMs);
    }
}
// ──────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callGeminiWithFallback(
    apiKey: string,
    body: Record<string, unknown>
): Promise<
    | { success: true; data: unknown }
    | { success: false; status?: number; message: string }
> {
    let lastErrorMessage = 'All Gemini model attempts failed.';
    let lastStatus: number | undefined;
    let sawNotFoundError = false;

    for (const model of GEMINI_MODEL_CANDIDATES) {
        // Retry up to 3 times with exponential backoff for 429 rate-limit errors
        let attempt = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
            // Enforce rate limit BEFORE each actual request
            await acquireRateLimit();

            const response = await fetch(`${GEMINI_API_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                const data = await response.json();
                return { success: true, data };
            }

            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData?.error?.message || `API request failed with status ${response.status}`;
            lastErrorMessage = errorMessage;
            lastStatus = response.status;

            if (response.status === 401 || response.status === 403) {
                return { success: false, status: response.status, message: errorMessage };
            }

            if (response.status === 429) {
                attempt++;
                if (attempt < maxAttempts) {
                    // Exponential backoff: 2s, 4s, then give up
                    const delay = Math.pow(2, attempt) * 1000;
                    console.warn(`[Gemini] Rate limit hit on ${model}, retrying in ${delay / 1000}s... (attempt ${attempt}/${maxAttempts - 1})`);
                    await sleep(delay);
                    continue;
                }
                // Exhausted retries for this model, try next model
                break;
            }

            if (response.status === 404) {
                sawNotFoundError = true;
                break; // Try next model
            }

            // Any other error — don't retry
            break;
        }
    }

    if (lastStatus === 429) {
        return {
            success: false,
            status: 429,
            message: 'Gemini rate limit reached. Please wait a moment before trying again (free tier: 15 requests/minute).'
        };
    }
    if (sawNotFoundError) {
        return {
            success: false,
            status: 404,
            message: 'No configured Gemini model was found for this key/project. Set VITE_GEMINI_MODEL to an available model.'
        };
    }

    return { success: false, status: lastStatus, message: lastErrorMessage };
}

/**
 * Summarize a conversation transcript using Gemini API
 * @param outputLanguage - Language code for summary output (e.g., 'en', 'ml' for Malayalam)
 */
export async function summarizeConversation(
    transcript: string,
    apiKey: string,
    outputLanguage: string = 'en'
): Promise<{ success: true; summary: Summary } | { success: false; error: GeminiError }> {
    if (!apiKey || apiKey.trim() === '') {
        return {
            success: false,
            error: { message: 'Gemini API key is required. Set VITE_GEMINI_API_KEY in your .env file.', code: 'NO_API_KEY' }
        };
    }

    if (!transcript || transcript.trim().length < 10) {
        return {
            success: false,
            error: { message: 'Transcript is too short to summarize.', code: 'SHORT_TRANSCRIPT' }
        };
    }

    try {
        const prompt = getSummarizationPrompt(outputLanguage).replace('{transcript}', transcript);

        const apiResult = await callGeminiWithFallback(apiKey, {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.3,
                topP: 0.8,
                maxOutputTokens: 1024,
            }
        });

        if (!apiResult.success) {
            if (apiResult.status === 401 || apiResult.status === 403) {
                return {
                    success: false,
                    error: { message: 'Invalid API key. Please check your Gemini API key.', code: 'INVALID_API_KEY' }
                };
            }

            return {
                success: false,
                error: { message: apiResult.message, code: 'API_ERROR' }
            };
        }

        const data = apiResult.data;

        // Extract text from Gemini response
        const generatedText = extractGeneratedText(data);

        if (!generatedText) {
            return {
                success: false,
                error: { message: 'No response generated from API.', code: 'EMPTY_RESPONSE' }
            };
        }

        // Parse the JSON response
        try {
            // Clean up the response - remove any markdown code blocks if present
            let cleanJson = generatedText.trim();
            if (cleanJson.startsWith('```json')) {
                cleanJson = cleanJson.slice(7);
            }
            if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.slice(3);
            }
            if (cleanJson.endsWith('```')) {
                cleanJson = cleanJson.slice(0, -3);
            }
            cleanJson = cleanJson.trim();

            const summary: Summary = JSON.parse(cleanJson);

            // Validate the response structure
            if (!summary.briefSummary || !Array.isArray(summary.keyPoints) ||
                !Array.isArray(summary.topics) || !Array.isArray(summary.actionItems)) {
                throw new Error('Invalid response structure');
            }

            return { success: true, summary };
        } catch {
            console.error('[Gemini] Failed to parse response:', generatedText);

            // Fallback: create a basic summary from the raw text
            return {
                success: true,
                summary: {
                    briefSummary: generatedText.slice(0, 300),
                    keyPoints: ['Unable to parse structured response'],
                    topics: ['Conversation'],
                    actionItems: []
                }
            };
        }
    } catch (error) {
        console.error('[Gemini] Request failed:', error);
        return {
            success: false,
            error: {
                message: error instanceof Error ? error.message : 'Failed to connect to Gemini API',
                code: 'NETWORK_ERROR'
            }
        };
    }
}

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
        const chunkWords = words.slice(i, i + maxWordsPerChunk);
        chunks.push({
            id: chunks.length + 1,
            text: chunkWords.join(' ')
        });
    }
    return chunks;
}

function scoreChunk(queryTokens: string[], chunk: TranscriptChunk): number {
    if (queryTokens.length === 0) return 0;

    const chunkText = normalizeText(chunk.text);
    const chunkTokens = new Set(tokenize(chunk.text));
    let score = 0;

    for (const token of queryTokens) {
        if (chunkTokens.has(token)) {
            score += 2;
        }
        if (chunkText.includes(token)) {
            score += 1;
        }
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

export async function askTranscriptRag(
    transcript: string,
    question: string,
    apiKey: string
): Promise<{ success: true; result: RagAnswer } | { success: false; error: GeminiError }> {
    if (!apiKey || apiKey.trim() === '') {
        return {
            success: false,
            error: { message: 'Gemini API key is required. Set VITE_GEMINI_API_KEY in your .env file.', code: 'NO_API_KEY' }
        };
    }

    if (!transcript || transcript.trim().length < 10) {
        return {
            success: false,
            error: { message: 'Transcript is too short for Q&A.', code: 'SHORT_TRANSCRIPT' }
        };
    }

    if (!question || question.trim().length < 3) {
        return {
            success: false,
            error: { message: 'Please ask a more detailed question.', code: 'SHORT_QUESTION' }
        };
    }

    const contextChunks = retrieveRelevantChunks(transcript, question);
    if (contextChunks.length === 0) {
        return {
            success: false,
            error: { message: 'Could not build context from transcript.', code: 'NO_CONTEXT' }
        };
    }

    try {
        const prompt = getRagPrompt(question, contextChunks);

        const apiResult = await callGeminiWithFallback(apiKey, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2,
                topP: 0.8,
                maxOutputTokens: 768,
            }
        });

        if (!apiResult.success) {
            return {
                success: false,
                error: { message: apiResult.message, code: 'API_ERROR' }
            };
        }

        const data = apiResult.data;
        const generatedText = extractGeneratedText(data);

        if (!generatedText) {
            return {
                success: false,
                error: { message: 'No response generated from API.', code: 'EMPTY_RESPONSE' }
            };
        }

        let cleanJson = generatedText.trim();
        if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.slice(7);
        }
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.slice(3);
        }
        if (cleanJson.endsWith('```')) {
            cleanJson = cleanJson.slice(0, -3);
        }
        cleanJson = cleanJson.trim();

        const parsed = JSON.parse(cleanJson) as RagAnswer;

        if (!parsed.answer || !Array.isArray(parsed.citations)) {
            throw new Error('Invalid RAG response shape');
        }

        const validChunkIds = new Set(contextChunks.map(chunk => chunk.id));
        const citations = parsed.citations
            .filter(citation =>
                typeof citation.chunkId === 'number' &&
                validChunkIds.has(citation.chunkId) &&
                typeof citation.excerpt === 'string' &&
                citation.excerpt.trim().length > 0
            )
            .slice(0, 3);

        return {
            success: true,
            result: {
                answer: parsed.answer.trim(),
                citations
            }
        };
    } catch (error) {
        console.error('[Gemini][RAG] Request failed:', error);
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
 * Validate a Gemini API key by making a simple test request
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey || apiKey.trim() === '') return false;

    try {
        const apiResult = await callGeminiWithFallback(apiKey, {
            contents: [{ parts: [{ text: 'Hi' }] }],
            generationConfig: { maxOutputTokens: 10 }
        });
        return apiResult.success;
    } catch {
        return false;
    }
}

export function getStoredApiKey(): string {
    try {
        return import.meta.env.VITE_GEMINI_API_KEY || '';
    } catch {
        return '';
    }
}
