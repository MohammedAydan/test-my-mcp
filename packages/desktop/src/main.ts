import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let previewWindow: BrowserWindow | null = null;
let engineProcess: ChildProcess | null = null;
let enginePort = 4000;
let engineUrl = 'http://127.0.0.1:4000';
let activeProjectPath: string | null = null;
let isDirty = false;
let isQuitting = false;
let recentProjects: string[] = [];

// Whitelist directories for security
const RECENT_FILE = path.join(os.homedir(), '.motionforge', 'recent.json');

function loadRecentProjects(): void {
  try {
    if (existsSync(RECENT_FILE)) {
      const data = JSON.parse(readFileSync(RECENT_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        recentProjects = data.slice(0, 10);
      }
    }
  } catch {
    recentProjects = [];
  }
}

function saveRecentProjects(): void {
  try {
    const dir = path.dirname(RECENT_FILE);
    if (!existsSync(dir)) {
      import('node:fs').then((fs) => fs.mkdirSync(dir, { recursive: true }));
    }
    writeFileSync(RECENT_FILE, JSON.stringify(recentProjects, null, 2), 'utf-8');
  } catch {}
}

function addRecentProject(p: string): void {
  recentProjects = [p, ...recentProjects.filter((x) => x !== p)].slice(0, 10);
  saveRecentProjects();
  buildAppMenu();
}

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to obtain server address')));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForEngine(url: string, timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/capabilities`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function spawnCoreEngine(): Promise<void> {
  // If explicitly overridden via env var, use it
  if (process.env.MOTIONFORGE_ENGINE_URL) {
    engineUrl = process.env.MOTIONFORGE_ENGINE_URL.replace(/\/$/, '');
    console.log(`[desktop] Using external MOTIONFORGE_ENGINE_URL: ${engineUrl}`);
    return;
  }

  // Check if port 4000 is already active and healthy in development
  try {
    const res = await fetch('http://127.0.0.1:4000/api/capabilities');
    if (res.ok) {
      engineUrl = 'http://127.0.0.1:4000';
      enginePort = 4000;
      console.log('[desktop] Reusing already running core-engine at port 4000');
      return;
    }
  } catch {}

  enginePort = await findFreePort();
  engineUrl = `http://127.0.0.1:${enginePort}`;
  console.log(`[desktop] Spawning core-engine on dynamic port: ${enginePort}`);

  const engineRoot = path.resolve(__dirname, '../../../packages/core-engine');
  const engineMain = path.resolve(engineRoot, 'src/main.ts');

  if (existsSync(engineMain)) {
    // Development mode
    engineProcess = spawn('node', ['--import', 'tsx', engineMain], {
      cwd: engineRoot,
      env: { ...process.env, PORT: String(enginePort) },
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
  } else {
    // Packaged mode fallback: import entry or packaged bundle
    const bundledEntry = path.resolve(__dirname, '../engine/main.js');
    if (existsSync(bundledEntry)) {
      engineProcess = spawn(process.execPath, [bundledEntry], {
        env: { ...process.env, PORT: String(enginePort), ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'pipe',
      });
    }
  }

  if (engineProcess) {
    engineProcess.stdout?.on('data', (d) => console.log(`[engine:stdout] ${d.toString().trim()}`));
    engineProcess.stderr?.on('data', (d) => console.error(`[engine:stderr] ${d.toString().trim()}`));
    engineProcess.on('exit', (code) => {
      console.log(`[desktop] core-engine exited with code ${code}`);
    });
  }

  const ready = await waitForEngine(engineUrl);
  if (!ready) {
    console.error(`[desktop] Timeout waiting for core-engine on ${engineUrl}`);
  } else {
    console.log(`[desktop] core-engine is ready on ${engineUrl}`);
  }
}

function updateWindowTitle(): void {
  if (!mainWindow) return;
  const name = activeProjectPath ? path.basename(activeProjectPath) : 'Untitled Project';
  const dirtyMarker = isDirty ? ' •' : '';
  mainWindow.setTitle(`${name}${dirtyMarker} — MotionForge`);
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const recentMenuItems: MenuItemConstructorOptions[] = recentProjects.length > 0
    ? recentProjects.map((p) => ({
        label: path.basename(p),
        sublabel: p,
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              const content = readFileSync(p, 'utf-8');
              activeProjectPath = p;
              isDirty = false;
              updateWindowTitle();
              mainWindow.webContents.send('motionforge:menu-action', 'open-project-content', { path: p, content });
            } catch (err) {
              dialog.showErrorBox('Failed to open recent project', String(err));
            }
          }
        },
      }))
    : [{ label: 'No Recent Projects', enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            activeProjectPath = null;
            isDirty = false;
            updateWindowTitle();
            mainWindow?.webContents.send('motionforge:menu-action', 'new-project');
          },
        },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!mainWindow) return;
            const res = await dialog.showOpenDialog(mainWindow, {
              title: 'Open MotionForge Project',
              properties: ['openFile'],
              filters: [{ name: 'MotionForge Project', extensions: ['mfproj', 'json'] }],
            });
            if (!res.canceled && res.filePaths[0]) {
              const p = res.filePaths[0];
              try {
                const content = readFileSync(p, 'utf-8');
                activeProjectPath = p;
                isDirty = false;
                addRecentProject(p);
                updateWindowTitle();
                mainWindow.webContents.send('motionforge:menu-action', 'open-project-content', { path: p, content });
              } catch (err) {
                dialog.showErrorBox('Failed to open file', String(err));
              }
            }
          },
        },
        {
          label: 'Recent Projects',
          submenu: recentMenuItems,
        },
        { type: 'separator' },
        {
          label: 'Save Project',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow?.webContents.send('motionforge:menu-action', 'save-project');
          },
        },
        {
          label: 'Save Project As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            mainWindow?.webContents.send('motionforge:menu-action', 'save-project-as');
          },
        },
        { type: 'separator' },
        {
          label: 'New Preview Window',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => openPreviewWindow(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Reset Layout',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'reset-layout'),
        },
        {
          label: 'Fit Canvas to Window',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'canvas-fit'),
        },
        {
          label: 'Actual Size (100%)',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'canvas-actual-size'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Render',
      submenu: [
        {
          label: 'Render Draft (30fps 720p)',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'render-draft'),
        },
        {
          label: 'Render Production (60fps 1080p)',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'render-production'),
        },
        {
          label: 'Open Render Queue',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'open-queue'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: '?',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'open-shortcuts'),
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('motionforge:menu-action', 'open-command-palette'),
        },
        { type: 'separator' },
        {
          label: 'MotionForge Documentation',
          click: () => shell.openExternal('https://github.com/motionforge/motionforge'),
        },
        {
          label: 'About MotionForge',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About MotionForge',
              message: 'MotionForge Professional Motion Graphics Studio',
              detail: `Desktop Shell: Electron ${process.versions.electron}\nNode: ${process.versions.node}\nChromium: ${process.versions.chrome}\nEngine: ${engineUrl}`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function openPreviewWindow(sceneId?: string): void {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.focus();
    return;
  }

  previewWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'MotionForge — Live Preview',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = sceneId
    ? `${engineUrl}/preview/?scene=${encodeURIComponent(sceneId)}`
    : `${engineUrl}/preview/`;

  previewWindow.loadURL(targetUrl);
  previewWindow.on('closed', () => {
    previewWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.on('motionforge:get-engine-url-sync', (event) => {
    event.returnValue = engineUrl;
  });

  ipcMain.handle('motionforge:get-engine-url', () => {
    return engineUrl;
  });

  ipcMain.handle('motionforge:get-os-info', () => {
    return {
      platform: os.platform(),
      arch: os.arch(),
      version: os.release(),
    };
  });

  const saveOptsSchema = z
    .object({
      defaultPath: z.string().optional(),
      content: z.string().optional(),
    })
    .optional();

  ipcMain.handle('motionforge:save-project-file', async (_event, rawOpts) => {
    const opts = saveOptsSchema.parse(rawOpts) || {};
    if (!mainWindow) return { canceled: true };

    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save MotionForge Project',
      defaultPath: opts.defaultPath || activeProjectPath || 'project.mfproj',
      filters: [{ name: 'MotionForge Project', extensions: ['mfproj', 'json'] }],
    });

    if (!res.canceled && res.filePath) {
      if (opts.content) {
        writeFileSync(res.filePath, opts.content, 'utf-8');
      }
      activeProjectPath = res.filePath;
      isDirty = false;
      addRecentProject(res.filePath);
      updateWindowTitle();
      return { canceled: false, filePath: res.filePath };
    }
    return { canceled: true };
  });

  ipcMain.handle('motionforge:open-project-file', async () => {
    if (!mainWindow) return { canceled: true };

    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open MotionForge Project',
      properties: ['openFile'],
      filters: [{ name: 'MotionForge Project', extensions: ['mfproj', 'json'] }],
    });

    if (!res.canceled && res.filePaths[0]) {
      const p = res.filePaths[0];
      const content = readFileSync(p, 'utf-8');
      activeProjectPath = p;
      isDirty = false;
      addRecentProject(p);
      updateWindowTitle();
      return { canceled: false, filePath: p, content };
    }
    return { canceled: true };
  });

  ipcMain.handle('motionforge:show-in-folder', (_event, filePath: string) => {
    if (typeof filePath === 'string' && existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    }
    return false;
  });

  ipcMain.handle('motionforge:get-frame-bounds', async (_event, args: { sceneId: string; frameIndex: number }) => {
    try {
      const res = await fetch(`${engineUrl}/api/scenes/${args.sceneId}/frame/${args.frameIndex}/bounds`);
      if (res.ok) {
        return await res.json();
      }
      return {};
    } catch {
      return {};
    }
  });

  ipcMain.on('motionforge:set-dirty', (_event, dirtyState: boolean) => {
    isDirty = Boolean(dirtyState);
    updateWindowTitle();
  });
}

