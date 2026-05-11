/**
 * Downloads the Xenova/whisper-small.en model from HuggingFace
 * and saves it to public/models/whisper-small.en/
 */
import { pipeline, env } from '@xenova/transformers';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DEST = path.join(__dirname, 'public', 'models');

// Point the library at our local models folder so files are saved there
env.localModelPath = MODEL_DEST + '/';
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.useBrowserCache = false;

console.log('📥 Downloading whisper-small.en → public/models/whisper-small.en/');
console.log('   (This may take a few minutes — ~244 MB)');

// Ensure destination exists
fs.mkdirSync(path.join(MODEL_DEST, 'whisper-small.en'), { recursive: true });

// Trigger the download by initializing the pipeline — the files will be cached
// to env.localModelPath by @xenova/transformers
const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', {
    progress_callback: (info) => {
        if (info.status === 'downloading') {
            const pct = info.total
                ? ((info.loaded / info.total) * 100).toFixed(1)
                : '?';
            process.stdout.write(`\r   ${info.file} — ${pct}%   `);
        } else if (info.status === 'done') {
            console.log(`\n   ✅ ${info.file}`);
        }
    },
});

console.log('\n✅ Model ready in public/models/whisper-small.en/');
process.exit(0);
