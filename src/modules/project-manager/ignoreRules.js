'use strict';

/**
 * ignoreRules.js
 * Tareas: 2.1.6 (filtros de archivos) y 2.1.7 (protección de archivos).
 *
 * - Decide qué carpetas/archivos NO se muestran ni se escanean.
 * - Detecta archivos sensibles (secretos) para no leerlos automáticamente.
 * - Redacta secretos dentro del contenido antes de enviarlo a una IA.
 */

const fs = require('fs');
const path = require('path');

// ───────────────────────── Carpetas ignoradas ─────────────────────────
const IGNORED_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg',
    'dist', 'build', 'out', 'target', 'obj',
    '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
    'coverage', '.nyc_output',
    'vendor',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv', '.tox',
    '.idea', '.vscode',
    '.gradle', '.dart_tool', '.terraform',
]);

// ───────────────────────── Archivos ignorados ─────────────────────────
const IGNORED_FILES = new Set([
    '.DS_Store', 'Thumbs.db', 'desktop.ini',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'composer.lock', 'Pipfile.lock', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock',
]);

const IGNORED_FILE_PATTERNS = [
    /\.log$/i,
    /\.min\.(js|css)$/i,
    /\.map$/i,
    /\.pyc$/i,
    /\.class$/i,
    /\.tmp$/i,
    /\.swp$/i,
];

// ───────────────────────── Binarios ─────────────────────────
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.psd', '.icns',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.mov', '.avi', '.mkv', '.webm',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
    '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.jar', '.war', '.wasm',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.sqlite', '.sqlite3', '.db', '.mdb',
]);

// ───────────────────────── Archivos sensibles ─────────────────────────
const SENSITIVE_NAMES = new Set([
    '.npmrc', '.pypirc', '.netrc', '.htpasswd', '.git-credentials', '.dockercfg',
    'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
    'credentials', 'credentials.json',
    'secrets.json', 'secrets.yml', 'secrets.yaml',
    'service-account.json', 'serviceaccount.json',
    'wp-config.php',
]);

const SENSITIVE_EXTENSIONS = new Set([
    '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.kdbx', '.ppk', '.gpg', '.asc',
]);

const SAFE_ENV_SUFFIXES = ['.example', '.sample', '.template', '.dist', '.defaults'];

function toPosix(p) {
    return String(p).split(path.sep).join('/');
}

function isBinaryExtension(filePath) {
    return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * ¿El archivo puede contener secretos? (.env, llaves privadas, credenciales...)
 * Los archivos .env.example / .env.sample NO se consideran sensibles.
 */
function isSensitiveFile(filePath) {
    const name = path.basename(filePath).toLowerCase();

    if (/^\.env($|\.)/.test(name)) {
        return !SAFE_ENV_SUFFIXES.some((suffix) => name.endsWith(suffix));
    }
    if (SENSITIVE_NAMES.has(name)) return true;
    if (SENSITIVE_EXTENSIONS.has(path.extname(name))) return true;
    if (/(^|[._-])(secret|secrets|private[-_]?key)([._-]|$)/.test(name)) return true;
    return false;
}

// ───────────────────────── Parser de .gitignore ─────────────────────────
function compileGitignoreRule(rawLine) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) return null;

    let negate = false;
    if (line.startsWith('!')) {
        negate = true;
        line = line.slice(1);
    }

    let dirOnly = false;
    if (line.endsWith('/')) {
        dirOnly = true;
        line = line.slice(0, -1);
    }
    if (!line) return null;

    // Si contiene "/" (inicio o medio) queda anclado a la raíz
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);

    let body = '';
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '*') {
            if (line[i + 1] === '*') {
                if (line[i + 2] === '/') {
                    body += '(?:.*/)?';
                    i += 2;
                } else {
                    body += '.*';
                    i += 1;
                }
            } else {
                body += '[^/]*';
            }
        } else if (c === '?') {
            body += '[^/]';
        } else if ('.+^${}()|[]\\'.includes(c)) {
            body += '\\' + c;
        } else {
            body += c;
        }
    }

    const prefix = anchored ? '^' : '(?:^|.*/)';
    const exact = new RegExp(prefix + body + '$');
    const inside = new RegExp(prefix + body + '/.*$');

    return {
        negate,
        test(relPath, isDirectory) {
            if (inside.test(relPath)) return true;
            if (dirOnly) return isDirectory && exact.test(relPath);
            return exact.test(relPath);
        },
    };
}

/**
 * Crea un evaluador de ignorados para un proyecto.
 * Combina: reglas por defecto + .gitignore de la raíz + patrones extra.
 */
function createIgnoreMatcher(rootPath, options = {}) {
    const { useGitignore = true, extraPatterns = [], hideBinary = false } = options;
    let rules = [];

    function load() {
        rules = [];
        const lines = [];
        if (useGitignore) {
            try {
                const content = fs.readFileSync(path.join(rootPath, '.gitignore'), 'utf8');
                lines.push(...content.split(/\r?\n/));
            } catch (_) {
                /* sin .gitignore */
            }
        }
        lines.push(...extraPatterns);
        for (const line of lines) {
            const rule = compileGitignoreRule(line);
            if (rule) rules.push(rule);
        }
    }

    function shouldIgnore(relativePath, isDirectory) {
        const rel = toPosix(relativePath).replace(/^\/+/, '');
        if (!rel) return false;
        const name = rel.split('/').pop();

        if (isDirectory) {
            if (IGNORED_DIRS.has(name)) return true;
        } else {
            if (IGNORED_FILES.has(name)) return true;
            if (IGNORED_FILE_PATTERNS.some((re) => re.test(name))) return true;
            if (hideBinary && isBinaryExtension(name)) return true;
        }

        let ignored = false;
        for (const rule of rules) {
            if (rule.test(rel, isDirectory)) ignored = !rule.negate;
        }
        return ignored;
    }

    load();
    return { shouldIgnore, reload: load };
}

// ───────────────────────── Redacción de secretos ─────────────────────────
const SECRET_PATTERNS = [
    { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
    { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
    { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
    { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
    { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
    {
        name: 'generic-assignment',
        re: /\b((?:api[_-]?key|secret|token|password|passwd|pwd|private[_-]?key|client[_-]?secret)[A-Za-z0-9_]*\s*[:=]\s*)(['"])[^'"\n]{8,}\2/gi,
        replace: '$1$2[REDACTED]$2',
    },
];

/**
 * Reemplaza secretos reconocibles por [REDACTED].
 * @returns {{content: string, redactions: number}}
 */
function redactSecrets(content) {
    let redactions = 0;
    let result = content;
    for (const { re, replace } of SECRET_PATTERNS) {
        result = result.replace(re, (...args) => {
            redactions += 1;
            if (replace) {
                // Aplica la plantilla manualmente usando los grupos capturados
                return replace.replace(/\$(\d)/g, (_, n) => args[Number(n)] || '');
            }
            return '[REDACTED]';
        });
    }
    return { content: result, redactions };
}

module.exports = {
    IGNORED_DIRS,
    IGNORED_FILES,
    BINARY_EXTENSIONS,
    toPosix,
    isBinaryExtension,
    isSensitiveFile,
    createIgnoreMatcher,
    redactSecrets,
};