async function createMainWindow(): Promise<void> {
  const preloadPath = existsSync(path.join(__dirname, '../preload/index.cjs'))
    ? path.join(__dirname, '../preload/index.cjs')
    : existsSync(path.join(__dirname, '../preload/index.mjs'))
    ? path.join(__dirname, '../preload/index.mjs')
    : path.join(__dirname, '../preload/index.js');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'MotionForge',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  updateWindowTitle();
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  mainWindow.on('close', (e) => {
    if (isDirty && !isQuitting && !process.env.MOTIONFORGE_TEST_MODE) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes in your project. Do you want to save before quitting?',
      });

      if (choice === 0) {
        e.preventDefault();
        mainWindow?.webContents.send('motionforge:menu-action', 'save-project');
      } else if (choice === 2) {
        e.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    console.log(`[desktop] Loading ELECTRON_RENDERER_URL: ${process.env.ELECTRON_RENDERER_URL}`);
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const packagedHtml = path.resolve(__dirname, '../renderer/index.html');
    const studioDistHtml = path.resolve(__dirname, '../../studio/dist/index.html');
    const localHtml = path.resolve(__dirname, '../../../frontend/index.html');
    if (existsSync(packagedHtml)) {
      await mainWindow.loadFile(packagedHtml);
    } else if (existsSync(studioDistHtml)) {
      await mainWindow.loadFile(studioDistHtml);
    } else if (existsSync(localHtml)) {
      await mainWindow.loadFile(localHtml);
    }
  }
}

app.whenReady().then(async () => {
  loadRecentProjects();
  registerIpcHandlers();
  buildAppMenu();
  await spawnCoreEngine();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

function terminateEngine(): void {
  if (engineProcess && !engineProcess.killed) {
    console.log('[desktop] Terminating core-engine child process');
    try {
      if (process.platform === 'win32' && engineProcess.pid) {
        spawn('taskkill', ['/pid', String(engineProcess.pid), '/f', '/t']);
      } else {
        engineProcess.kill('SIGKILL');
      }
    } catch {}
    engineProcess = null;
  }
}

app.on('before-quit', () => {
  isQuitting = true;
  terminateEngine();
});

app.on('window-all-closed', () => {
  terminateEngine();
  app.quit();
});
