import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_ID = 'Xenova/whisper-base.en';
const FILES = [
    'config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'model.onnx', // Check if quantized is default. Usually 'model_quantized.onnx' is standard for web.
    // 'model_quantized.onnx' 
];

// Xenova/whisper-base.en file list usually includes model_quantized.onnx. 
// We will try to download model_quantized.onnx first as it is smaller and faster.
// If user says "best", we can try unquantized, but it's 500MB+.
const MODEL_FILES = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
    // Split ONNX models (quantized)
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx'
];

const OUTPUT_DIR = path.join(__dirname, '../public/models/whisper-base.en');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const downloadFile = async (file) => {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${file}`;
    // Flatten: save to root of OUTPUT_DIR even if file has slashes
    const fileName = path.basename(file);
    const dest = path.join(OUTPUT_DIR, fileName);

    if (fs.existsSync(dest)) {
        console.log(`Skipping ${file} (already exists)`);
        return;
    }

    console.log(`Downloading ${file}...`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Failed to download ${file}: ${response.status} ${response.statusText}`);
            if (response.status === 404 && file === 'model_quantized.onnx') {
                console.log("Quantized model not found, skipping (will try model.onnx)");
            }
            return;
        }

        // Node 18 fetch response.body is a ReadableStream
        // We can use pipeline or just readableWebToNodeReadable
        // Quick way for text/binary:
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(dest, Buffer.from(buffer));
        console.log(`Downloaded ${file}`);

    } catch (error) {
        console.error(`Error downloading ${file}:`, error);
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
    }
};

const main = async () => {
    console.log(`Downloading ${MODEL_ID} to ${OUTPUT_DIR}...`);
    for (const file of MODEL_FILES) {
        // If file has 'onnx/' prefix, we download from onnx/ subfolder but save to root.
        await downloadFile(file);
    }
    console.log("Model download complete.");
};

main();
