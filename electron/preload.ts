const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    toggleOverlay: () => ipcRenderer.send('toggle-overlay'),
    sendTranscript: (data: any) => ipcRenderer.send('send-transcript', data),
    onTranscriptUpdate: (callback: (data: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data);
        ipcRenderer.on('transcript-update', subscription);
        return () => {
            ipcRenderer.removeListener('transcript-update', subscription);
        };
    },
    // Get audio sources via IPC from main process (more secure and reliable)
    getAudioSources: async () => {
        return await ipcRenderer.invoke('get-audio-sources');
    },
    // Fetch TTS audio through main process to bypass COEP restrictions
    fetchTTSAudio: async (url: string): Promise<ArrayBuffer> => {
        const buffer: Buffer = await ipcRenderer.invoke('fetch-tts-audio', url);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    },
    // Microsoft Edge Neural TTS
    synthesizeEdgeTTS: async (text: string, voice: string): Promise<ArrayBuffer> => {
        const buffer: Buffer = await ipcRenderer.invoke('synthesize-edge-tts', { text, voice });
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    },
    // Pre-warm TTS WebSocket connection for a given voice (call before first phrase)
    warmEdgeTTS: async (voice: string): Promise<void> => {
        await ipcRenderer.invoke('warm-edge-tts', voice);
    }
});
