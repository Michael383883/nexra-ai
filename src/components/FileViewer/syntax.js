import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import php from 'highlight.js/lib/languages/php';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import ruby from 'highlight.js/lib/languages/ruby';
import ini from 'highlight.js/lib/languages/ini';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('php', php);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('ini', ini);

const BY_EXTENSION = {
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.json': 'json',
    '.css': 'css', '.scss': 'scss',
    '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml', '.vue': 'xml',
    '.md': 'markdown', '.markdown': 'markdown',
    '.py': 'python',
    '.php': 'php',
    '.sql': 'sql',
    '.sh': 'bash', '.bash': 'bash',
    '.yml': 'yaml', '.yaml': 'yaml',
    '.java': 'java',
    '.c': 'cpp', '.h': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.env': 'ini', '.ini': 'ini', '.toml': 'ini',
};

// Por encima de este tamaño se muestra sin colores para que la interfaz no se trabe.
const MAX_HIGHLIGHT_CHARS = 200000;

/** Separa el HTML resaltado en líneas, cerrando y reabriendo los <span> que cruzan saltos de línea. */
export function splitHighlightedLines(html) {
    const lines = [];
    const open = [];
    let current = '';
    for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
        if (part === '') continue;
        if (part === '\n') {
            lines.push(current + '</span>'.repeat(open.length));
            current = open.join('');
        } else if (part.startsWith('<span')) {
            open.push(part);
            current += part;
        } else if (part === '</span>') {
            open.pop();
            current += part;
        } else {
            current += part;
        }
    }
    lines.push(current);
    return lines;
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Devuelve un arreglo con el HTML de cada línea (seguro: highlight.js escapa el texto).
 * Si el lenguaje no se reconoce o el archivo es muy grande, devuelve el texto plano escapado.
 */
export function highlightLines(content, extension) {
    const ext = (extension || '').toLowerCase();
    const language = BY_EXTENSION[ext];
    if (!language || content.length > MAX_HIGHLIGHT_CHARS) {
        return content.split('\n').map(escapeHtml);
    }
    try {
        const { value } = hljs.highlight(content, { language, ignoreIllegals: true });
        return splitHighlightedLines(value);
    } catch (_) {
        return content.split('\n').map(escapeHtml);
    }
}