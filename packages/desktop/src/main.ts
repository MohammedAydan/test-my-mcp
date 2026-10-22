import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, net as electronNet, protocol, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createEngineCore, EngineCore } from '@motionforge/core-engine';
import {
  resolveRuntimeRequest,
  resolveRuntimeRoot,
  resolveVaultRequest,
} from './protocol-paths.js';

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mf-vault',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'mf-runtime',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let previewWindow: BrowserWindow | null = null;
let engineCore: EngineCore | null = null;
let engineUrl = 'in-process';
let activeProjectPath: string | null = null;
let isDirty = false;
let isQuitting = false;
let recentProjects: string[] = [];

/**
 * The scene runtime bundle root.
 *
 * Resolved ONCE at startup so a missing bundle is reported immediately,
 * loudly, and with the exact command that fixes it — instead of surfacing
 * later as a 404 inside the preview iframe.
 */
let runtimeRoot: string | null = null;

/**
 * The candidate roots for the scene runtime bundle, most specific first.
 *
 * `__dirname` is `<repo>/packages/desktop/out/main` in development and
 * `<app>/resources/app.asar/out/main` in a packaged build, so the list walks
 * outwards from the executable to the repository layout.
 */
function runtimeRootCandidates(): string[] {
  const candidates: string[] = [];
  const packaged = process.resourcesPath;
  if (packaged) {
    candidates.push(path.join(packaged, 'scene-runtime'));
    candidates.push(path.join(packaged, 'app.asar.unpacked', 'scene-runtime'));
  }
  candidates.push(path.resolve(__dirname, '../../../scene-runtime/dist'));
  candidates.push(path.resolve(__dirname, '../../scene-runtime/dist'));
  candidates.push(path.resolve(__dirname, '../runtime'));
  candidates.push(path.resolve(process.cwd(), 'packages/scene-runtime/dist'));
  return candidates;
}

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

  // The Studio draws its OWN menu bar inside the frameless title bar, so the
  // native application menu is removed entirely. The template is kept only so
  // the platform keeps its standard editing shortcuts (copy/paste inside
  // text fields) available to the renderer.
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(null);
  void menu;
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
    ? `mf-runtime://app/index.html?scene=${encodeURIComponent(sceneId)}`
    : `mf-runtime://app/index.html`;

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

  /**
   * The resolved scene-runtime bundle.
   *
   * The renderer (and the verification harness) needs to know WHICH bundle
   * is being served — a packaged build and a development checkout point at
   * different directories, and a mismatch is the exact failure the startup
   * verification exists to catch.
   */
  ipcMain.handle('motionforge:get-runtime-info', () => {
    return {
      root: runtimeRoot,
      indexPath: runtimeRoot ? path.join(runtimeRoot, 'index.html') : null,
      verified: Boolean(runtimeRoot && existsSync(path.join(runtimeRoot, 'index.html'))),
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
      if (engineCore) {
        return await engineCore.getLayerBounds(args.sceneId, args.frameIndex);
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

  // ---------------------------------------------------------------------------
  // Frameless window controls
  //
  // The Studio owns its own chrome (see `shell/TitleBar.tsx`), so the native
  // title bar is gone and these four channels replace it.
  // ---------------------------------------------------------------------------

  ipcMain.handle('window:minimize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.minimize();
  });

  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { isMaximized: false };
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle('window:isMaximized', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { isMaximized: false };
    return { isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle('window:close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.close();
  });

  ipcMain.handle('window:isFullScreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { isFullScreen: false };
    return { isFullScreen: mainWindow.isFullScreen() };
  });

  const ALLOWED_METHODS = new Set([
    'getCapabilities',
    'getScene',
    'saveScene',
    'deleteScene',
    'listScenes',
    'listAssets',
    'ingestAsset',
    'inspectKeyframes',
    'getLayerBounds',
    'getLayerBoundsAt',
    'analyzeScene',
    'startRender',
    'getRenderStatus',
    'getRenderResult',
  ]);

  ipcMain.handle('engine:invoke', async (_event, method: string, ...args: unknown[]) => {
    if (!ALLOWED_METHODS.has(method)) {
      throw new Error(`Unauthorized IPC call: method "${method}" is not allowlisted.`);
    }
    if (!engineCore) {
      throw new Error('EngineCore is not initialized.');
    }
    const fn = (engineCore as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
    if (typeof fn !== 'function') {
      throw new Error(`Method "${method}" not found on EngineCore.`);
    }
    return await fn.apply(engineCore, args);
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
    // ── Frameless shell ────────────────────────────────────────────────────
    // The Studio draws its own title bar, menu bar and window controls, so the
    // native frame AND the native menu bar are both removed.
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#090a0d',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Keep the custom chrome in sync with the real window state (a double-click
  // on the title bar zooms the window without the renderer knowing).
  const pushMaximizedState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:MaximizedChanged', {
      isMaximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on('maximize', pushMaximizedState);
  mainWindow.on('unmaximize', pushMaximizedState);
  mainWindow.on('restore', pushMaximizedState);
  mainWindow.on('enter-full-screen', pushMaximizedState);
  mainWindow.on('leave-full-screen', pushMaximizedState);
  mainWindow.on('closed', () => {
    mainWindow = null;
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

  if (process.env.ELECTRON_RENDERER_URL) {
    console.log(`[desktop] Loading ELECTRON_RENDERER_URL: ${process.env.ELECTRON_RENDERER_URL}`);
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const packagedHtml = path.resolve(__dirname, '../renderer/index.html');
    const studioDistHtml = path.resolve(__dirname, '../../studio/dist/index.html');
    if (existsSync(packagedHtml)) {
      await mainWindow.loadFile(packagedHtml);
    } else if (existsSync(studioDistHtml)) {
      await mainWindow.loadFile(studioDistHtml);
    } else {
      throw new Error(`Renderer bundle not found at ${packagedHtml} or ${studioDistHtml}. Build @motionforge/studio or @motionforge/desktop first.`);
    }
  }
}

app.whenReady().then(async () => {
  loadRecentProjects();
  registerIpcHandlers();
  buildAppMenu();

  // ── Scene runtime bundle ─────────────────────────────────────────────────
  // Resolved once, up front, so a missing bundle is a startup error with an
  // actionable message instead of a silent 404 inside the preview iframe.
  {
    const { root, tried } = resolveRuntimeRoot(runtimeRootCandidates());
    runtimeRoot = root;
    if (root) {
      const indexPath = path.join(root, 'index.html');
      if (existsSync(indexPath)) {
        console.log(`[desktop] scene-runtime bundle verified: ${indexPath}`);
      } else {
        console.warn(
          `[desktop] scene-runtime root found but index.html is missing: ${root}\n` +
            `         Run "npm run build -w @motionforge/scene-runtime" before launching the desktop shell.`
        );
      }
    } else {
      console.error(
        '[desktop] scene-runtime bundle NOT FOUND. The preview viewport will be empty.\n' +
          '         Tried:\n' +
          tried.map((c) => `           - ${c}`).join('\n') +
          '\n         Fix: npm run build -w @motionforge/scene-runtime'
      );
    }
  }

  protocol.handle('mf-vault', async (request) => {
    try {
      if (!engineCore) {
        return new Response('Engine not initialized', { status: 503 });
      }
      const url = new URL(request.url);
      const resolution = resolveVaultRequest(engineCore.paths.vaultDir, url);
      if (!resolution.filePath) {
        console.warn(`[mf-vault] Refused request ${request.url}: ${resolution.error}`);
        return new Response('Asset path refused', { status: 400 });
      }
      if (!existsSync(resolution.filePath)) {
        return new Response('Asset not found in vault', { status: 404 });
      }
      // `pathToFileURL` is the only correct way to hand a Windows drive-letter
      // path to `net.fetch` — a hand-built `file://D:\...` URL is not a URL.
      return electronNet.fetch(pathToFileURL(resolution.filePath).toString(), {
        headers: request.headers,
      });
    } catch (err) {
      console.error('[mf-vault] Error serving asset:', err);
      return new Response('Asset error', { status: 500 });
    }
  });

  protocol.handle('mf-runtime', async (request) => {
    try {
      if (!runtimeRoot) {
        return new Response(
          'Scene runtime bundle is not built. Run: npm run build -w @motionforge/scene-runtime',
          { status: 503 }
        );
      }
      const url = new URL(request.url);
      const resolution = resolveRuntimeRequest(runtimeRoot, url);
      if (!resolution.filePath) {
        console.warn(`[mf-runtime] Refused request ${request.url}: ${resolution.error}`);
        return new Response('Runtime path refused', { status: 400 });
      }
      if (!existsSync(resolution.filePath)) {
        console.warn(`[mf-runtime] File not found: ${resolution.filePath}`);
        return new Response('Runtime file not found', { status: 404 });
      }
      return electronNet.fetch(pathToFileURL(resolution.filePath).toString());
    } catch (err) {
      console.error('[mf-runtime] Error serving runtime:', err);
      return new Response('Runtime error', { status: 500 });
    }
  });

  try {
    engineCore = await createEngineCore({ enableWatcher: true });
    console.log('[desktop] EngineCore in-process domain logic initialized (monolithic mode)');

    const forwardEvent = (eventName: string, payload: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine:event', { eventName, payload });
      }
    };
    const domainEvents = [
      'render:progress',
      'render:completed',
      'render:failed',
      'scene:updated',
      'scene:deleted',
      'vault:updated',
    ];
    for (const ev of domainEvents) {
      engineCore.on(ev, (payload) => forwardEvent(ev, payload));
    }
  } catch (err) {
    console.error('[desktop] Failed to initialize in-process EngineCore:', err);
  }

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

function terminateEngine(): void {
  if (engineCore) {
    engineCore.dispose().catch(() => undefined);
    engineCore = null;
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
