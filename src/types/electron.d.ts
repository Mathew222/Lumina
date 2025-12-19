export interface ElectronAPI {
    toggleOverlay: () => void;
    sendTranscript: (data: { text: string; interim: string }) => void;
    onTranscriptUpdate: (callback: (data: { text: string; interim: string }) => void) => () => void;
}

declare global {
    interface Window {
        electron?: ElectronAPI;
    }
}
