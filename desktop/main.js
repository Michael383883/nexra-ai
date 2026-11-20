const { app, BrowserWindow, ipcMain } = require('electron');

const { createMainWindow } = require('./window');

const {
  registerProjectIpc,
  closeProject
} = require('../src/modules/project-manager/projectService');

const {
  registerAiIpc
} = require('../src/modules/ai-manager/assistantService');

const {
  registerConversationIpc
} = require('../src/modules/history-manager/conversationService');

// Ventana principal
let mainWindow = null;

// Crea la ventana y limpia la referencia cuando se cierra
function openMainWindow() {
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

// Registrar los canales IPC
registerProjectIpc(ipcMain, () => mainWindow);                       // Fase 2: proyectos
const ai = registerAiIpc(ipcMain);                                   // Fase 3.1: asistentes IA
registerConversationIpc(ipcMain, { getAiService: ai.getService });   // Fase 3.2: mensajes y respuestas

// Crear ventana cuando Electron esté listo
app.whenReady().then(() => {
  openMainWindow();

  // Reactivar aplicación en macOS
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });
});

// Detener el vigilante de archivos antes de salir
app.on('before-quit', () => {
  closeProject().catch(() => { });
});

// Cerrar aplicación cuando todas las ventanas estén cerradas
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});