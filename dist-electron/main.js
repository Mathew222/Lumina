var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/electron/index.js
var require_electron = __commonJS({
  "node_modules/electron/index.js"(exports2, module2) {
    var fs = require("fs");
    var path2 = require("path");
    var pathFile = path2.join(__dirname, "path.txt");
    function getElectronPath() {
      let executablePath;
      if (fs.existsSync(pathFile)) {
        executablePath = fs.readFileSync(pathFile, "utf-8");
      }
      if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
        return path2.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || "electron");
      }
      if (executablePath) {
        return path2.join(__dirname, "dist", executablePath);
      } else {
        throw new Error("Electron failed to install correctly, please delete node_modules/electron and try installing again");
      }
    }
    module2.exports = getElectronPath();
  }
});

// electron/main.ts
var import_electron = __toESM(require_electron(), 1);
var import_path = __toESM(require("path"), 1);
var mainWindow;
var overlayWindow;
function createMainWindow() {
  mainWindow = new import_electron.BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: import_path.default.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const startUrl = process.env.ELECTRON_START_URL || `file://${import_path.default.join(__dirname, "../dist/index.html")}`;
  mainWindow.loadURL(startUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (overlayWindow) {
      overlayWindow.close();
    }
    import_electron.app.quit();
  });
}
function createOverlayWindow() {
  const { width, height } = import_electron.screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new import_electron.BrowserWindow({
    width,
    // Full width
    height: 200,
    // Height for subtitles at bottom
    x: 0,
    y: height - 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    // Make it click-through (mostly)
    webPreferences: {
      preload: import_path.default.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const startUrl = process.env.ELECTRON_START_URL ? `${process.env.ELECTRON_START_URL}?mode=popup` : `file://${import_path.default.join(__dirname, "../dist/index.html")}?mode=popup`;
  overlayWindow.loadURL(startUrl);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}
import_electron.app.whenReady().then(() => {
  createMainWindow();
  import_electron.ipcMain.on("toggle-overlay", () => {
    if (overlayWindow) {
      overlayWindow.close();
      overlayWindow = null;
    } else {
      createOverlayWindow();
    }
  });
  import_electron.ipcMain.on("send-transcript", (_event, data) => {
    if (overlayWindow) {
      overlayWindow.webContents.send("transcript-update", data);
    }
  });
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron.app.quit();
  }
});
