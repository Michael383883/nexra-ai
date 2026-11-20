'use strict';

/**
 * services/clipboard/index.js  (proceso principal)
 * Tarea 3.2.2: gestor de portapapeles.
 *
 * Copia mensajes comprobando que el portapapeles quedó con el texto exacto
 * (otro programa, como un gestor de portapapeles, podría alterarlo) y lee
 * el portapapeles para registrar respuestas.
 */

const MAX_CHARS = 2000000;
const normalizeEol = (s) => String(s).replace(/\r\n/g, '\n');

function createClipboardService(clipboard) {
    function copy(text) {
        if (typeof text !== 'string' || text.length === 0) throw new Error('No hay texto para copiar.');
        if (text.length > MAX_CHARS) {
            throw new Error(`El texto supera el máximo permitido para el portapapeles (${MAX_CHARS} caracteres).`);
        }
        clipboard.writeText(text);

        let verified = false;
        try {
            verified = normalizeEol(clipboard.readText()) === normalizeEol(text);
        } catch (_) {
            verified = false;
        }
        return { chars: text.length, verified };
    }

    function read() {
        const text = String(clipboard.readText() || '');
        return { text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
    }

    return { copy, read };
}

module.exports = { createClipboardService, MAX_CHARS };