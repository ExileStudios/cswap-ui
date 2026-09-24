import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerMonitor, screen, session } from 'electron';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { summarize } from '../shared/usage.js';
import { CswapSource } from './cswap.js';
import { DemoSource } from './demo.js';
import { REFRESH_INTERVALS_SEC, SettingsStore } from './settings.js';
import { createTrayIcon } from './tray-icon.js';

const WINDOW_WIDTH = 340;
const MIN_HEIGHT = 80;
const SCREEN_MARGIN = 24;
const SNAPSHOT_SETTLE_MS = 500;

const SRC_DIR = path.join(import.meta.dirname, '..');
const RENDERER_URL = pathToFileURL(path.join(SRC_DIR, 'renderer', 'index.html')).href;
const PRELOAD_PATH = path.join(SRC_DIR, 'preload.cjs');

// Flags: --demo (fictional data), --compact, --snapshot <file.png> (render once, save, exit).
const { values: cli } = parseArgs({
  args: process.argv.slice(app.isPackaged ? 1 : 2),
  options: {
    demo: { type: 'boolean', default: false },
    compact: { type: 'boolean', default: false },
    snapshot: { type: 'string' },
  },
  strict: false,
  allowPositionals: true,
});
const snapshotPath = typeof cli.snapshot === 'string' ? path.resolve(cli.snapshot) : null;

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let settings;
let source;
let pollTimer = null;
let inflight = null;
let lastSnapshot = null;
let lastError = null;

// ---------------------------------------------------------------------------
// Data

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function publishUsage(loading) {
  send('usage', { loading, snapshot: lastSnapshot, error: lastError });
}

/** Fetches fresh usage. Concurrent callers share one in-flight cswap call. */
function refresh() {
  inflight ??= (async () => {
    publishUsage(true);
    try {
      lastSnapshot = await source.fetch();
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    publishUsage(false);
    updateTrayTooltip();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Polls only while the window is visible; showing it triggers a refresh. */
function schedulePoll() {
  clearTimeout(pollTimer);
  if (snapshotPath || !win?.isVisible()) return;
  pollTimer = setTimeout(async () => {
    await refresh();
    schedulePoll();
  }, settings.data.intervalSec * 1000);
}

// ---------------------------------------------------------------------------
// Window

function isOnScreen(x, y) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    x >= a.x - SCREEN_MARGIN && x <= a.x + a.width - SCREEN_MARGIN * 2 && y >= a.y && y <= a.y + a.height - SCREEN_MARGIN * 2,
  );
}

function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - WINDOW_WIDTH - SCREEN_MARGIN, y: workArea.y + SCREEN_MARGIN };
}

function savedOrDefaultPosition() {
  const { x, y } = settings.data;
  return x != null && y != null && isOnScreen(x, y) ? { x, y } : defaultPosition();
}

// Windows ignores always-on-top set before a window is first shown, so this
// is (re)applied every time the window becomes visible.
function applyPin() {
  if (!win) return;
  win.setAlwaysOnTop(settings.data.pinned, 'screen-saver');
  if (settings.data.pinned) win.moveTop();
}

