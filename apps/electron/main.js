/**
 * GentlyOS Desktop - Electron Main Process
 *
 * This is the Electron wrapper for GentlyOS.
 * Provides native desktop experience with:
 * - System tray integration
 * - Native notifications
 * - File system access
 * - Hardware acceleration
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeTheme } = require('electron');
const path = require('path');

// Import GentlyOS core
let GentlyOS;
try {
  GentlyOS = require('../../index.js').GentlyOS;
} catch (e) {
  console.log('[ELECTRON] GentlyOS core not found, running standalone');
}

let mainWindow;
let tray;
let gentlyos;

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'GentlyOS',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0f' : '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: true,
    titleBarStyle: 'hiddenInset'
  });

  // Load the app
  if (process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('renderer/index.html');
  }

  // Handle window close
  mainWindow.on('close', (event) => {
    if (app.isQuitting) {
      mainWindow = null;
    } else {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Create system tray
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show GentlyOS', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Status', sublabel: 'Running', enabled: false },
    { label: 'Security', sublabel: 'Zero Trust Active', enabled: false },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('GentlyOS - Self-Evolving OS');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// Initialize GentlyOS
async function initGentlyOS() {
  if (GentlyOS) {
    gentlyos = new GentlyOS({
      mode: process.argv.includes('--dev') ? 'development' : 'production'
    });
    await gentlyos.init();
    console.log('[ELECTRON] GentlyOS initialized');
  }
}

// IPC Handlers
function setupIPC() {
  // Process interaction
  ipcMain.handle('gentlyos:process', async (event, interaction) => {
    if (gentlyos) {
      return await gentlyos.process(interaction);
    }
    return { error: 'GentlyOS not initialized' };
  });

  // Get status
  ipcMain.handle('gentlyos:status', async () => {
    if (gentlyos) {
      return gentlyos.getStatus();
    }
    return { initialized: false };
  });

  // Parse CODIE
  ipcMain.handle('gentlyos:parse', async (event, codie) => {
    if (gentlyos) {
      return gentlyos.parse(codie);
    }
    return null;
  });

  // Hydrate CODIE
  ipcMain.handle('gentlyos:hydrate', async (event, codie) => {
    if (gentlyos) {
      return gentlyos.hydrate(codie);
    }
    return '';
  });

  // Visualize graph
  ipcMain.handle('gentlyos:visualize', async () => {
    if (gentlyos) {
      return gentlyos.visualize();
    }
    return '';
  });
}

// App ready
app.whenReady().then(async () => {
  await initGentlyOS();
  createWindow();
  createTray();
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

// Quit handling
app.on('before-quit', () => {
  if (gentlyos) {
    gentlyos.shutdown();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
