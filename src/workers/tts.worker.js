/**
 * TTS Worker — Malayalam Text-to-Speech using Meta's MMS model
 * Uses @xenova/transformers (already in the project) to run AI TTS offline.
 * Model: Xenova/mms-tts-mal  (Meta Massively Multilingual Speech — Malayalam)
 *
 * Messages IN:
 *   { type: 'init' }
 *   { type: 'speak', text: string }
 *   { type: 'cancel' }
 *
 * Messages OUT:
 *   { type: 'loading', progress: number }
 *   { type: 'ready' }
 *   { type: 'audio', audio: Float32Array, samplingRate: number }
 *   { type: 'error', error: string }
 *   { type: 'done' }
 */

import { pipeline, env } from '@xenova/transformers';

// Allow model downloads from HuggingFace CDN
env.allowLocalModels = false;
env.allowRemoteModels = true;

let synthesizer = null;
let isCancelled = false;

self.onmessage = async (event) => {
    const { type, text } = event.data;

    if (type === 'init') {
        try {
            self.postMessage({ type: 'loading', progress: 0 });

            synthesizer = await pipeline(
                'text-to-speech',
                'Xenova/mms-tts-mal',
                {
                    progress_callback: (progress) => {
                        if (progress.status === 'progress') {
                            const pct = Math.round((progress.loaded / progress.total) * 100);
                            self.postMessage({ type: 'loading', progress: pct });
                        }
                    }
                }
            );

            self.postMessage({ type: 'ready' });
        } catch (err) {
            console.error('[TTS Worker] Init error:', err);
            self.postMessage({ type: 'error', error: err.message || String(err) });
        }

    } else if (type === 'speak') {
        if (!synthesizer) {
            self.postMessage({ type: 'error', error: 'TTS model not loaded yet' });
            return;
        }
        if (!text || !text.trim()) {
            self.postMessage({ type: 'done' });
            return;
        }

        isCancelled = false;

        try {
            const output = await synthesizer(text.trim());

            if (isCancelled) {
                self.postMessage({ type: 'done' });
                return;
            }

            // output.audio is Float32Array, output.sampling_rate is the sample rate (typically 16000)
            const audioBuffer = output.audio;
            const samplingRate = output.sampling_rate;

            self.postMessage(
                { type: 'audio', audio: audioBuffer, samplingRate },
                [audioBuffer.buffer]  // Transfer ownership for zero-copy
            );
        } catch (err) {
            console.error('[TTS Worker] Speak error:', err);
            self.postMessage({ type: 'error', error: err.message || String(err) });
        }

    } else if (type === 'cancel') {
        isCancelled = true;
        self.postMessage({ type: 'done' });
    }
};
