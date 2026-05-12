/**
 * TTS (Text-to-Speech) Utility
 *
 * Primary: Microsoft Edge Neural TTS (via Electron IPC)
 *   - en: en-US-AriaNeural (very human, conversational)
 *   - ml: ml-IN-SobhanaNeural (natural Malayalam female voice)
 *
 * Fallback 1 (Malayalam): Meta MMS offline model (tts.worker.js)
 * Fallback 2: Web Speech API
 */

// ────────────────────────────────────────────────
// Audio Context
// ────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext();
    return audioCtx;
}

// ────────────────────────────────────────────────
// Edge TTS voice map
// ────────────────────────────────────────────────
const EDGE_VOICE_MAP: Record<string, string> = {
    'en': 'en-US-AriaNeural',
    'ml': 'ml-IN-SobhanaNeural',
    'hi': 'hi-IN-SwaraNeural',
    'ta': 'ta-IN-PallaviNeural',
    'te': 'te-IN-ShrutiNeural',
    'kn': 'kn-IN-SapnaNeural',
    'fr': 'fr-FR-DeniseNeural',
    'de': 'de-DE-KatjaNeural',
    'es': 'es-ES-ElviraNeural',
    'ja': 'ja-JP-NanamiNeural',
    'zh': 'zh-CN-XiaoxiaoNeural',
};

function getEdgeVoice(lang: string): string {
    return EDGE_VOICE_MAP[lang] || 'en-US-AriaNeural';
}

/** Pre-warm the Edge TTS WebSocket connection for a given language. Call this
 *  as early as possible (e.g. when the user toggles dubbing on) so the first
 *  real phrase starts without waiting for the WebSocket handshake. */
export function warmVoice(lang: string): void {
    const electron = (window as any).electron;
    if (!electron?.warmEdgeTTS) return;
    const voice = getEdgeVoice(lang);
    electron.warmEdgeTTS(voice).catch(() => { /* ignore */ });
}

// ────────────────────────────────────────────────
// Meta MMS Worker (Malayalam offline fallback)
// ────────────────────────────────────────────────
let mmsWorker: Worker | null = null;
let mmsReady = false;
let mmsReadyCallbacks: Array<() => void> = [];

function ensureMMSWorker(): Promise<void> {
    return new Promise((resolve) => {
        if (mmsReady) { resolve(); return; }
        if (mmsReadyCallbacks.length > 0) { mmsReadyCallbacks.push(resolve); return; }
        mmsReadyCallbacks.push(resolve);
        mmsWorker = new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' });
        mmsWorker.onmessage = (e) => {
            if (e.data.type === 'ready') {
                mmsReady = true;
                mmsReadyCallbacks.forEach(cb => cb());
                mmsReadyCallbacks = [];
            }
        };
        mmsWorker.postMessage({ type: 'init' });
    });
}

function speakWithMMS(
    text: string, rate: number,
    onStart?: () => void, onEnd?: () => void, onError?: (e: Error) => void
): Promise<void> {
    return new Promise(async (resolve) => {
        try { await ensureMMSWorker(); } catch (e: any) { if (onError) onError(e); resolve(); return; }
        const worker = mmsWorker!;
        const ctx = getAudioContext();
        const handler = async (event: MessageEvent) => {
            const { type, audio, samplingRate, error } = event.data;
            if (type === 'audio') {
                worker.removeEventListener('message', handler);
                if (ctx.state === 'suspended') await ctx.resume();
                const buf = ctx.createBuffer(1, audio.length, samplingRate);
                buf.getChannelData(0).set(audio);
                const source = ctx.createBufferSource();
                source.buffer = buf;
                source.playbackRate.value = rate;
                source.connect(ctx.destination);
                source.onended = () => { currentSource = null; if (onEnd) onEnd(); resolve(); };
                currentSource = source;
                if (onStart) onStart();
                source.start(0);
            } else if (type === 'error' || type === 'done') {
                worker.removeEventListener('message', handler);
                if (type === 'error' && onError) onError(new Error(error));
                else if (onEnd) onEnd();
                resolve();
            }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'speak', text });
    });
}

