const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Essential Git operations
    gitPull: (path) => ipcRenderer.invoke('git:pull', path),
    gitPush: (path) => ipcRenderer.invoke('git:push', path),
    gitStatus: (path) => ipcRenderer.invoke('git:status', path),
    gitLog: (path) => ipcRenderer.invoke('git:log', path),
    gitBranches: (path) => ipcRenderer.invoke('git:branches', path),
    gitAdd: (path) => ipcRenderer.invoke('git:add', path),
    gitCommit: (path, message) => ipcRenderer.invoke('git:commit', path, message),

    // Repository operations
    getRepositories: () => ipcRenderer.invoke('repositories:get'),
    addRepository: (path) => ipcRenderer.invoke('repositories:add', path),
    removeRepository: (path) => ipcRenderer.invoke('repositories:remove', path),

    // File system operations
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory')
});