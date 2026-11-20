'use strict';

/**
 * contextBuilder.js
 * Construye el texto de contexto (árbol + análisis + archivos seleccionados)
 * que luego se envía a Claude / ChatGPT / Gemini.
 *
 * Reglas de seguridad:
 *  - Nunca incluye archivos sensibles (.env, llaves, credenciales).
 *  - Redacta secretos reconocibles dentro del contenido.
 *  - Respeta un presupuesto de tokens.
 */

const path = require('path');
const { readFile } = require('./fileReader');
const { toPosix } = require('./ignoreRules');

const CHARS_PER_TOKEN = 4; // estimación aproximada

function estimateTokens(text) {
    return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/** Árbol ASCII del proyecto. */
function buildTreeString(tree, { maxDepth = 5, maxLines = 400 } = {}) {
    const lines = [`${tree.name}/`];
    let truncated = false;

    function walk(node, prefix, depth) {
        if (!node.children || depth >= maxDepth) return;
        const children = node.children;
        for (let i = 0; i < children.length; i++) {
            if (lines.length >= maxLines) {
                truncated = true;
                return;
            }
            const child = children[i];
            const last = i === children.length - 1;
            lines.push(`${prefix}${last ? '└── ' : '├── '}${child.name}${child.type === 'directory' ? '/' : ''}`);
            if (child.type === 'directory') walk(child, prefix + (last ? '    ' : '│   '), depth + 1);
        }
    }

    walk(tree, '', 0);
    if (truncated) lines.push('… (árbol recortado)');
    return lines.join('\n');
}

function fenceFor(content) {
    return content.includes('```') ? '````' : '```';
}

function languageTag(language) {
    const map = {
        'JavaScript': 'js', 'JavaScript (JSX)': 'jsx', 'TypeScript': 'ts', 'TypeScript (TSX)': 'tsx',
        'PHP': 'php', 'Python': 'python', 'HTML': 'html', 'CSS': 'css', 'SCSS': 'scss',
        'JSON': 'json', 'YAML': 'yaml', 'Markdown': 'md', 'SQL': 'sql', 'Shell': 'bash',
        'Go': 'go', 'Rust': 'rust', 'Java': 'java', 'C#': 'csharp', 'Ruby': 'ruby', 'Vue': 'vue',
    };
    return map[language] || '';
}

/**
 * Construye el contexto.
 *
 * @param {object} params
 * @param {string} params.rootPath
 * @param {object} params.tree               Árbol del proyecto.
 * @param {object} [params.analysis]         Resultado de analyzeProject().
 * @param {string[]} [params.selectedFiles]  Rutas absolutas o relativas al proyecto.
 * @param {object} [params.options]
 * @param {boolean} [params.options.includeTree=true]
 * @param {boolean} [params.options.includeAnalysis=true]
 * @param {number}  [params.options.maxTokens=30000]
 * @param {boolean} [params.options.redact=true]
 * @param {string}  [params.options.instructions]  Texto extra al inicio (p. ej. la tarea).
 */
async function buildContext({ rootPath, tree, analysis, selectedFiles = [], options = {} }) {
    const {
        includeTree = true,
        includeAnalysis = true,
        maxTokens = 30000,
        redact = true,
        instructions = '',
    } = options;

    const parts = [];
    const included = [];
    const skipped = [];
    let redactions = 0;

    if (instructions) parts.push(`# Instrucciones\n${instructions.trim()}`);

    if (includeAnalysis && analysis) {
        const lines = [
            '# Proyecto',
            `- Nombre: ${analysis.name}`,
            `- Tipo: ${analysis.type}`,
            analysis.primaryLanguage ? `- Lenguaje principal: ${analysis.primaryLanguage}` : null,
            analysis.frameworks.length ? `- Frameworks/librerías: ${analysis.frameworks.join(', ')}` : null,
            analysis.packageManager ? `- Gestor de paquetes: ${analysis.packageManager}` : null,
            analysis.entryPoints.length ? `- Puntos de entrada: ${analysis.entryPoints.join(', ')}` : null,
            `- Archivos: ${analysis.stats.files}`,
        ].filter(Boolean);
        parts.push(lines.join('\n'));
    }

    if (includeTree && tree) {
        parts.push(`# Estructura\n${fenceFor('')}\n${buildTreeString(tree)}\n${fenceFor('')}`);
    }

    let text = parts.join('\n\n');
    let used = estimateTokens(text);

    if (selectedFiles.length) {
        text += '\n\n# Archivos\n';
        used = estimateTokens(text);
    }

    for (const selected of selectedFiles) {
        const absolute = path.isAbsolute(selected) ? selected : path.join(rootPath, selected);
        const relative = toPosix(path.relative(rootPath, absolute));

        const remaining = maxTokens - used;
        if (remaining < 200) {
            skipped.push({ path: relative, reason: 'budget' });
            continue;
        }

        // Nunca se permiten archivos sensibles desde el constructor de contexto
        const file = await readFile(absolute, {
            projectRoot: rootPath,
            allowSensitive: false,
            redact,
            maxBytes: remaining * CHARS_PER_TOKEN,
        });

        if (!file.ok) {
            skipped.push({ path: relative, reason: file.reason || 'error' });
            continue;
        }

        redactions += file.redactions;
        const fence = fenceFor(file.content);
        const note = file.truncated ? ' (truncado)' : '';
        const block = `\n## ${relative}${note}\n${fence}${languageTag(file.language)}\n${file.content}\n${fence}\n`;
        const blockTokens = estimateTokens(block);

        if (blockTokens > remaining) {
            // Recorta el contenido para que quepa
            const allowedChars = Math.max(0, remaining * CHARS_PER_TOKEN - 200);
            const cut = file.content.slice(0, allowedChars);
            const cutFence = fenceFor(cut);
            const cutBlock = `\n## ${relative} (truncado)\n${cutFence}${languageTag(file.language)}\n${cut}\n${cutFence}\n`;
            text += cutBlock;
            used += estimateTokens(cutBlock);
            included.push({ path: relative, tokens: estimateTokens(cutBlock), truncated: true });
            continue;
        }

        text += block;
        used += blockTokens;
        included.push({ path: relative, tokens: blockTokens, truncated: file.truncated });
    }

    return {
        text,
        estimatedTokens: estimateTokens(text),
        maxTokens,
        included,
        skipped,
        redactions,
    };
}

module.exports = { buildContext, buildTreeString, estimateTokens };