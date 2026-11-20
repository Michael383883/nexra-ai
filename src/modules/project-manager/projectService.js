'use strict';

/**
 * projectService.js  (proceso principal de Electron)
 * Tareas: 2.1.1 (selector de carpetas), 2.1.8 (proyectos recientes),
 *         2.1.9 (actualización del explorador) y orquestación del módulo.
 *
 * Uso en electron/main.js:
 *   const { registerProjectIpc } = require('../src/modules/project-manager/projectService');
 *   registerProjectIpc(ipcMain, () => mainWindow);
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { createIgnoreMatcher } = require('./ignoreRules');
const { listDirectory, scanTree, watchProject } = require('./fileScanner');
const { readFile, isInsideRoot } = require('./fileReader');
const { analyzeProject } = require('./projectAnalyzer');
const { buildContext } = require('./contextBuilder');

const MAX_RECENT = 10;

// ───────────────────────── Estado del proyecto activo ─────────────────────────
const state = {
    rootPath: null,
    name: null,
    matcher: null,
    tree: null,
    analysis: null,
    watcher: null,
};

// ───────────────────────── Proyectos recientes (2.1.8) ─────────────────────────
function recentFilePath() {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'recent-projects.json');
}

async function loadRecent() {
    try {
        const raw = await fsp.readFile(recentFilePath(), 'utf8');
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch (_) {
        return [];
    }
}

async function saveRecent(list) {
    const file = recentFilePath();
    const tmp = `${file}.tmp`;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
    await fsp.rename(tmp, file); // escritura atómica
}

async function addRecent(rootPath) {
    const list = (await loadRecent()).filter((p) => p.path !== rootPath);
    list.unshift({ path: rootPath, name: path.basename(rootPath), lastOpened: Date.now() });
    await saveRecent(list.slice(0, MAX_RECENT));
}

/** Devuelve los recientes que todavía existen en disco. */
async function getRecentProjects() {
    const list = await loadRecent();
    const alive = list.filter((p) => fs.existsSync(p.path));
    if (alive.length !== list.length) await saveRecent(alive);
    return alive;
}

async function removeRecent(rootPath) {
    const list = (await loadRecent()).filter((p) => p.path !== rootPath);
    await saveRecent(list);
    return list;
}

async function clearRecent() {
    await saveRecent([]);
    return [];
}

// ───────────────────────── Selector de carpetas (2.1.1) ─────────────────────────
async function selectProjectFolder(win) {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(win || undefined, {
        title: 'Selecciona la carpeta de tu proyecto',
        properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
}

// ───────────────────────── Ciclo de vida del proyecto ─────────────────────────
async function closeProject() {
    if (state.watcher) {
        await state.watcher.close().catch(() => { });
    }
    state.rootPath = null;
    state.name = null;
    state.matcher = null;
    state.tree = null;
    state.analysis = null;
    state.watcher = null;
}

/**
 * Abre un proyecto: escanea, analiza, lo guarda en recientes y activa el watcher.
 * @param {string} rootPath
 * @param {(changes: object) => void} [onChange]  Se llama cuando cambian archivos.
 */
async function openProject(rootPath, onChange) {
    const resolved = path.resolve(rootPath);
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat || !stat.isDirectory()) {
        throw new Error('La ruta no existe o no es una carpeta.');
    }

    await closeProject();

    const matcher = createIgnoreMatcher(resolved);
    const { tree, truncated, totalEntries } = await scanTree(resolved, { matcher });
    const analysis = await analyzeProject(resolved, tree);

    state.rootPath = resolved;
    state.name = analysis.name;
    state.matcher = matcher;
    state.tree = tree;
    state.analysis = analysis;

    await addRecent(resolved).catch((err) => console.error('[DevPilot] No se pudo guardar recientes:', err.message));

    if (onChange) {
        try {
            state.watcher = watchProject(resolved, matcher, async (changes) => {
                // Si cambió la estructura, refresca el árbol para mantener el estado coherente
                if (changes.added.length || changes.removed.length) {
                    await refreshProject().catch(() => { });
                }
                onChange(changes);
            });
        } catch (err) {
            console.error('[DevPilot]', err.message);
        }
    }

    return { rootPath: resolved, name: analysis.name, tree, analysis, truncated, totalEntries };
}

/** Re-escanea el proyecto actual (botón "actualizar" o tras cambios). */
async function refreshProject() {
    requireProject();
    state.matcher.reload(); // por si cambió el .gitignore
    const { tree, truncated, totalEntries } = await scanTree(state.rootPath, { matcher: state.matcher });
    state.tree = tree;
    state.analysis = await analyzeProject(state.rootPath, tree);
    return { rootPath: state.rootPath, name: state.name, tree, analysis: state.analysis, truncated, totalEntries };
}

function requireProject() {
    if (!state.rootPath) throw new Error('No hay ningún proyecto abierto.');
}

// ───────────────────────── Operaciones del explorador ─────────────────────────
/** Carga los hijos de una carpeta (expandir). */
async function getDirectory(dirPath) {
    requireProject();
    if (!isInsideRoot(state.rootPath, dirPath)) throw new Error('Carpeta fuera del proyecto.');
    return listDirectory(path.resolve(dirPath), { rootPath: state.rootPath, matcher: state.matcher });
}

async function readProjectFile(filePath, options = {}) {
    requireProject();
    return readFile(filePath, {
        projectRoot: state.rootPath,
        allowSensitive: options.allowSensitive === true, // solo con autorización explícita del usuario
        redact: options.redact !== false,
        maxBytes: options.maxBytes,
    });
}

async function buildProjectContext(selectedFiles, options = {}) {
    requireProject();
    return buildContext({
        rootPath: state.rootPath,
        tree: state.tree,
        analysis: state.analysis,
        selectedFiles,
        options,
    });
}

function getCurrentProject() {
    if (!state.rootPath) return null;
    return { rootPath: state.rootPath, name: state.name, tree: state.tree, analysis: state.analysis };
}

// ───────────────────────── IPC ─────────────────────────
function registerProjectIpc(ipcMain, getWindow) {
    const handle = (channel, fn) => {
        ipcMain.handle(channel, async (_event, ...args) => {
            try {
                return { ok: true, data: await fn(...args) };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
    };

    const notifyChange = (changes) => {
        const win = getWindow && getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('project:changed', changes);
    };

    handle('project:select-folder', async () => {
        const folder = await selectProjectFolder(getWindow && getWindow());
        if (!folder) return null;
        return openProject(folder, notifyChange);
    });
    handle('project:open', (rootPath) => openProject(rootPath, notifyChange));
    handle('project:close', () => closeProject());
    handle('project:refresh', () => refreshProject());
    handle('project:current', () => getCurrentProject());
    handle('project:list-dir', (dirPath) => getDirectory(dirPath));
    handle('project:read-file', (filePath, options) => readProjectFile(filePath, options));
    handle('project:build-context', (selectedFiles, options) => buildProjectContext(selectedFiles, options));
    handle('project:recent', () => getRecentProjects());
    handle('project:remove-recent', (rootPath) => removeRecent(rootPath));
    handle('project:clear-recent', () => clearRecent());
}

module.exports = {
    selectProjectFolder,
    openProject,
    closeProject,
    refreshProject,
    getDirectory,
    readProjectFile,
    buildProjectContext,
    getCurrentProject,
    getRecentProjects,
    removeRecent,
    clearRecent,
    registerProjectIpc,
};