// electron/preload.ts
var { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electron", {
  toggleOverlay: () => ipcRenderer.send("toggle-overlay"),
  sendTranscript: (data) => ipcRenderer.send("send-transcript", data),
  showMainWindow: () => ipcRenderer.send("show-main-window"),
  onTranscriptUpdate: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on("transcript-update", subscription);
    return () => {
      ipcRenderer.removeListener("transcript-update", subscription);
    };
  },
  // Get audio sources via IPC from main process (more secure and reliable)
  getAudioSources: async () => {
    return await ipcRenderer.invoke("get-audio-sources");
  },
  // Fetch TTS audio through main process to bypass COEP restrictions
  fetchTTSAudio: async (url) => {
    const buffer = await ipcRenderer.invoke("fetch-tts-audio", url);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
  // Make NVIDIA API calls via main process to bypass CORS
  fetchNvidiaAPI: async (url, options) => {
    return await ipcRenderer.invoke("fetch-nvidia-api", { url, options });
  },
  // Microsoft Edge Neural TTS
  synthesizeEdgeTTS: async (text, voice) => {
    const buffer = await ipcRenderer.invoke("synthesize-edge-tts", { text, voice });
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
  // Pre-warm TTS WebSocket connection for a given voice (call before first phrase)
  warmEdgeTTS: async (voice) => {
    await ipcRenderer.invoke("warm-edge-tts", voice);
  },
  // Google Translate via main process (bypasses renderer CORS/CSP)
  fetchGoogleTranslate: async (url) => {
    return await ipcRenderer.invoke("fetch-google-translate", url);
  },
  // Streaming NVIDIA API — calls onChunk for each token as it arrives
  fetchNvidiaAPIStream: (url, options, requestId, onChunk) => {
    const listener = (_evt, chunk) => onChunk(chunk);
    ipcRenderer.on(`nvidia-chunk-${requestId}`, listener);
    return ipcRenderer.invoke("fetch-nvidia-api-stream", { url, options, requestId }).finally(() => ipcRenderer.removeListener(`nvidia-chunk-${requestId}`, listener));
  }
});
