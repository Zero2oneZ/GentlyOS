/**
 * GentlyOS Desktop - Preload Script
 * Exposes safe APIs to renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose GentlyOS API to renderer
contextBridge.exposeInMainWorld('gentlyos', {
  // Process an interaction
  process: (interaction) => ipcRenderer.invoke('gentlyos:process', interaction),

  // Get system status
  getStatus: () => ipcRenderer.invoke('gentlyos:status'),

  // Parse CODIE
  parse: (codie) => ipcRenderer.invoke('gentlyos:parse', codie),

  // Hydrate CODIE to HTML
  hydrate: (codie) => ipcRenderer.invoke('gentlyos:hydrate', codie),

  // Visualize neural graph
  visualize: () => ipcRenderer.invoke('gentlyos:visualize'),

  // Platform info
  platform: process.platform,
  version: process.versions.electron
});

// Expose safe system APIs
contextBridge.exposeInMainWorld('system', {
  // Notifications
  notify: (title, body) => {
    new Notification(title, { body });
  },

  // Clipboard
  clipboard: {
    write: (text) => navigator.clipboard.writeText(text),
    read: () => navigator.clipboard.readText()
  }
});

console.log('[PRELOAD] GentlyOS APIs exposed');
