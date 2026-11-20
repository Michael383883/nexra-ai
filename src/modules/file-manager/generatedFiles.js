'use strict';

/**
 * generatedFiles.js
 * Tarea 3.2.6: gestor de archivos generados (organiza el código recibido).
 *
 * Detecta los bloques de código de una respuesta, deduce la ruta de cada
 * archivo, valida que sea segura, la compara con el proyecto y la guarda en
 * una zona de preparación (userData/generated). NO escribe nada en el proyecto:
 * aplicar los cambios es trabajo del Editor de cambios (siguiente fase).
 */

const fsp = require('fs/promises');
const path = require('path');
const { readFile, getFileType } = require('../project-manager/fileReader');
const { isSensitiveFile } = require('../project-manager/ignoreRules');

const LIMITS = { maxFiles: 100, maxFileBytes: 500 * 1024, maxTotalBytes: 5 * 1024 * 1024, maxReadBytes: 1024 * 1024 };
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const SHELL_LANGS = new Set(['sh', 'bash', 'shell', 'zsh', 'powershell', 'ps1', 'cmd', 'bat', 'console', 'terminal']);
const LANG_EXT = {
    js: 'js', javascript: 'js', jsx: 'jsx', ts: 'ts', typescript: 'ts', tsx: 'tsx', py: 'py', python: 'py',
    php: 'php', html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'md', markdown: 'md', sql: 'sql',
    yaml: 'yml', yml: 'yml', java: 'java', go: 'go', rs: 'rs', rust: 'rs', c: 'c', cpp: 'cpp', cs: 'cs',
    rb: 'rb', ruby: 'rb', vue: 'vue', xml: 'xml', toml: 'toml', ini: 'ini', sh: 'sh', bash: 'sh',
};

const normalizeEol = (s) => String(s).replace(/\r\n/g, '\n');
const countLines = (content) => content.replace(/\n$/, '').split('\n').length;

// ───────────────────────── rutas ─────────────────────────
/**
 * Normaliza una ruta propuesta por la IA. Devuelve null si no es segura.
 * Las rutas de la IA NO son de fiar: se rechazan "..", unidades de Windows,
 * nombres reservados y caracteres no permitidos.
 */
