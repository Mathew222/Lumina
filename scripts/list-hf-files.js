
const MODEL_ID = 'Xenova/whisper-base.en';
const url = `https://huggingface.co/api/models/${MODEL_ID}/tree/main/onnx`;

console.log(`Fetching file tree for ${MODEL_ID}...`);

fetch(url)
    .then(res => res.json())
    .then(files => {
        if (Array.isArray(files)) {
            console.log("Files found:");
            files.forEach(f => console.log(`- ${f.path} (${f.size} bytes)`));
        } else {
            console.log("Error or invalid response:", files);
        }
    })
    .catch(err => console.error("Request failed:", err));
