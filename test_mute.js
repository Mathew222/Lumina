const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');

let win;

app.on('ready', () => {
    win = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const webContentsId = win.webContents.id;

    const html = `
    <html><body>
    <h1>Muted WebContents Capture Test</h1>
    <video id="vid" src="https://www.w3schools.com/html/mov_bbb.mp4" loop autoplay controls></video>
    <script>
        setTimeout(async () => {
            try {
                console.log('Requesting capture of webContents: ${webContentsId}');
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: 'webcontents:${webContentsId}'
                        }
                    },
                    video: false
                });
                console.log('Stream acquired!', stream);
                
                const ctx = new AudioContext();
                const sourceNode = ctx.createMediaStreamSource(stream);
                const analyzer = ctx.createAnalyser();
                sourceNode.connect(analyzer);
                
                const data = new Uint8Array(analyzer.frequencyBinCount);
                setInterval(() => {
                    analyzer.getByteFrequencyData(data);
                    const sum = data.reduce((a, b) => a + b, 0);
                    console.log('Audio volume:', sum);
                    if (sum > 0) {
                        require('electron').ipcRenderer.send('test-passed');
                    }
                }, 500);
            } catch (e) {
                console.error('Capture failed:', e);
            }
        }, 2000);
    </script>
    </body></html>
    `;

    fs.writeFileSync('test.html', html);
    win.loadFile('test.html');
    win.webContents.setAudioMuted(true);

    ipcMain.on('test-passed', () => {
        console.log("SUCCESS: Captured internal audio via webcontents id!");
        app.quit();
    });

    setTimeout(() => {
        console.log("FAIL: Only silence or capture failed.");
        app.quit();
    }, 10000);
});