function sanitizeRelativePath(input) {
    if (typeof input !== 'string') return null;
    let p = input.trim().replace(/^['"`]+|['"`,;:]+$/g, '').replace(/\\/g, '/');
    if (!p || p.length > 200 || p.includes('\0')) return null;
    if (/^[A-Za-z]:/.test(p) || p.startsWith('~')) return null;

    p = p.replace(/^\/+/, '').replace(/^\.\//, '');
    const segments = p.split('/').filter((s) => s !== '' && s !== '.');
    if (!segments.length || segments.some((s) => s === '..')) return null;
    if (segments.some((s) => s.length > 100)) return null;
    if (segments.some((s) => /[<>:"|?*\u0000-\u001f]/.test(s))) return null;
    if (segments.some((s) => /[. ]$/.test(s))) return null;
    if (segments.some((s) => /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s))) return null;
    return segments.join('/');
}

function looksLikePath(s) {
    return (
        /^[\w@.\-/\\]+$/.test(s) &&
        (/\.[A-Za-z0-9]{1,10}$/.test(s) || s.includes('/')) &&
        !/^\d+(\.\d+)*$/.test(s)
    );
}

// ───────────────────── detección de bloques ─────────────────────
/** Extrae los bloques ``` o ~~~ de un texto. */
function extractBlocks(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const open = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (!open || (open[1][0] === '`' && open[2].includes('`'))) {
            i += 1;
            continue;
        }
        const fence = open[1];
        const closeRe = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);

        let prevLine = '';
        for (let k = i - 1; k >= 0 && k >= i - 3; k--) {
            if (lines[k].trim()) {
                prevLine = lines[k];
                break;
            }
        }

        const body = [];
        let j = i + 1;
        while (j < lines.length && !closeRe.test(lines[j])) {
            body.push(lines[j]);
            j += 1;
        }
        blocks.push({ info: open[2].trim(), content: body.join('\n'), prevLine, unclosed: j >= lines.length });
        i = j + 1;
    }
    return blocks;
}

function pathFromInfo(info) {
    if (!info) return null;
    const named = info.match(/(?:title|filename|file|path)\s*=\s*["']?([^"'\s]+)/i);
    if (named && looksLikePath(named[1])) return named[1];
    for (const token of info.split(/[\s:]+/).filter(Boolean)) {
        if (looksLikePath(token)) return token;
    }
    return null;
}

function pathFromLine(line) {
    if (!line) return null;
    let s = line.replace(/[*_`#>]+/g, ' ').trim();
    s = s.replace(/^\d+[.)]\s*/, '');
    s = s.replace(/^(?:archivo|fichero|file|filename|ruta|path|nombre)\s*:?\s*/i, '');
    s = s.replace(/\s*\(.*\)\s*$/, '').replace(/[:：]\s*$/, '').trim();
    return looksLikePath(s) ? s : null;
}

function pathFromFirstComment(content) {
    const first = String(content).split('\n', 1)[0];
    const m = first.match(/^\s*(?:\/\/|#|--|;|\/\*|<!--)\s*(?:archivo|file|filename|path|ruta)\s*:\s*([^\s*>]+)/i);
    return m && looksLikePath(m[1]) ? m[1] : null;
}

function languageFromInfo(info) {
    const token = (info || '').split(/[\s:]+/).filter(Boolean)[0];
    return token && !looksLikePath(token) && /^[A-Za-z][\w+#-]*$/.test(token) ? token.toLowerCase() : '';
}

// ───────────────────── organización ─────────────────────
async function compareWithProject(projectRoot, relativePath, content) {
    if (!projectRoot) return 'unknown';
    const res = await readFile(path.join(projectRoot, ...relativePath.split('/')), { projectRoot, allowSensitive: false });
    if (res.reason === 'not-found') return 'new';
    if (res.reason === 'sensitive') return 'protected';
    if (!res.ok) return 'unknown';
    if (res.truncated) return 'modified';
    const same = normalizeEol(res.content).trimEnd() === normalizeEol(content).trimEnd();
    return same ? 'identical' : 'modified';
}

/**
 * Convierte el texto de una respuesta en entradas organizadas.
 * @returns {Promise<{entries: object[], warnings: string[]}>}
 */
async function organizeResponse({ text, projectRoot }) {
    const warnings = [];
    const files = new Map();
    const snippets = [];
    let totalBytes = 0;

    for (const block of extractBlocks(text)) {
        if (!block.content.trim()) continue;

        // La ruta puede venir de la línea de información, de la línea anterior o de un comentario inicial
        let hint = pathFromInfo(block.info);
        let source = 'info';
        if (!hint) {
            hint = pathFromLine(block.prevLine);
            source = 'line';
        }
        if (!hint) {
            hint = pathFromFirstComment(block.content);
            source = 'comment';
        }

        const relative = hint ? sanitizeRelativePath(hint) : null;
        if (hint && !relative) warnings.push(`Se ignoró una ruta no válida propuesta por la IA: "${hint}". El código se guardó como fragmento.`);

        // El comentario "// archivo: ruta" es una etiqueta para NEXRA, no parte del archivo
        let content = block.content;
        if (relative && source === 'comment') content = content.split('\n').slice(1).join('\n');
        if (!content.trim()) continue;
        content = `${content.replace(/\s+$/, '')}\n`;

        const bytes = Buffer.byteLength(content, 'utf8');
        const label = relative || 'un fragmento';
        if (block.unclosed) warnings.push(`El bloque de ${label} parece incompleto (la respuesta pudo cortarse).`);
        if (bytes > LIMITS.maxFileBytes) {
            warnings.push(`${label} supera 500 KB y no se guardó.`);
            continue;
        }
        if (totalBytes + bytes > LIMITS.maxTotalBytes) {
            warnings.push(`Se alcanzó el máximo de 5 MB por respuesta; ${label} no se guardó.`);
            continue;
        }
        totalBytes += bytes;

        if (relative) {
            if (files.has(relative)) warnings.push(`"${relative}" aparece varias veces: se usó la última versión.`);
            files.set(relative, { content });
        } else {
            snippets.push({ content, info: block.info });
        }
    }

    const entries = [];
    let count = 0;
    for (const [relative, { content }] of files) {
        if (count >= LIMITS.maxFiles) {
            warnings.push(`Solo se organizan los primeros ${LIMITS.maxFiles} archivos de la respuesta.`);
            break;
        }
        count += 1;
        entries.push({
            kind: 'file',
            path: relative,
            language: getFileType(relative).language,
            content,
            bytes: Buffer.byteLength(content, 'utf8'),
            lines: countLines(content),
            sensitive: isSensitiveFile(relative),
            status: await compareWithProject(projectRoot, relative, content),
        });
    }

    snippets.forEach((snippet, i) => {
        const lang = languageFromInfo(snippet.info);
        entries.push({
            kind: 'snippet',
            path: `_fragmentos/fragmento-${i + 1}.${LANG_EXT[lang] || 'txt'}`,
            language: lang || 'texto',
            command: SHELL_LANGS.has(lang),
            content: snippet.content,
            bytes: Buffer.byteLength(snippet.content, 'utf8'),
            lines: countLines(snippet.content),
            sensitive: false,
            status: 'fragment',
        });
    });

    return { entries, warnings };
}

// ───────────────────── almacenamiento ─────────────────────
function turnDir(baseDir, conversationId, turnId) {
    if (!ID_RE.test(String(conversationId)) || !ID_RE.test(String(turnId))) throw new Error('Identificador no válido.');
    return path.resolve(baseDir, conversationId, turnId);
}

function safeTarget(root, relativePath) {
    const clean = sanitizeRelativePath(relativePath);
    if (!clean) throw new Error('Ruta de archivo no válida.');
    const target = path.resolve(root, ...clean.split('/'));
    if (!target.startsWith(root + path.sep)) throw new Error('Ruta de archivo no válida.');
    return target;
}

/** Guarda las entradas en disco. Marca cada una con `stored` y devuelve avisos. */
async function saveEntries({ baseDir, conversationId, turnId, entries }) {
    const root = turnDir(baseDir, conversationId, turnId);
    const warnings = [];
    for (const entry of entries) {
        try {
            const target = safeTarget(root, entry.path);
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.writeFile(target, entry.content, 'utf8');
            entry.stored = true;
        } catch (err) {
            entry.stored = false;
            warnings.push(`No se pudo guardar "${entry.path}": ${err.message}`);
        }
    }
    return warnings;
}

/** Ruta absoluta en disco de un archivo generado (validada). */
function storedPath({ baseDir, conversationId, turnId, relativePath }) {
    return safeTarget(turnDir(baseDir, conversationId, turnId), relativePath);
}

async function readStored(params) {
    const target = storedPath(params);
    const stat = await fsp.stat(target);
    if (stat.size > LIMITS.maxReadBytes) throw new Error('El archivo es demasiado grande para mostrarlo.');
    return fsp.readFile(target, 'utf8');
}

module.exports = {
    LIMITS,
    ID_RE,
    sanitizeRelativePath,
    extractBlocks,
    organizeResponse,
    saveEntries,
    storedPath,
    readStored,
};