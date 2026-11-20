'use strict';

/**
 * fileReader.js
 * Tareas: 2.1.4 (lector de archivos), 2.1.5 (detección de extensiones)
 *         y 2.1.7 (protección: no leer secretos automáticamente).
 */

const fsp = require('fs/promises');
const path = require('path');
const { isBinaryExtension, isSensitiveFile, redactSecrets, toPosix } = require('./ignoreRules');

const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB

// ext → [lenguaje, tipo]
const EXTENSION_MAP = {
    // JavaScript / TypeScript
    '.js': ['JavaScript', 'code'], '.mjs': ['JavaScript', 'code'], '.cjs': ['JavaScript', 'code'],
    '.jsx': ['JavaScript (JSX)', 'code'], '.ts': ['TypeScript', 'code'], '.tsx': ['TypeScript (TSX)', 'code'],
    '.vue': ['Vue', 'code'], '.svelte': ['Svelte', 'code'],
    // Backend
    '.php': ['PHP', 'code'], '.py': ['Python', 'code'], '.rb': ['Ruby', 'code'],
    '.java': ['Java', 'code'], '.kt': ['Kotlin', 'code'], '.go': ['Go', 'code'],
    '.rs': ['Rust', 'code'], '.cs': ['C#', 'code'], '.swift': ['Swift', 'code'],
    '.c': ['C', 'code'], '.h': ['C', 'code'], '.cpp': ['C++', 'code'], '.hpp': ['C++', 'code'],
    '.dart': ['Dart', 'code'], '.lua': ['Lua', 'code'], '.r': ['R', 'code'], '.scala': ['Scala', 'code'],
    '.sh': ['Shell', 'code'], '.bash': ['Shell', 'code'], '.ps1': ['PowerShell', 'code'], '.bat': ['Batch', 'code'],
    '.sql': ['SQL', 'code'],
    // Web / markup
    '.html': ['HTML', 'markup'], '.htm': ['HTML', 'markup'], '.xml': ['XML', 'markup'], '.svg': ['SVG', 'markup'],
    '.css': ['CSS', 'style'], '.scss': ['SCSS', 'style'], '.sass': ['Sass', 'style'], '.less': ['Less', 'style'],
    '.blade.php': ['Blade (PHP)', 'markup'],
    // Config
    '.json': ['JSON', 'config'], '.yml': ['YAML', 'config'], '.yaml': ['YAML', 'config'],
    '.toml': ['TOML', 'config'], '.ini': ['INI', 'config'], '.env': ['Env', 'config'],
    '.gradle': ['Gradle', 'config'], '.lock': ['Lock', 'config'],
    // Docs
    '.md': ['Markdown', 'doc'], '.mdx': ['MDX', 'doc'], '.txt': ['Texto', 'doc'],
    '.rst': ['reStructuredText', 'doc'], '.csv': ['CSV', 'data'],
};

const SPECIAL_FILENAMES = {
    dockerfile: ['Dockerfile', 'config'],
    makefile: ['Makefile', 'config'],
    '.gitignore': ['Git', 'config'],
    '.editorconfig': ['EditorConfig', 'config'],
    '.prettierrc': ['JSON', 'config'],
    '.eslintrc': ['JSON', 'config'],
    '.babelrc': ['JSON', 'config'],
    license: ['Texto', 'doc'],
    readme: ['Texto', 'doc'],
};

/**
 * Detecta lenguaje y tipo de un archivo por su nombre/extensión.
 * @returns {{extension: string, language: string, kind: string}}
 */
function getFileType(filePath) {
    const name = path.basename(filePath).toLowerCase();
    const extension = path.extname(name);

    if (name.endsWith('.blade.php')) {
        return { extension: '.blade.php', language: 'Blade (PHP)', kind: 'markup' };
    }
    if (SPECIAL_FILENAMES[name]) {
        const [language, kind] = SPECIAL_FILENAMES[name];
        return { extension, language, kind };
    }
    if (/^\.env/.test(name)) {
        return { extension, language: 'Env', kind: 'config' };
    }
    if (EXTENSION_MAP[extension]) {
        const [language, kind] = EXTENSION_MAP[extension];
        return { extension, language, kind };
    }
    if (isBinaryExtension(name)) {
        const kind = /\.(png|jpe?g|gif|bmp|ico|webp|tiff|psd|icns)$/.test(name) ? 'image' : 'binary';
        return { extension, language: 'Binario', kind };
    }
    return { extension, language: 'Desconocido', kind: 'other' };
}

