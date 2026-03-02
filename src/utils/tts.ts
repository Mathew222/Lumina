/**
 * TTS (Text-to-Speech) Utility — Google Translate Audio
 *
 * Uses the same free Google Translate TTS endpoint (no API key, no model download).
 * Returns an MP3 audio blob which we decode and play via the Web Audio API.
 *
 * It works exactly the same as the translate.ts approach — just the audio endpoint.
 */

let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new AudioContext();
    }
    return audioCtx;
}

/**
 * Fetch Malayalam audio for the given text from Google Translate TTS.
 * Splits long text into <=200-char chunks (API limit).
 */
async function fetchGoogleTTSAudio(text: string): Promise<AudioBuffer> {
    const ctx = getAudioContext();

    // Chunk text to stay within the API's length limit
    const chunks = splitIntoChunks(text.trim(), 200);
    const allBuffers: AudioBuffer[] = [];

    for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        // Use googleapis.com — same domain as the translation API, works in Electron without CORS issues
        const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=ml&total=1&idx=0&textlen=${chunk.length}&client=gtx`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`TTS fetch failed: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        allBuffers.push(decoded);
    }

    if (allBuffers.length === 0) throw new Error('No audio data');
    if (allBuffers.length === 1) return allBuffers[0];

    // Concatenate all chunks into one buffer
    const totalLength = allBuffers.reduce((acc, b) => acc + b.length, 0);
    const combined = ctx.createBuffer(1, totalLength, allBuffers[0].sampleRate);
    const channelData = combined.getChannelData(0);
    let offset = 0;
    for (const buf of allBuffers) {
        channelData.set(buf.getChannelData(0), offset);
        offset += buf.length;
    }
    return combined;
}

function splitIntoChunks(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    // Try to split on sentence boundaries
    const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
    let current = '';
    for (const s of sentences) {
        if ((current + s).length > maxLen) {
            if (current) chunks.push(current.trim());
            current = s;
        } else {
            current += s;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

/**
 * Speak text using Google Translate TTS.
 * Cancels any current audio, fetches the MP3, and plays it.
 */
export async function speakMalayalam(
    text: string,
    rate: number = 0.9,
    onEnd?: () => void,
    onError?: (e: Error) => void
): Promise<void> {
    stopAudio();
    const ctx = getAudioContext();

    try {
        if (ctx.state === 'suspended') await ctx.resume();

        const audioBuffer = await fetchGoogleTTSAudio(text);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = rate; // Adjust speed post-fetch
        source.connect(ctx.destination);
        source.onended = () => {
            currentSource = null;
            if (onEnd) onEnd();
        };
        currentSource = source;
        source.start(0);
    } catch (err: any) {
        currentSource = null;
        if (onError) onError(err);
    }
}

/**
 * Stop any currently playing TTS audio.
 */
export function stopAudio(): void {
    if (currentSource) {
        try { currentSource.stop(); } catch { /* already stopped */ }
        currentSource = null;
    }
}

/**
 * Returns true if audio is currently playing.
 */
export function isAudioPlaying(): boolean {
    return currentSource !== null;
}
