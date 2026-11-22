"use strict";
// Bridge for the shell's own two pages (settings, error). The Doppel web app's window has no preload at all.
// A sandboxed preload has to be CommonJS, hence the one require() in this folder.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("doppelShell", {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (form) => ipcRenderer.invoke("settings:save", form),
  errorInfo: () => ipcRenderer.invoke("error:info"),
  action: (name) => ipcRenderer.invoke("shell:action", name),
});
