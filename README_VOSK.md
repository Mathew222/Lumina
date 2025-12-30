# Vosk Integration - Low Latency Speech Recognition

This project now uses Vosk for ultra-low latency speech recognition instead of Whisper.

## Setup Instructions

### 1. Download a Vosk Model

Download a Vosk model from: https://alphacephei.com/vosk/models

Recommended models for English:
- **vosk-model-small-en-us-0.15** (39 MB) - Fast, good accuracy
- **vosk-model-en-us-0.22** (1.8 GB) - Better accuracy, slower
- **vosk-model-en-us-0.22-lgraph** (128 MB) - Good balance

### 2. Place Model in Public Directory

1. Download and extract the model
2. Place the model folder in the `public/` directory
3. Update the `MODEL_URL` in `src/workers/vosk.worker.js` to match your model folder name

Example:
```
public/
  vosk-model-small-en-us-0.15/
    am/
    graph/
    ivector/
    conf/
    ...
```

Then update `src/workers/vosk.worker.js`:
```javascript
const MODEL_URL = '/vosk-model-small-en-us-0.15';
```

### 3. Features

- **Ultra-low latency**: Processes 0.3 second chunks every 200ms
- **Partial results**: Shows text as it's being recognized (partial results)
- **Final results**: Complete sentences when speech ends
- **Offline**: Works completely offline, no internet required

### 4. Performance

- **Latency**: ~200-300ms from speech to subtitle
- **Chunk size**: 0.3 seconds
- **Processing interval**: 200ms
- **Sample rate**: 16kHz

### 5. Troubleshooting

If the model doesn't load:
1. Check browser console for errors
2. Verify model path in `vosk.worker.js`
3. Ensure model files are in `public/` directory
4. Check that `vosk.js` is accessible at `/vosk/vosk.js`


