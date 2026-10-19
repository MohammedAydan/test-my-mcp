import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface MotionForgeAPI {
  engineUrl: string;
  getEngineUrl: () => Promise<string>;
  getOsInfo: () => Promise<{ platform: string; arch: string; version: string }>;
  saveProjectFile: (opts?: { defaultPath?: string; content?: string }) => Promise<{ canceled: boolean; filePath?: string }>;
  openProjectFile: () => Promise<{ canceled: boolean; filePath?: string; content?: string }>;
  showInFolder: (filePath: string) => Promise<boolean>;
  onMenuAction: (callback: (action: string) => void) => () => void;
  getFrameBounds: (sceneId: string, frameIndex: number) => Promise<Record<string, unknown>>;
  setDirty: (dirty: boolean) => void;
}

const api: MotionForgeAPI = {
  engineUrl: ipcRenderer.sendSync('motionforge:get-engine-url-sync'),
  getEngineUrl: () => ipcRenderer.invoke('motionforge:get-engine-url'),
  getOsInfo: () => ipcRenderer.invoke('motionforge:get-os-info'),
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
