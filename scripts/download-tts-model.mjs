/**
 * Download MMS TTS Malayalam model from HuggingFace to public/models/mms-tts-mal/
 * Handles LFS redirects properly using Node.js https module.
 *
 * Run: node scripts/download-tts-model.mjs
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST_DIR = path.join(__dirname, '..', 'public', 'models', 'mms-tts-mal');
const ORG = 'Xenova';
const MODEL = 'mms-tts-mal';
const BASE_URL = `https://huggingface.co/${ORG}/${MODEL}/resolve/main`;

const FILES = [
    'config.json',
    'tokenizer_config.json',
    'vocab.json',
    'onnx/model.onnx',
];

function download(url, destPath, redirects = 0) {
    if (redirects > 10) return Promise.reject(new Error('Too many redirects'));
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NodeJS-Downloader)',
            },
        }, (res) => {
            // Handle redirects (HuggingFace LFS does 302)
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                const location = res.headers.location;
                if (!location) return reject(new Error(`Redirect without location from ${url}`));
                res.resume(); // drain
                return download(location, destPath, redirects + 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }

            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            const file = fs.createWriteStream(destPath);
            let downloaded = 0;
            const total = parseInt(res.headers['content-length'] || '0');

            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total > 0) {
                    const pct = ((downloaded / total) * 100).toFixed(1);
                    process.stdout.write(`\r  ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`);
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                process.stdout.write('\n');
                resolve();
            });
            file.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy(new Error(`Request timed out for: ${url}`));
        });
    });
}

async function main() {
    console.log(`\nDownloading MMS TTS Malayalam model to:\n  ${DEST_DIR}\n`);
    fs.mkdirSync(DEST_DIR, { recursive: true });

    for (const file of FILES) {
        const destPath = path.join(DEST_DIR, file.replace(/\//g, path.sep));
        if (fs.existsSync(destPath)) {
            const size = fs.statSync(destPath).size;
            console.log(`  SKIP: ${file} (already exists, ${(size / 1024).toFixed(0)} KB)`);
            continue;
        }

        const url = `${BASE_URL}/${file}`;
        console.log(`  Downloading: ${file}`);
        try {
            await download(url, destPath);
            const size = fs.statSync(destPath).size;
            console.log(`  OK: ${file} (${(size / 1024 / 1024).toFixed(2)} MB)`);
        } catch (err) {
            console.error(`  FAIL: ${file} — ${err.message}`);
            process.exit(1);
        }
    }
    console.log('\nAll files downloaded successfully!\n');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