// ────────────────────────────────────────────────
// Edge TTS via Electron IPC
// ────────────────────────────────────────────────
async function speakWithEdgeTTS(
    text: string, lang: string, rate: number,
    onStart?: () => void, onEnd?: () => void, onError?: (e: Error) => void
): Promise<boolean> {
    const electron = (window as any).electron;
    if (!electron?.synthesizeEdgeTTS) return false;

    try {
        const voice = getEdgeVoice(lang);
        const arrayBuffer: ArrayBuffer = await electron.synthesizeEdgeTTS(text, voice);
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = rate;
        source.connect(ctx.destination);
        source.onended = () => { currentSource = null; if (onEnd) onEnd(); };
        currentSource = source;
        if (onStart) onStart();
        source.start(0);
        return true;
    } catch (err: any) {
        console.warn('[TTS] Edge TTS failed:', err.message);
        if (onError) onError(err instanceof Error ? err : new Error(String(err)));
        return false;
    }
}

// ────────────────────────────────────────────────
// Web Speech API final fallback
// ────────────────────────────────────────────────
function speakWithWebSpeech(
    text: string, lang: string, rate: number,
    onStart?: () => void, onEnd?: () => void, onError?: (e: Error) => void
): Promise<void> {
    return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = rate;
        utter.lang = lang === 'ml' ? 'ml-IN' : lang === 'en' ? 'en-US' : lang;
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang.startsWith(utter.lang)) || voices[0];
        if (voice) utter.voice = voice;
        utter.onstart = () => { if (onStart) onStart(); };
        utter.onend = () => { if (onEnd) onEnd(); resolve(); };
        utter.onerror = (e) => { if (onError) onError(new Error(e.error)); resolve(); };
        window.speechSynthesis.speak(utter);
    });
}

// ────────────────────────────────────────────────
// Main API
// ────────────────────────────────────────────────

/**
 * Speaks text using the best available TTS engine.
 * 1. Microsoft Edge Neural TTS (human quality, supports ML + EN)
 * 2. Meta MMS offline model (Malayalam only)
 * 3. Web Speech API
 */
export async function speakText(
    text: string,
    lang: string = 'ml',
    rate: number = 0.9,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (e: Error) => void
): Promise<void> {
    if (!text.trim()) return;

    // Try Edge TTS first (best quality)
    const edgeSuccess = await speakWithEdgeTTS(text, lang, rate, onStart, onEnd, onError);
    if (edgeSuccess) return;

    // For Malayalam: fallback to offline Meta MMS
    if (lang === 'ml') {
        await speakWithMMS(text, rate, onStart, onEnd, onError);
        return;
    }

    // Final fallback: Web Speech API
    if ('speechSynthesis' in window) {
        if (window.speechSynthesis.getVoices().length === 0) {
            await new Promise<void>(r => { window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; r(); }; });
        }
        await speakWithWebSpeech(text, lang, rate, onStart, onEnd, onError);
    }
}

export function stopAudio(): void {
    if (currentSource) {
        try { currentSource.stop(); } catch { /* ignored */ }
        currentSource = null;
    }
    if ('speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
        window.speechSynthesis.cancel();
    }
    if (mmsWorker) mmsWorker.postMessage({ type: 'cancel' });
}

export function isAudioPlaying(): boolean {
    return currentSource !== null || window.speechSynthesis.speaking;
}

// ────────────────────────────────────────────────
// Prefetch API (fetch and play are separated so
// the next segment can be fetched while current plays)
// ────────────────────────────────────────────────

/**
 * Fetch audio for a text segment without playing it.
 * Returns an AudioBuffer ready for immediate playback, or null on failure.
 */
export async function fetchAudioBuffer(
    text: string,
    lang: string = 'ml',
    _rate: number = 0.9   // kept for API compatibility
): Promise<AudioBuffer | null> {
    if (!text.trim()) return null;

    const electron = (window as any).electron;
    if (electron?.synthesizeEdgeTTS) {
        try {
            const voice = EDGE_VOICE_MAP[lang] || 'en-US-AriaNeural';
            const arrayBuffer: ArrayBuffer = await electron.synthesizeEdgeTTS(text, voice);
            const ctx = getAudioContext();
            if (ctx.state === 'suspended') await ctx.resume();
            return await ctx.decodeAudioData(arrayBuffer.slice(0));
        } catch (e) {
            console.warn('[TTS] Edge fetch failed, trying MMS/WebSpeech');
        }
    }
    // MMS fallback: not easily separable into fetch+play, return null
    // (useMalayalamTTS will fall back to speakText for these)
    return null;
}

