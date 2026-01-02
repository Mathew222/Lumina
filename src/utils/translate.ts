/**
 * Translation Utility with Low-Latency Translation
 * Optimized for real-time subtitle translation
 */

export type SupportedLanguage = 'en' | 'ml';

export const LANGUAGES: { code: SupportedLanguage; name: string; nativeName: string }[] = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
];

// Cache for translations to avoid repeated API calls
const translationCache = new Map<string, string>();

// Pending translation requests to prevent duplicate calls
const pendingRequests = new Map<string, Promise<string>>();

// Context buffer for context-aware translation (reduced for speed)
let contextBuffer: string[] = [];
const MAX_CONTEXT_SENTENCES = 2; // Reduced from 5 for faster translation

// Pre-warm cache with common words/phrases for Malayalam
const commonTranslations: Record<string, string> = {
    'hello': 'ഹലോ',
    'thank you': 'നന്ദി',
    'yes': 'അതെ',
    'no': 'ഇല്ല',
    'okay': 'ശരി',
    'please': 'ദയവായി',
    'sorry': 'ക്ഷമിക്കണം',
    'good': 'നല്ലത്',
    'the': '',  // Skip common articles
    'a': '',
    'an': '',
};

// Initialize cache with common translations
Object.entries(commonTranslations).forEach(([en, ml]) => {
    if (ml) translationCache.set(`${en}_ml`, ml);
});

/**
 * Translate text using Google Translate API (free tier)
 * Optimized for low latency with reduced context
 */
export async function translateText(
    text: string,
    targetLang: SupportedLanguage,
    useContext: boolean = true
): Promise<string> {
    if (targetLang === 'en' || !text.trim()) {
        return text;
    }

    // Check cache first (fastest path)
    const cacheKey = `${text.toLowerCase().trim()}_${targetLang}`;
    if (translationCache.has(cacheKey)) {
        // Update context even for cached results
        updateContext(text);
        return translationCache.get(cacheKey)!;
    }

    // Check if there's already a pending request for this text
    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    // Create the translation promise
    const translationPromise = performTranslation(text, targetLang, useContext, cacheKey);
    pendingRequests.set(cacheKey, translationPromise);

    try {
        const result = await translationPromise;
        return result;
    } finally {
        pendingRequests.delete(cacheKey);
    }
}

async function performTranslation(
    text: string,
    targetLang: SupportedLanguage,
    useContext: boolean,
    cacheKey: string
): Promise<string> {
    try {
        // Build minimal context for faster translation
        let textToTranslate = text;

        // Only use 1-2 previous sentences for context (faster)
        if (useContext && contextBuffer.length > 0) {
            // Use only the last sentence for minimal context
            const lastContext = contextBuffer[contextBuffer.length - 1];
            textToTranslate = lastContext + '. ' + text;
        }

        // Use Google Translate API with timeout for faster failure
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;

        const response = await fetch(url, {
            signal: controller.signal,
            // Hint to browser for faster connection
            keepalive: true,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Translation failed: ${response.status}`);
        }

        const data = await response.json();

        // Parse the response
        let translatedText = '';
        if (data && data[0]) {
            for (const segment of data[0]) {
                if (segment[0]) {
                    translatedText += segment[0];
                }
            }
        }

        // Extract only the current sentence's translation if context was used
        if (useContext && contextBuffer.length > 0) {
            const parts = translatedText.split('. ');
            translatedText = parts[parts.length - 1] || translatedText;
        }

        // Update context and cache
        updateContext(text);
        translationCache.set(cacheKey, translatedText);

        return translatedText;
    } catch (error) {
        console.error('[Translation] Error:', error);
        return text;
    }
}

function updateContext(text: string): void {
    contextBuffer.push(text);
    if (contextBuffer.length > MAX_CONTEXT_SENTENCES) {
        contextBuffer.shift();
    }
}

/**
 * Translate text in real-time (for interim results)
 * Ultra-fast path with minimal processing
 */
export async function translateInterim(
    text: string,
    targetLang: SupportedLanguage
): Promise<string> {
    if (targetLang === 'en' || !text.trim()) {
        return text;
    }

    // Very short text - check common words cache
    const lowerText = text.toLowerCase().trim();
    if (lowerText.length < 15) {
        const cached = translationCache.get(`${lowerText}_${targetLang}`);
        if (cached !== undefined) {
            return cached || text;
        }
    }

    // Check cache
    const cacheKey = `interim_${lowerText}_${targetLang}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey)!;
    }

    // Check pending requests
    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey)!;
    }

    // Perform fast translation without context
    const translationPromise = (async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout for interim

            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

            const response = await fetch(url, {
                signal: controller.signal,
                keepalive: true,
            });
            clearTimeout(timeoutId);

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

            // Cache with size limit
            if (translationCache.size > 500) {
                // Clear old interim translations
                const keys = Array.from(translationCache.keys());
                let cleared = 0;
                for (const key of keys) {
                    if (key.startsWith('interim_')) {
                        translationCache.delete(key);
                        cleared++;
                        if (cleared >= 100) break;
                    }
                }
            }
            translationCache.set(cacheKey, translatedText);

            return translatedText;
        } catch {
            return text;
        }
    })();

    pendingRequests.set(cacheKey, translationPromise);

    try {
        return await translationPromise;
    } finally {
        pendingRequests.delete(cacheKey);
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
    pendingRequests.clear();
    // Re-add common translations
    Object.entries(commonTranslations).forEach(([en, ml]) => {
        if (ml) translationCache.set(`${en}_ml`, ml);
    });
}
