import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';

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
