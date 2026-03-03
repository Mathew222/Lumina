import { app, BrowserWindow, ipcMain, screen, desktopCapturer, net } from 'electron';
import path from 'path';
import https from 'https';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';


let mainWindow: BrowserWindow | null;
let overlayWindow: BrowserWindow | null;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Enable screen capture permissions
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') {
            callback(true);
        } else {
            callback(false);
        }
    });

    // On Windows, system audio capture requires specific permissions
    // The desktopCapturer should work, but audio might not be included by default
    // Users may need to enable "Stereo Mix" or similar in Windows sound settings

    // In dev, load localhost. In prod, load index.html
    const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
    mainWindow.loadURL(startUrl);

    mainWindow.on('closed', () => {
        mainWindow = null;
        // Close overlay if main window closes
        if (overlayWindow) {
            overlayWindow.close();
        }
        app.quit();
    });
}

function createOverlayWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    overlayWindow = new BrowserWindow({
        width: width, // Full width
        height: 200,   // Height for subtitles at bottom
        x: 0,
        y: height - 200,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        focusable: false, // Make it click-through (mostly)
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    const startUrl = process.env.ELECTRON_START_URL
        ? `${process.env.ELECTRON_START_URL}?mode=popup`
        : `file://${path.join(__dirname, '../dist/index.html')}?mode=popup`;

    overlayWindow.loadURL(startUrl);
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });

    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });
}

app.whenReady().then(() => {
    createMainWindow();

    ipcMain.on('toggle-overlay', () => {
        if (overlayWindow) {
            overlayWindow.close();
            overlayWindow = null;
        } else {
            createOverlayWindow();
        }
    });

    ipcMain.on('send-transcript', (_event, data) => {
        if (overlayWindow) {
            overlayWindow.webContents.send('transcript-update', data);
        }
    });

    ipcMain.handle('get-audio-sources', async () => {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                fetchWindowIcons: false
            });
            return sources;
        } catch (error) {
            console.error('Error getting audio sources:', error);
            throw error;
        }
    });

    // Fetch TTS audio via main process using Node.js https (avoids Electron/Chromium strict fetch headers)
    ipcMain.handle('fetch-tts-audio', async (_event, url: string) => {
        return new Promise<Buffer>((resolve, reject) => {
            const urlObj = new URL(url);
            const req = https.request({
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://translate.google.com/'
                }
            }, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`TTS fetch failed: ${response.statusCode}`));
                    return;
                }
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        });
    });

    // Microsoft Edge Neural TTS — returns MP3 audio buffer for playback
    ipcMain.handle('synthesize-edge-tts', async (_event, { text, voice }: { text: string; voice: string }) => {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const chunks: Buffer[] = [];
        const { audioStream } = tts.toStream(text);
        await new Promise<void>((resolve, reject) => {
            audioStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
            audioStream.on('end', resolve);
            audioStream.on('error', reject);
        });
        return Buffer.concat(chunks);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
