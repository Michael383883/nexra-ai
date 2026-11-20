'use strict';

/**
 * continuityManager.js
 * Tarea 3.2.7: continuidad de contexto entre consultas.
 *
 * Dos mecanismos:
 *  - Resumen de consultas anteriores (cuando abres un chat NUEVO en el asistente).
 *  - Envío incremental de archivos (cuando CONTINÚAS el mismo chat): solo se
 *    reenvían los archivos que cambiaron o que nunca se enviaron.
 */

const crypto = require('crypto');
const path = require('path');
const { estimateTokens } = require('../project-manager/contextBuilder');
const { readFile } = require('../project-manager/fileReader');
const { toPosix } = require('../project-manager/ignoreRules');

const MAX_TURNS_IN_SUMMARY = 5;
const MAX_SENT_FILES = 500;
const MAX_LISTED_FILES = 30;

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

/** Quita los bloques de código de un texto y deja solo la prosa. */
function proseOnly(text) {
    const out = [];
    let inFence = false;
    for (const line of String(text).split('\n')) {
        if (/^\s*(`{3,}|~{3,})/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (!inFence) out.push(line);
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
}

function excerpt(text, max) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function describeTurn(turn, number) {
    const lines = [`## Consulta ${number}`, `Pedido: ${excerpt(turn.instruction, 500)}`];
    if (turn.response) {
        const prose = excerpt(proseOnly(turn.response.text), 700);
        lines.push(`Respuesta (resumen): ${prose || '(solo código)'}`);
        const files = (turn.response.files || []).filter((f) => f.kind === 'file');
        if (files.length) {
            const names = files.slice(0, 10).map((f) => {
                const mark = f.status === 'new' ? ' (nuevo)' : f.status === 'modified' ? ' (modificado)' : '';
                return `${f.path}${mark}`;
            });
            lines.push(`Archivos entregados: ${names.join(', ')}${files.length > 10 ? ` y ${files.length - 10} más` : ''}`);
        }
    } else {
        lines.push('Respuesta: (sin respuesta registrada)');
    }
    return lines.join('\n');
}

/** Resumen de las últimas consultas, ajustado a `maxTokens`. */
function summarizeTurns(turns, maxTokens) {
    if (!turns || !turns.length || maxTokens < 120) return '';

    const header = '# Contexto de la conversación anterior\n(Resumen automático de consultas previas sobre este proyecto.)';
    const recent = turns.slice(-MAX_TURNS_IN_SUMMARY);
    const offset = turns.length - recent.length;
    const entries = recent.map((turn, i) => describeTurn(turn, offset + i + 1));

    // De la más reciente hacia atrás, mientras quepa
    const kept = [];
    let used = estimateTokens(header);
    for (let i = entries.length - 1; i >= 0; i--) {
        const cost = estimateTokens(entries[i]) + 1;
        if (used + cost > maxTokens) break;
        kept.unshift(entries[i]);
        used += cost;
    }
    return kept.length ? `${header}\n\n${kept.join('\n\n')}` : '';
}

/** Nota con los archivos que ya se enviaron y no cambiaron. */
function unchangedNote(unchanged) {
    if (!unchanged || !unchanged.length) return '';
    const shown = unchanged.slice(0, MAX_LISTED_FILES).join(', ');
    const more = unchanged.length > MAX_LISTED_FILES ? ` y ${unchanged.length - MAX_LISTED_FILES} más` : '';
    return `# Archivos sin cambios\nEstos archivos ya se enviaron antes en esta conversación y no han cambiado: ${shown}${more}.`;
}

/**
 * Compara los archivos seleccionados con lo ya enviado.
 * @returns {{changed: string[], unchanged: string[], hashes: Record<string,string>}}
 */
async function classifyFiles({ rootPath, selectedFiles, sentFiles = {} }) {
    const changed = [];
    const unchanged = [];
    const hashes = {};

    for (const file of selectedFiles) {
        const absolute = path.isAbsolute(file) ? file : path.join(rootPath, file);
        const relative = toPosix(path.relative(rootPath, absolute));
        const res = await readFile(absolute, { projectRoot: rootPath, allowSensitive: false, redact: false });

        if (res.ok && !res.truncated) {
            const hash = sha1(res.content);
            hashes[relative] = hash;
            if (sentFiles[relative] === hash) {
                unchanged.push(relative);
                continue;
            }
        }
        changed.push(absolute);
    }
    return { changed, unchanged, hashes };
}

/** Registra como "enviados" los archivos que entraron completos en el mensaje. */
function updateSentFiles(sentFiles, included, hashes) {
    const next = { ...sentFiles };
    for (const file of included || []) {
        if (!file.truncated && hashes[file.path]) next[file.path] = hashes[file.path];
    }
    const keys = Object.keys(next);
    if (keys.length > MAX_SENT_FILES) {
        for (const key of keys.slice(0, keys.length - MAX_SENT_FILES)) delete next[key];
    }
    return next;
}

module.exports = { sha1, proseOnly, summarizeTurns, unchangedNote, classifyFiles, updateSentFiles };