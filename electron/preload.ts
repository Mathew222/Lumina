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
    }
});
