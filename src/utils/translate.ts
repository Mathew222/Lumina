/**
 * Translation Utility with Context-Based Translation
 * Uses Google Translate API (free tier) for accurate context-aware translations
 */

export type SupportedLanguage = 'en' | 'ml';

export const LANGUAGES: { code: SupportedLanguage; name: string; nativeName: string }[] = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
];

// Cache for translations to avoid repeated API calls
const translationCache = new Map<string, string>();

// Context buffer for context-aware translation
let contextBuffer: string[] = [];
const MAX_CONTEXT_SENTENCES = 5;

/**
 * Translate text using Google Translate API (free tier)
 * @param text - Text to translate
 * @param targetLang - Target language code
 * @param useContext - Whether to use context from previous sentences
 */
export async function translateText(
    text: string,
    targetLang: SupportedLanguage,
    useContext: boolean = true
): Promise<string> {
    // No translation needed for English
    if (targetLang === 'en') {
        return text;
    }

    // Check cache first
    const cacheKey = `${text}_${targetLang}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey)!;
    }

    try {
        // Build context-enhanced text for better translation
        let textToTranslate = text;

        if (useContext && contextBuffer.length > 0) {
            // Include previous context for better translation accuracy
            // The translator will use this context but we only return the last sentence's translation
            const contextText = contextBuffer.join('. ') + '. ' + text;
            textToTranslate = contextText;
        }

        // Use Google Translate API (free tier via unofficial endpoint)
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Translation failed: ${response.status}`);
        }

        const data = await response.json();

        // Parse the response - Google returns nested arrays
        let translatedText = '';
        if (data && data[0]) {
            for (const segment of data[0]) {
                if (segment[0]) {
                    translatedText += segment[0];
                }
            }
        }

        // If we used context, extract only the translation of the current text
        // The context sentences are separated by '. '
        if (useContext && contextBuffer.length > 0) {
            const parts = translatedText.split('. ');
            // The last part should be our current sentence
            translatedText = parts[parts.length - 1] || translatedText;
        }

        // Update context buffer
        contextBuffer.push(text);
        if (contextBuffer.length > MAX_CONTEXT_SENTENCES) {
            contextBuffer.shift();
        }

        // Cache the result
        translationCache.set(cacheKey, translatedText);

        return translatedText;
    } catch (error) {
        console.error('[Translation] Error:', error);
        // Return original text on error
        return text;
    }
}

/**
 * Translate text in real-time (for interim results - less accurate but faster)
 * Uses simpler translation without context for speed
 */
export async function translateInterim(
    text: string,
    targetLang: SupportedLanguage
): Promise<string> {
    if (targetLang === 'en' || !text.trim()) {
        return text;
    }

    // Check cache
    const cacheKey = `interim_${text}_${targetLang}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey)!;
    }

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

        const response = await fetch(url);
        if (!response.ok) {
            return text;
        }

        const data = await response.json();
        let translatedText = '';
        if (data && data[0]) {
            for (const segment of data[0]) {
                if (segment[0]) {
                    translatedText += segment[0];
                }
            }
        }

        // Cache interim translations too (smaller cache)
        if (translationCache.size > 500) {
            // Clear old interim translations to prevent memory issues
            const keys = Array.from(translationCache.keys());
            for (let i = 0; i < 100; i++) {
                if (keys[i]?.startsWith('interim_')) {
                    translationCache.delete(keys[i]);
                }
            }
        }
        translationCache.set(cacheKey, translatedText);

        return translatedText;
    } catch {
        return text;
    }
}

/**
 * Clear the context buffer (call when starting new session)
 */
export function clearTranslationContext(): void {
    contextBuffer = [];
}

/**
 * Clear all cached translations
 */
export function clearTranslationCache(): void {
    translationCache.clear();
    contextBuffer = [];
}
