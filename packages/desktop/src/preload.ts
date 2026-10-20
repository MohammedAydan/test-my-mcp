import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface MotionForgeWindowAPI {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<{ isMaximized: boolean }>;
  isMaximized: () => Promise<{ isMaximized: boolean }>;
  close: () => Promise<void>;
  isFullScreen: () => Promise<{ isFullScreen: boolean }>;
  onMaximizedChanged: (callback: (state: { isMaximized: boolean }) => void) => () => void;
}

export interface MotionForgeAPI {
  engineUrl: string;
  getEngineUrl: () => Promise<string>;
  getOsInfo: () => Promise<{ platform: string; arch: string; version: string }>;
  getRuntimeInfo: () => Promise<{ root: string | null; indexPath: string | null; verified: boolean }>;
  saveProjectFile: (opts?: { defaultPath?: string; content?: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  openProjectFile: () => Promise<{ canceled: boolean; filePath?: string; content?: string }>;
  showInFolder: (filePath: string) => Promise<boolean>;
  onMenuAction: (callback: (action: string) => void) => () => void;
  getFrameBounds: (sceneId: string, frameIndex: number) => Promise<Record<string, unknown>>;
  setDirty: (dirty: boolean) => void;
  /** the frameless window controls (the Studio draws its own chrome) */
  window: MotionForgeWindowAPI;
}

const api: MotionForgeAPI = {
  engineUrl: ipcRenderer.sendSync('motionforge:get-engine-url-sync'),
  getEngineUrl: () => ipcRenderer.invoke('motionforge:get-engine-url'),
  getOsInfo: () => ipcRenderer.invoke('motionforge:get-os-info'),
  getRuntimeInfo: () => ipcRenderer.invoke('motionforge:get-runtime-info'),
  saveProjectFile: (opts) => ipcRenderer.invoke('motionforge:save-project-file', opts),
  openProjectFile: () => ipcRenderer.invoke('motionforge:open-project-file'),
  showInFolder: (filePath) => ipcRenderer.invoke('motionforge:show-in-folder', filePath),
  onMenuAction: (callback) => {
    const handler = (_event: IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('motionforge:menu-action', handler);
    return () => ipcRenderer.removeListener('motionforge:menu-action', handler);
  },
  getFrameBounds: (sceneId: string, frameIndex: number) =>
    ipcRenderer.invoke('motionforge:get-frame-bounds', { sceneId, frameIndex }),
  setDirty: (dirty: boolean) => ipcRenderer.send('motionforge:set-dirty', dirty),
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    close: () => ipcRenderer.invoke('window:close'),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    onMaximizedChanged: (callback) => {
      const handler = (_event: IpcRendererEvent, state: { isMaximized: boolean }) => callback(state);
      ipcRenderer.on('window:MaximizedChanged', handler);
      return () => ipcRenderer.removeListener('window:MaximizedChanged', handler);
    },
  },
};

export interface MotionForgeEngineBridge {
  invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
  onEvent: (callback: (event: { eventName: string; payload: unknown }) => void) => () => void;
}

const engineBridge: MotionForgeEngineBridge = {
  invoke: (method: string, ...args: unknown[]) => {
    return ipcRenderer.invoke('engine:invoke', method, ...args);
  },
  onEvent: (callback) => {
    const handler = (_event: IpcRendererEvent, data: { eventName: string; payload: unknown }) => {
      callback(data);
    };
    ipcRenderer.on('engine:event', handler);
    return () => ipcRenderer.removeListener('engine:event', handler);
  },
};

contextBridge.exposeInMainWorld('motionforge', api);
contextBridge.exposeInMainWorld('motionforgeEngine', engineBridge);

declare global {
  interface Window {
    motionforge?: MotionForgeAPI;
    motionforgeEngine?: MotionForgeEngineBridge;
  }
}
