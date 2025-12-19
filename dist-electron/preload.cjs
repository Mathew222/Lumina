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
  }
});
