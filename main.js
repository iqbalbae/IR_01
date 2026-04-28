const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handler for saving file
ipcMain.handle('save-breakdown', async (event, breakdownContent) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Formula Breakdown',
    defaultPath: 'breakdown.txt',
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });

  if (canceled) {
    return { success: false, message: 'User canceled dialog' };
  } else {
    try {
      fs.writeFileSync(filePath, breakdownContent, 'utf-8');
      return { success: true, message: 'File saved successfully to ' + filePath };
    } catch (err) {
      return { success: false, message: 'Failed to write file: ' + err.message };
    }
  }
});