/**
 * Play a pre-fetched AudioBuffer immediately.
 */
export function playAudioBuffer(
    buffer: AudioBuffer,
    rate: number = 0.9,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (e: Error) => void
): void {
    try {
        const ctx = getAudioContext();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        source.connect(ctx.destination);
        source.onended = () => { currentSource = null; if (onEnd) onEnd(); };
        currentSource = source;
        if (onStart) onStart();
        source.start(0);
    } catch (err: any) {
        if (onError) onError(err instanceof Error ? err : new Error(String(err)));
    }
}

// ────────────────────────────────────────────────
// Streaming long-text TTS
// Splits into sentences, pre-fetches the next while the current plays.
// Starts playing the FIRST sentence almost immediately.
// ────────────────────────────────────────────────
let longTextStopFlag = false;

export function stopLongText(): void {
    longTextStopFlag = true;
    stopAudio();
}

/**
 * Speak a long text by splitting into sentences and streaming them.
 * The first sentence starts playing within ~300ms regardless of text length.
 */
export async function speakLongText(
    text: string,
    lang: string = 'en',
    rate: number = 0.9,
    onStart?: () => void,
    onEnd?: () => void,
    onError?: (e: Error) => void
): Promise<void> {
    if (!text.trim()) return;

    longTextStopFlag = false;

    // Split into sentences (. ! ? ।) keeping delimiter
    const rawSentences = text.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g) || [text];
    // Group short sentences together (<=80 chars) to reduce IPC calls
    const CHUNK_MIN = 80;
    const sentences: string[] = [];
    let buf = '';
    for (const s of rawSentences) {
        buf += s;
        if (buf.length >= CHUNK_MIN) { sentences.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) sentences.push(buf.trim());

    if (sentences.length === 0) return;

    const electron = (window as any).electron;
    const voice = EDGE_VOICE_MAP[lang] || 'en-US-AriaNeural';
    const ctx = getAudioContext();

    // Helper: fetch one sentence → AudioBuffer
    const fetchSentence = async (s: string): Promise<AudioBuffer | null> => {
        if (!electron?.synthesizeEdgeTTS || !s.trim()) return null;
        try {
            const ab: ArrayBuffer = await electron.synthesizeEdgeTTS(s, voice);
            if (ctx.state === 'suspended') await ctx.resume();
            return await ctx.decodeAudioData(ab.slice(0));
        } catch { return null; }
    };

    // Fetch first two immediately (so playback starts fast AND next is pre-loaded)
    const buffers: (AudioBuffer | null)[] = new Array(sentences.length).fill(null);
    const fetchQueue: Promise<void>[] = [];

    const prefetch = (i: number) => {
        if (i >= sentences.length) return;
        const p = fetchSentence(sentences[i]).then(buf => { buffers[i] = buf; });
        fetchQueue.push(p);
    };

    prefetch(0);
    prefetch(1);

    // Play each sentence in order
    let started = false;
    for (let i = 0; i < sentences.length; i++) {
        if (longTextStopFlag) break;

        // Wait for this sentence's buffer
        if (fetchQueue[i]) await fetchQueue[i];
        if (longTextStopFlag) break;

        const buf = buffers[i];
        if (!buf) {
            // Edge TTS failed — fallback to WebSpeech for this sentence
            if ('speechSynthesis' in window) {
                await speakWithWebSpeech(sentences[i], lang, rate,
                    !started ? () => { started = true; if (onStart) onStart(); } : undefined,
                    undefined, undefined);
            }
            prefetch(i + 2);
            continue;
        }

        // Pre-fetch the one 2 ahead while current plays
        prefetch(i + 2);

        await new Promise<void>((resolve) => {
            playAudioBuffer(
                buf, rate,
                !started ? () => { started = true; if (onStart) onStart(); } : undefined,
                resolve,
                () => resolve()
            );
        });
    }

    if (!longTextStopFlag && onEnd) onEnd();
}

