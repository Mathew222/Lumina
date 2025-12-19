import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORT_DIST = path.resolve(__dirname, '../node_modules/onnxruntime-web/dist');
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const files = [
    'ort-wasm.wasm',
    'ort-wasm-simd.wasm',
    'ort-wasm-threaded.wasm',
    'ort-wasm-simd-threaded.wasm'
];

if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

console.log(`Copying WASM files from ${ORT_DIST} to ${PUBLIC_DIR}...`);

files.forEach(file => {
    const src = path.join(ORT_DIST, file);
    const dest = path.join(PUBLIC_DIR, file);

    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file}`);
    } else {
        console.warn(`Warning: Could not find ${file} in node_modules`);
    }
});
