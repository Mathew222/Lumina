import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.join(__dirname, '../public/models/whisper-base.en');
const ONNX_DIR = path.join(MODEL_DIR, 'onnx');

const main = () => {
    if (!fs.existsSync(MODEL_DIR)) {
        console.error(`Model directory not found: ${MODEL_DIR}`);
        return;
    }

    if (fs.existsSync(ONNX_DIR)) {
        console.log(`Found 'onnx' subdirectory. Moving files to root of model directory...`);
        const files = fs.readdirSync(ONNX_DIR);
        files.forEach(file => {
            const src = path.join(ONNX_DIR, file);
            const dest = path.join(MODEL_DIR, file);
            fs.renameSync(src, dest);
            console.log(`Moved ${file} -> ${path.basename(MODEL_DIR)}/${file}`);
        });
        fs.rmdirSync(ONNX_DIR);
        console.log(`Removed empty 'onnx' directory.`);
    } else {
        console.log(`No 'onnx' subdirectory found. Checking for model files in root...`);
        // Check if files exist in root
        const expectedFiles = [
            'encoder_model_quantized.onnx',
            'decoder_model_quantized.onnx',
            'decoder_model_merged_quantized.onnx'
        ];

        const missing = expectedFiles.filter(f => !fs.existsSync(path.join(MODEL_DIR, f)));
        if (missing.length > 0) {
            console.warn(`WARNING: The following model files are missing from ${MODEL_DIR}:`, missing);
            console.warn("You may need to run 'npm run download-model' or check your download.");
        } else {
            console.log("All expected model files present in root.");
        }
    }
};

main();
