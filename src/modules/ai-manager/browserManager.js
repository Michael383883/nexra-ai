'use strict';

/**
 * browserManager.js
 * Tarea 3.1.3: abrir el asistente en Chrome.
 *
 * - Detecta Chrome en Windows, macOS y Linux.
 * - Permite un navegador personalizado (Edge, Brave, Chromium...) y un perfil.
 * - Si no hay Chrome, usa el navegador predeterminado del sistema.
 *
 * Seguridad: se ejecuta sin shell, con argumentos en arreglo, solo URLs
 * permitidas, y el navegador personalizado debe parecer un navegador conocido.
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { isAllowedUrl } = require('./assistantCatalog');

const BROWSER_NAME_RE = /(chrome|chromium|msedge|edge|brave|firefox|opera|vivaldi)/i;
const PROFILE_RE = /^[A-Za-z0-9 ._-]{1,60}$/;

function isFile(exists, p) {
    try {
        return exists(p);
    } catch (_) {
        return false;
    }
}

function createBrowserManager({
    platform = process.platform,
    env = process.env,
    exists = fs.existsSync,
    spawn = childProcess.spawn,
    openExternal = null,
} = {}) {
    function chromeCandidates() {
        if (platform === 'win32') {
            return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
                .filter(Boolean)
                .map((base) => path.win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
        }
        if (platform === 'darwin') {
            const app = 'Google Chrome.app/Contents/MacOS/Google Chrome';
            return [path.posix.join('/Applications', app), env.HOME ? path.posix.join(env.HOME, 'Applications', app) : null].filter(Boolean);
        }
        const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
        const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
        const found = [];
        for (const dir of dirs) for (const name of names) found.push(path.posix.join(dir, name));
        found.push('/opt/google/chrome/chrome');
        return found;
    }

    function findChrome() {
        return chromeCandidates().find((candidate) => isFile(exists, candidate)) || null;
    }

    /** Comprueba un navegador personalizado indicado por el usuario. */
    function checkCustomPath(browserPath) {
        if (!browserPath) return { ok: true };
        if (!isFile(exists, browserPath)) {
            return { ok: false, error: 'No se encontró el navegador en la ruta indicada.' };
        }
        const base = path.basename(String(browserPath).replace(/\\/g, '/'));
        if (!BROWSER_NAME_RE.test(base)) {
            return { ok: false, error: 'El archivo no parece un navegador (Chrome, Edge, Brave, Firefox...).' };
        }
        return { ok: true };
    }

    function getBrowserInfo() {
        const chromePath = findChrome();
        return { found: Boolean(chromePath), path: chromePath, platform };
    }

    function launch(command, args) {
        return new Promise((resolve, reject) => {
            let child;
            try {
                child = spawn(command, args, { detached: true, stdio: 'ignore' });
            } catch (err) {
                reject(err);
                return;
            }
            child.once('error', (err) => reject(new Error(`No se pudo abrir el navegador: ${err.message}`)));
            child.once('spawn', () => {
                if (typeof child.unref === 'function') child.unref();
                resolve();
            });
        });
    }

    /**
     * Abre una URL.
     * @param {string} url
     * @param {{browserPath?: string, profile?: string, newWindow?: boolean}} prefs
     * @returns {Promise<{kind: 'chrome'|'custom'|'default', path: string|null}>}
     */
    async function open(url, prefs = {}) {
        if (!isAllowedUrl(url)) throw new Error('URL no permitida.');

        let browserPath = null;
        let kind = 'chrome';

        if (prefs.browserPath) {
            const check = checkCustomPath(prefs.browserPath);
            if (!check.ok) throw new Error(check.error);
            browserPath = prefs.browserPath;
            kind = 'custom';
        } else {
            browserPath = findChrome();
        }

        if (!browserPath) {
            if (!openExternal) throw new Error('No se encontró Chrome en este equipo.');
            await openExternal(url);
            return { kind: 'default', path: null };
        }

        const isFirefox = /firefox/i.test(browserPath);
        const args = [];
        if (isFirefox) {
            if (prefs.newWindow) args.push('-new-window');
        } else {
            if (prefs.profile && PROFILE_RE.test(prefs.profile)) args.push(`--profile-directory=${prefs.profile}`);
            if (prefs.newWindow) args.push('--new-window');
        }
        args.push(url);

        await launch(browserPath, args);
        return { kind, path: browserPath };
    }

    return { findChrome, checkCustomPath, getBrowserInfo, open };
}

module.exports = { createBrowserManager, PROFILE_RE };