function detectLanguage(filePath) {
    return getFileType(filePath).language;
}

/** ¿`target` está dentro de `root`? (protege contra ../ y rutas externas) */
function isInsideRoot(root, target) {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Lee un archivo de texto de forma segura.
 *
 * @param {string} filePath
 * @param {object} options
 * @param {string} options.projectRoot   Raíz del proyecto (obligatoria).
 * @param {number} [options.maxBytes]    Límite de lectura (por defecto 1 MB).
 * @param {boolean} [options.allowSensitive]  Solo true si el usuario lo autorizó explícitamente.
 * @param {boolean} [options.redact]     Redactar secretos dentro del contenido.
 */
async function readFile(filePath, options = {}) {
    const { projectRoot, maxBytes = DEFAULT_MAX_BYTES, allowSensitive = false, redact = false } = options;

    if (!projectRoot) {
        return { ok: false, error: 'projectRoot es obligatorio', reason: 'invalid' };
    }

    const absolute = path.resolve(filePath);
    if (!isInsideRoot(projectRoot, absolute)) {
        return { ok: false, error: 'Archivo fuera del proyecto', reason: 'outside-project' };
    }

    let real;
    try {
        real = await fsp.realpath(absolute);
    } catch (err) {
        return { ok: false, error: 'El archivo no existe', reason: 'not-found' };
    }
    // Evita symlinks que apunten fuera del proyecto
    const realRoot = await fsp.realpath(projectRoot).catch(() => path.resolve(projectRoot));
    if (!isInsideRoot(realRoot, real)) {
        return { ok: false, error: 'Enlace simbólico fuera del proyecto', reason: 'outside-project' };
    }

    const relativePath = toPosix(path.relative(path.resolve(projectRoot), absolute));
    const typeInfo = getFileType(absolute);

    if (!allowSensitive && isSensitiveFile(absolute)) {
        return {
            ok: false, blocked: true, reason: 'sensitive', relativePath,
            error: 'Archivo protegido: puede contener secretos. Requiere autorización explícita.',
        };
    }
    if (isBinaryExtension(absolute)) {
        return { ok: false, blocked: true, reason: 'binary', relativePath, error: 'Archivo binario: no se puede leer como texto.' };
    }

    let stat;
    try {
        stat = await fsp.stat(real);
    } catch (err) {
        return { ok: false, error: err.message, reason: 'stat-failed' };
    }
    if (!stat.isFile()) {
        return { ok: false, error: 'No es un archivo', reason: 'not-a-file' };
    }

    const bytesToRead = Math.min(stat.size, maxBytes);
    const truncated = stat.size > maxBytes;
    let buffer;
    let handle;
    try {
        handle = await fsp.open(real, 'r');
        buffer = Buffer.alloc(bytesToRead);
        await handle.read(buffer, 0, bytesToRead, 0);
    } catch (err) {
        return { ok: false, error: err.message, reason: 'read-failed' };
    } finally {
        if (handle) await handle.close();
    }

    // Detección de binarios sin extensión conocida: byte nulo en el inicio
    if (buffer.subarray(0, 8000).includes(0)) {
        return { ok: false, blocked: true, reason: 'binary', relativePath, error: 'Contenido binario detectado.' };
    }

    let content = buffer.toString('utf8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // BOM

    let redactions = 0;
    if (redact) {
        const result = redactSecrets(content);
        content = result.content;
        redactions = result.redactions;
    }

    return {
        ok: true,
        path: absolute,
        relativePath,
        name: path.basename(absolute),
        extension: typeInfo.extension,
        language: typeInfo.language,
        kind: typeInfo.kind,
        size: stat.size,
        lines: content.length ? content.split('\n').length : 0,
        truncated,
        redactions,
        content,
    };
}

async function readFiles(filePaths, options = {}) {
    return Promise.all(filePaths.map((p) => readFile(p, options)));
}

module.exports = {
    DEFAULT_MAX_BYTES,
    getFileType,
    detectLanguage,
    isInsideRoot,
    readFile,
    readFiles,
};