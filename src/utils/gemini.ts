/**
 * Gemini API Integration for Conversation Summarization
 */

import type { Summary } from '../types/session';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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
            error: { message: 'Gemini API key is required. Please add it in Settings.', code: 'NO_API_KEY' }
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

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    topP: 0.8,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData?.error?.message || `API request failed with status ${response.status}`;

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    error: { message: 'Invalid API key. Please check your Gemini API key.', code: 'INVALID_API_KEY' }
                };
            }

            return {
                success: false,
                error: { message: errorMessage, code: 'API_ERROR' }
            };
        }

        const data = await response.json();

        // Extract text from Gemini response
        const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

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
        } catch (parseError) {
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

/**
 * Validate a Gemini API key by making a simple test request
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey || apiKey.trim() === '') return false;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Hi' }] }],
                generationConfig: { maxOutputTokens: 10 }
            })
        });

        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Get/Set API key from localStorage
 */
const API_KEY_STORAGE_KEY = 'lumina_gemini_api_key';

export function getStoredApiKey(): string {
    try {
        // Check environment variable first (set via .env file with VITE_ prefix)
        const envKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (envKey) return envKey;

        // Fall back to localStorage
        return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
    } catch {
        return '';
    }
}

export function setStoredApiKey(apiKey: string): void {
    try {
        if (apiKey) {
            localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
        } else {
            localStorage.removeItem(API_KEY_STORAGE_KEY);
        }
    } catch (error) {
        console.error('[Gemini] Failed to store API key:', error);
    }
}