function createWindow() {
  win = new BrowserWindow({
    ...savedOrDefaultPosition(),
    width: WINDOW_WIDTH,
    height: 200,
    title: 'cswap UI',
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  win.once('ready-to-show', () => win.showInactive());
  win.on('show', () => {
    applyPin();
    void refresh();
    schedulePoll();
  });
  win.on('hide', () => clearTimeout(pollTimer));
  win.on('moved', () => {
    const [x, y] = win.getPosition();
    settings.update({ x, y });
  });
  win.on('closed', () => {
    clearTimeout(pollTimer);
    win = null;
  });

  void win.loadURL(RENDERER_URL);
}

function bringToFront() {
  if (!win) return createWindow();
  win.show();
  applyPin();
}

function toggleVisible() {
  if (win?.isVisible()) win.hide();
  else bringToFront();
}

function resetPosition() {
  settings.update({ x: null, y: null });
  if (!win) return;
  const { x, y } = defaultPosition();
  win.setPosition(x, y);
}

// ---------------------------------------------------------------------------
// Settings and tray

function viewSettings() {
  const { pinned, compact } = settings.data;
  return { pinned, compact };
}

function setSetting(key, value) {
  settings.update({ [key]: value });
  if (key === 'pinned') applyPin();
  if (key === 'intervalSec') schedulePoll();
  send('settings', viewSettings());
  tray?.setContextMenu(buildMenu());
}

const loginItemSupported = process.platform === 'win32' || process.platform === 'darwin';

function loginItemOptions() {
  // Unpackaged runs need the app path passed to electron.exe to relaunch correctly.
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

function intervalLabel(sec) {
  if (sec < 60) return `${sec} seconds`;
  const min = sec / 60;
  return `${min} minute${min === 1 ? '' : 's'}`;
}

function buildMenu() {
  const { pinned, compact, intervalSec } = settings.data;
  return Menu.buildFromTemplate([
    { label: 'Show / hide', click: toggleVisible },
    { label: 'Refresh now', click: () => void refresh() },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: pinned, click: (item) => setSetting('pinned', item.checked) },
    { label: 'Compact view', type: 'checkbox', checked: compact, click: (item) => setSetting('compact', item.checked) },
    {
      label: 'Refresh every',
      submenu: REFRESH_INTERVALS_SEC.map((sec) => ({
        label: intervalLabel(sec),
        type: 'radio',
        checked: intervalSec === sec,
        click: () => setSetting('intervalSec', sec),
      })),
    },
    ...(loginItemSupported
      ? [{
          label: 'Start at login',
          type: 'checkbox',
          checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
          click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
        }]
      : []),
    { label: 'Reset position', click: resetPosition },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
}

function updateTrayTooltip() {
  if (!tray) return;
  if (lastError && !lastSnapshot) return tray.setToolTip(`cswap UI: ${lastError}`);
  const { usable, total } = summarize(lastSnapshot?.accounts);
  tray.setToolTip(`cswap UI: ${usable} of ${total} accounts available`);
}

function createTray() {
  tray = new Tray(createTrayIcon(nativeImage));
  tray.setToolTip('cswap UI');
  tray.setContextMenu(buildMenu());
  tray.on('click', toggleVisible);
}

// ---------------------------------------------------------------------------
// IPC. Every message must come from our own window and page.

function isTrusted(event) {
  return win != null && event.sender === win.webContents && event.senderFrame?.url === RENDERER_URL;
}

function registerIpc() {
  ipcMain.handle('settings:get', (event) => (isTrusted(event) ? viewSettings() : null));
  ipcMain.handle('usage:refresh', async (event) => {
    if (isTrusted(event)) await refresh();
  });

  ipcMain.on('renderer:ready', async (event) => {
    if (!isTrusted(event)) return;
    publishUsage(inflight != null);
    await refresh();
    if (snapshotPath) await captureSnapshotAndExit();
  });
  ipcMain.on('settings:toggle', (event, key) => {
    if (isTrusted(event) && (key === 'pinned' || key === 'compact')) setSetting(key, !settings.data[key]);
  });
  ipcMain.on('window:resize', (event, height) => {
    if (!isTrusted(event) || typeof height !== 'number' || !Number.isFinite(height)) return;
    const { workArea } = screen.getDisplayMatching(win.getBounds());
    const target = Math.round(Math.min(Math.max(height, MIN_HEIGHT), workArea.height - SCREEN_MARGIN));
    if (win.getContentSize()[1] !== target) win.setContentSize(WINDOW_WIDTH, target);
  });
  ipcMain.on('window:hide', (event) => {
    if (isTrusted(event)) win.hide();
  });
  ipcMain.on('menu:open', (event) => {
    if (isTrusted(event)) buildMenu().popup({ window: win });
  });
}

async function captureSnapshotAndExit() {
  await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_SETTLE_MS));
  const image = await win.webContents.capturePage();
  await writeFile(snapshotPath, image.toPNG());
  app.exit(0);
}

// ---------------------------------------------------------------------------
// Hardening: this app never needs to navigate, open windows or use permissions.

function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

function denyPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

// ---------------------------------------------------------------------------
// Lifecycle

async function start() {
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  await settings.load();
  if (snapshotPath) settings.update({ compact: cli.compact });
  source = cli.demo ? new DemoSource() : new CswapSource();

  denyPermissions();
  registerIpc();
  if (!snapshotPath) {
    createTray();
    powerMonitor.on('resume', () => {
      if (win?.isVisible()) void refresh();
    });
    screen.on('display-removed', () => {
      if (!win) return;
      const [x, y] = win.getPosition();
      if (!isOnScreen(x, y)) resetPosition();
    });
  }
  createWindow();
}

if (snapshotPath) {
  // Keep snapshot runs away from the real profile (settings, caches, lock).
  app.setPath('userData', path.join(os.tmpdir(), 'cswap-ui-snapshot'));
}

app.enableSandbox();
hardenWebContents();

if (!snapshotPath && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.exilestudios.cswap-ui');
  app.on('second-instance', bringToFront);
  // The tray keeps the app alive with no window open.
  app.on('window-all-closed', () => {});

  let settingsFlushed = false;
  app.on('before-quit', (event) => {
    if (settingsFlushed || !settings) return;
    event.preventDefault();
    void settings.flush().finally(() => {
      settingsFlushed = true;
      app.quit();
    });
  });

  app.whenReady().then(start, (error) => {
    console.error('cswap-ui failed to start:', error);
    app.exit(1);
  });
}
