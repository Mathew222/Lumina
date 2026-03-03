/**
 * Translation Utility
 *
 * translateText  → Gemini API (accurate, natural Malayalam) with Google Translate fallback
 * translateInterim → Google Translate only (fast, for live subtitle preview)
 */

export type SupportedLanguage = 'en' | 'ml';

export const LANGUAGES: { code: SupportedLanguage; name: string; nativeName: string }[] = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
];

const translationCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

// ────────────────────────────────────────────────
// API helpers
// ────────────────────────────────────────────────

function getGeminiApiKey(): string {
    try {
        return import.meta.env.VITE_GEMINI_API_KEY ||
            localStorage.getItem('lumina_gemini_api_key') || '';
    } catch { return ''; }
}

async function geminiTranslate(text: string, targetLang: SupportedLanguage): Promise<string> {
    const apiKey = getGeminiApiKey();
    if (!apiKey) throw new Error('No Gemini key');

    const langDesc = targetLang === 'ml'
        ? 'Malayalam (മലയാളം) — use natural, modern, conversational Malayalam. Avoid archaic or overly formal words.'
        : targetLang;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text:
                            `Translate the following English text to ${langDesc}.\nReturn ONLY the translated text — no quotes, no explanation, nothing else.\n\nText: ${text}`
                    }]
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
            })
        }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!out) throw new Error('Empty response');
    return out;
}

async function googleTranslate(text: string, targetLang: SupportedLanguage, timeoutMs = 3000): Promise<string> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        let out = '';
        if (data?.[0]) for (const seg of data[0]) if (seg?.[0]) out += seg[0];
        return out;
    } catch { clearTimeout(tid); throw new Error('Google failed'); }
}

// ────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────

/**
 * Translate full sentences/phrases.
 * Uses Gemini for accurate, natural Malayalam; falls back to Google Translate.
 */
export async function translateText(
    text: string,
    targetLang: SupportedLanguage,
    _useContext = true
): Promise<string> {
    if (targetLang === 'en' || !text.trim()) return text;

    const key = `${text.trim()}_${targetLang}`;
    if (translationCache.has(key)) return translationCache.get(key)!;
    if (pendingRequests.has(key)) return pendingRequests.get(key)!;

    const promise = (async () => {
        // Try Gemini first (best quality for Malayalam)
        try {
            const result = await geminiTranslate(text, targetLang);
            translationCache.set(key, result);
            return result;
        } catch (e) {
            console.warn('[Translation] Gemini failed, falling back to Google:', e);
        }
        // Google Translate fallback
        try {
            const result = await googleTranslate(text, targetLang);
            translationCache.set(key, result);
            return result;
        } catch {
            return text;
        }
    })();

    pendingRequests.set(key, promise);
    try { return await promise; } finally { pendingRequests.delete(key); }
}

/**
 * Translate interim/partial text — always uses Google Translate (low latency).
 * This is for the live subtitle preview display only.
 */
export async function translateInterim(text: string, targetLang: SupportedLanguage): Promise<string> {
    if (targetLang === 'en' || !text.trim()) return text;
    const key = `i_${text.trim()}_${targetLang}`;
    if (translationCache.has(key)) return translationCache.get(key)!;
    try {
        const result = await googleTranslate(text, targetLang, 2000);
        if (translationCache.size > 300) {
            for (const k of translationCache.keys()) { if (k.startsWith('i_')) { translationCache.delete(k); break; } }
        }
        translationCache.set(key, result);
        return result;
    } catch { return text; }
}

export function clearTranslationContext(): void { /* no-op */ }

export function clearTranslationCache(): void {
    translationCache.clear();
    pendingRequests.clear();
}
