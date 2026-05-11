export interface ElectronAPI {
    toggleOverlay: () => void;
    sendTranscript: (data: any) => void;
    showMainWindow: () => void;
    onTranscriptUpdate: (callback: (data: any) => void) => () => void;
    getAudioSources: () => Promise<any[]>;
}

declare global {
    interface Window {
        electron: ElectronAPI;
    }
}
