import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.join(__dirname, '../public/models/whisper-base.en');

if (fs.existsSync(modelDir)) {
    console.log(`Removing ${modelDir}...`);
    try {
        fs.rmSync(modelDir, { recursive: true, force: true });
        console.log('Removed successfully.');
    } catch (e) {
        console.error('Failed to remove:', e);
    }
}
