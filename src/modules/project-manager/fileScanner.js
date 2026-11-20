'use strict';

/**
 * fileScanner.js
 * Tareas: 2.1.2 (explorador), 2.1.3 (árbol expandir/contraer),
 *         2.1.5 (extensiones), 2.1.6 (filtros) y 2.1.9 (detección de cambios).
 *
 * Requiere:  npm install chokidar@3
 */

const fsp = require('fs/promises');
const path = require('path');
const { toPosix, isSensitiveFile } = require('./ignoreRules');
const { getFileType } = require('./fileReader');

function sortNodes(nodes) {
    return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1; // carpetas primero
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    });
}

/**
 * Lista UN nivel de un directorio (ideal para expandir/contraer con carga perezosa).
 * Las carpetas devuelven `children: null` (aún no cargadas).
 */
async function listDirectory(dirPath, { rootPath, matcher }) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const nodes = [];

    await Promise.all(
        entries.map(async (entry) => {
            const isDir = entry.isDirectory();
            if (!isDir && !entry.isFile()) return; // ignora symlinks y especiales (evita ciclos)

            const fullPath = path.join(dirPath, entry.name);
            const relativePath = toPosix(path.relative(rootPath, fullPath));
            if (matcher.shouldIgnore(relativePath, isDir)) return;

            if (isDir) {
                nodes.push({
                    name: entry.name,
                    path: fullPath,
                    relativePath,
                    type: 'directory',
                    children: null,
                });
                return;
            }

            try {
                const stat = await fsp.stat(fullPath);
                const info = getFileType(entry.name);
                const sensitive = isSensitiveFile(entry.name);
                nodes.push({
                    name: entry.name,
                    path: fullPath,
                    relativePath,
                    type: 'file',
                    extension: info.extension,
                    language: info.language,
                    kind: info.kind,
                    size: stat.size,
                    modified: stat.mtimeMs,
                    sensitive,
                    readable: !sensitive && info.kind !== 'binary' && info.kind !== 'image',
                });
            } catch (_) {
                /* archivo desapareció durante el escaneo */
            }
        })
    );

    return sortNodes(nodes);
}

/**
 * Escanea el proyecto completo en forma de árbol, con límites de seguridad.
 */
async function scanTree(rootPath, { matcher, maxDepth = 10, maxEntries = 20000 } = {}) {
    const state = { count: 0, truncated: false };

    const root = {
        name: path.basename(rootPath),
        path: rootPath,
        relativePath: '',
        type: 'directory',
        children: [],
    };

    async function walk(node, depth) {
        if (depth >= maxDepth) {
            node.children = null; // se podrá cargar luego con listDirectory
            state.truncated = true;
            return;
        }
        node.children = [];
        const children = await listDirectory(node.path, { rootPath, matcher });
        for (const child of children) {
            if (state.count >= maxEntries) {
                state.truncated = true;
                break;
            }
            state.count += 1;
            node.children.push(child);
            if (child.type === 'directory') await walk(child, depth + 1);
        }
    }

    await walk(root, 0);
    return { tree: root, truncated: state.truncated, totalEntries: state.count };
}

/** Devuelve todos los archivos del árbol como lista plana. */
function flattenFiles(node, acc = []) {
    if (!node) return acc;
    if (node.type === 'file') {
        acc.push(node);
    } else if (node.children) {
        for (const child of node.children) flattenFiles(child, acc);
    }
    return acc;
}

/** Cuenta carpetas del árbol. */
function countDirectories(node) {
    if (!node || node.type !== 'directory') return 0;
    let total = node.relativePath ? 1 : 0;
    for (const child of node.children || []) total += countDirectories(child);
    return total;
}

/**
 * Vigila el proyecto y notifica archivos nuevos, eliminados o modificados.
 * Agrupa los eventos (debounce) para no saturar la interfaz.
 *
 * @returns {{close: () => Promise<void>}}
 */
function watchProject(rootPath, matcher, onChange, { debounceMs = 400 } = {}) {
    let chokidar;
    try {
        chokidar = require('chokidar');
    } catch (_) {
        throw new Error('Falta la dependencia "chokidar". Ejecuta: npm install chokidar@3');
    }

    const pending = { added: new Map(), removed: new Map(), modified: new Map() };
    let timer = null;

    function flush() {
        timer = null;
        const payload = {
            added: [...pending.added.values()],
            removed: [...pending.removed.values()],
            modified: [...pending.modified.values()],
        };
        pending.added.clear();
        pending.removed.clear();
        pending.modified.clear();
        if (payload.added.length || payload.removed.length || payload.modified.length) {
            onChange(payload);
        }
    }

    function record(kind, fullPath, isDir) {
        const relativePath = toPosix(path.relative(rootPath, fullPath));
        if (!relativePath || matcher.shouldIgnore(relativePath, isDir)) return;

        const item = { path: fullPath, relativePath, type: isDir ? 'directory' : 'file' };

        if (kind === 'removed' && pending.added.has(fullPath)) {
            pending.added.delete(fullPath); // se creó y se borró dentro de la misma ventana
        } else if (kind === 'modified' && pending.added.has(fullPath)) {
            // sigue siendo "nuevo"
        } else {
            pending[kind].set(fullPath, item);
        }

        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
    }

    const watcher = chokidar.watch(rootPath, {
        ignoreInitial: true,
        persistent: true,
        followSymlinks: false,
        depth: 12,
        ignored: (p, stats) => {
            const rel = toPosix(path.relative(rootPath, p));
            if (!rel) return false;
            const segments = rel.split('/');
            for (let i = 0; i < segments.length - 1; i++) {
                if (matcher.shouldIgnore(segments.slice(0, i + 1).join('/'), true)) return true;
            }
            if (stats) return matcher.shouldIgnore(rel, stats.isDirectory());
            // Sin información de tipo: si no tiene extensión, se trata como carpeta
            return !path.extname(rel) && matcher.shouldIgnore(rel, true);
        },
    });

    watcher
        .on('add', (p) => record('added', p, false))
        .on('addDir', (p) => record('added', p, true))
        .on('unlink', (p) => record('removed', p, false))
        .on('unlinkDir', (p) => record('removed', p, true))
        .on('change', (p) => record('modified', p, false))
        .on('error', (err) => console.error('[DevPilot] Error del watcher:', err.message));

    return {
        async close() {
            if (timer) clearTimeout(timer);
            await watcher.close();
        },
    };
}

module.exports = {
    listDirectory,
    scanTree,
    flattenFiles,
    countDirectories,
    watchProject,
};