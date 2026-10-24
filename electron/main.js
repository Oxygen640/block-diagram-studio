/* ============================================================================
 *  main.js  ——  Electron 主进程
 *  方框图化简工作室
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

// 单实例：重复双击图标时激活已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;

  function createWindow() {
    win = new BrowserWindow({
      width: 1500,
      height: 940,
      minWidth: 1080,
      minHeight: 680,
      title: '方框图化简工作室',
      backgroundColor: '#eef2f7',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });

    Menu.setApplicationMenu(null);
    win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

    win.once('ready-to-show', () => {
      win.show();
    });

    // 页面里的外链一律用系统浏览器打开
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    win.on('closed', () => { win = null; });
  }

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (ev, url) => {
      if (!url.startsWith('file://')) {
        ev.preventDefault();
        shell.openExternal(url);
      }
    });
  });

  process.on('uncaughtException', (err) => {
    try {
      dialog.showErrorBox('程序出错', String(err && err.stack ? err.stack : err));
    } catch (_) { /* ignore */ }
  });
}
