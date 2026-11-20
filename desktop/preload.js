const { contextBridge, ipcRenderer } = require('electron');

// Información básica de la app (Fase 1)
contextBridge.exposeInMainWorld('nexra', {
  version: '0.1.0',
  platform: process.platform
});

// API de proyectos (Fase 2) — la usa el hook useProject()
contextBridge.exposeInMainWorld('devpilotProject', {
  selectFolder: () => ipcRenderer.invoke('project:select-folder'),
  open: (rootPath) => ipcRenderer.invoke('project:open', rootPath),
  close: () => ipcRenderer.invoke('project:close'),
  refresh: () => ipcRenderer.invoke('project:refresh'),
  current: () => ipcRenderer.invoke('project:current'),
  listDir: (dirPath) => ipcRenderer.invoke('project:list-dir', dirPath),
  readFile: (filePath, options) => ipcRenderer.invoke('project:read-file', filePath, options),
  buildContext: (files, options) => ipcRenderer.invoke('project:build-context', files, options),
  recent: () => ipcRenderer.invoke('project:recent'),
  removeRecent: (rootPath) => ipcRenderer.invoke('project:remove-recent', rootPath),
  clearRecent: () => ipcRenderer.invoke('project:clear-recent'),

  // Cambios en disco (archivos nuevos, eliminados o modificados)
  onChanged: (callback) => {
    const handler = (_event, changes) => callback(changes);
    ipcRenderer.on('project:changed', handler);
    return () => ipcRenderer.removeListener('project:changed', handler);
  }
});

// API de asistentes IA (Fase 3.1) — la usa el hook useAssistants()
contextBridge.exposeInMainWorld('devpilotAI', {
  snapshot: () => ipcRenderer.invoke('ai:snapshot'),

  select: (id) => ipcRenderer.invoke('ai:select', id),
  favorite: (id, value) => ipcRenderer.invoke('ai:favorite', id, value),
  enable: (id, enabled) => ipcRenderer.invoke('ai:enable', id, enabled),
  settings: (id, patch) => ipcRenderer.invoke('ai:settings', id, patch),
  resetSettings: (id) => ipcRenderer.invoke('ai:reset-settings', id),
  open: (id) => ipcRenderer.invoke('ai:open', id),
  markClosed: (id) => ipcRenderer.invoke('ai:mark-closed', id),
  addCustom: (input) => ipcRenderer.invoke('ai:add-custom', input),
  removeCustom: (id) => ipcRenderer.invoke('ai:remove-custom', id),

  sessionCreate: (input) => ipcRenderer.invoke('ai:session-create', input),
  sessionRename: (id, name) => ipcRenderer.invoke('ai:session-rename', id, name),
  sessionNotes: (id, notes) => ipcRenderer.invoke('ai:session-notes', id, notes),
  sessionActivate: (id) => ipcRenderer.invoke('ai:session-activate', id),
  sessionArchive: (id) => ipcRenderer.invoke('ai:session-archive', id),
  sessionRestore: (id) => ipcRenderer.invoke('ai:session-restore', id),
  sessionDelete: (id) => ipcRenderer.invoke('ai:session-delete', id)
});

// API de mensajes y respuestas (Fase 3.2) — la usa el hook useConversation()
contextBridge.exposeInMainWorld('devpilotChat', {
  prepare: (input) => ipcRenderer.invoke('chat:prepare', input),
  send: (input) => ipcRenderer.invoke('chat:send', input),
  copyDraft: (draftId) => ipcRenderer.invoke('chat:copy-draft', draftId),
  readClipboard: () => ipcRenderer.invoke('chat:read-clipboard'),
  recordResponse: (input) => ipcRenderer.invoke('chat:record-response', input),

  conversations: () => ipcRenderer.invoke('chat:conversations'),
  conversation: (id) => ipcRenderer.invoke('chat:conversation', id),
  deleteConversation: (id) => ipcRenderer.invoke('chat:delete-conversation', id),

  readGenerated: (input) => ipcRenderer.invoke('chat:read-generated', input),
  copyGenerated: (input) => ipcRenderer.invoke('chat:copy-generated', input),
  revealGenerated: (input) => ipcRenderer.invoke('chat:reveal-generated', input),

  getSettings: () => ipcRenderer.invoke('chat:get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('chat:set-settings', patch)
});