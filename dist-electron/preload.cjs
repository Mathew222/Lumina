// electron/preload.ts
var { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electron", {
  toggleOverlay: () => ipcRenderer.send("toggle-overlay"),
  sendTranscript: (data) => ipcRenderer.send("send-transcript", data),
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
  // Microsoft Edge Neural TTS
  synthesizeEdgeTTS: async (text, voice) => {
    const buffer = await ipcRenderer.invoke("synthesize-edge-tts", { text, voice });
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
});
