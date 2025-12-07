const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

// Import our handlers
require('./main-process-handlers');

// Auto-updater
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = false; // We'll handle download confirmation

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Determine the correct path based on environment
  let indexPath;
  if (app.isPackaged) {
    // When packaged, extraResources are available in process.resourcesPath
    indexPath = path.join(process.resourcesPath, 'dist', 'index.html');
  } else {
    // In development, use the local dist directory
    indexPath = path.join(__dirname, 'dist', 'index.html');
  }

  mainWindow.loadFile(indexPath);

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
};

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Auto-update functionality
function initializeAutoUpdater(mainWindow) {
  autoUpdater.on('error', (error) => {
    console.error('Update error:', error);
    mainWindow && mainWindow.webContents && mainWindow.webContents.send('update-error', error.message);
  });

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
    mainWindow && mainWindow.webContents && mainWindow.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info);
    mainWindow && mainWindow.webContents && mainWindow.webContents.send('update-available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available');
    mainWindow && mainWindow.webContents && mainWindow.webContents.send('update-not-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow && mainWindow.webContents && mainWindow.webContents.send('update-download-progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info);
    mainWindow && mainWindow.webContents && mainWindow.webContents.send('update-downloaded', info);
  });

  // Check for updates when the app is ready
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 5000); // Check after 5 seconds to allow UI to load

  // Listen for manual update check from renderer
  ipcMain.handle('check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Listen for update download request from renderer
  ipcMain.handle('download-update', async () => {
    try {
      autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Listen for update install request from renderer
  ipcMain.handle('quit-and-install', async () => {
    try {
      setImmediate(() => {
        autoUpdater.quitAndInstall();
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

app.on('ready', () => {
  const mainWindow = createWindow();
  initializeAutoUpdater(mainWindow);
});

app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('quit', () => {
  // Cleanup any resources before quitting
});