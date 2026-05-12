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
// NOTE: We intentionally do NOT use Gemini here to avoid quota/rate-limit errors.

// ────────────────────────────────────────────────
// API helpers
// ────────────────────────────────────────────────

async function googleTranslate(text: string, targetLang: SupportedLanguage, timeoutMs = 8000): Promise<string> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    // In Electron, route through main process to bypass CORS/CSP restrictions
    const electron = (window as any).electron;
    if (electron?.fetchGoogleTranslate) {
        const data = await electron.fetchGoogleTranslate(url);
        if (!data) throw new Error('Empty translate response');
        let out = '';
        if (data?.[0]) for (const seg of data[0]) if (seg?.[0]) out += seg[0];
        return out;
    }

    // Direct fetch fallback (non-Electron)
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
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
 * Uses Google Translate only (no Gemini).
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
        try {
            const result = await googleTranslate(text, targetLang);
            translationCache.set(key, result);
            return result;
        } catch {
            // Final fallback: return original text
        }

        // Final fallback
        try {
            return text;
        } catch {
            return text;
        }
    })();

    pendingRequests.set(key, promise);
    try { return await promise; } finally { pendingRequests.delete(key); }
}

/**
 * Fast translation for TTS dubbing — skips Gemini, uses Google Translate only.
 * Cache-first: if the subtitle translation already ran (very likely), returns instantly.
 * Falls back to Google Translate directly (200-400ms) instead of Gemini (500-1500ms).
 */
export async function translateForTTS(
    text: string,
    targetLang: SupportedLanguage
): Promise<string> {
    if (targetLang === 'en' || !text.trim()) return text;

    const key = `${text.trim()}_${targetLang}`;
    // Hit the same cache as translateText — if subtitle already translated this, it's instant
    if (translationCache.has(key)) return translationCache.get(key)!;
    if (pendingRequests.has(key)) return pendingRequests.get(key)!;

    // Not cached yet — use fast Google Translate directly (no Gemini round-trip)
    try {
        const result = await googleTranslate(text, targetLang, 3000);
        translationCache.set(key, result);
        return result;
    } catch { return text; }
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

/**
 * Translate a long text (e.g. full transcript) via Google Translate.
 * Splits into ~4500 char chunks at sentence boundaries to avoid API limits.
 */
export async function translateLongText(
    text: string,
    targetLang: SupportedLanguage
): Promise<string> {
    if (targetLang === 'en' || !text.trim()) return text;

    const CHUNK_SIZE = 4500;
    if (text.length <= CHUNK_SIZE) {
        try { return await googleTranslate(text, targetLang, 10000); } catch { return text; }
    }

    // Split at sentence boundaries (. ! ?)
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks: string[] = [];
    let current = '';

    for (const s of sentences) {
        if ((current + s).length > CHUNK_SIZE && current.length > 0) {
            chunks.push(current.trim());
            current = s;
        } else {
            current += s;
        }
    }
    if (current.trim()) chunks.push(current.trim());

    const results = await Promise.all(
        chunks.map(chunk =>
            googleTranslate(chunk, targetLang, 10000).catch(() => chunk)
        )
    );
    return results.join(' ');
}
