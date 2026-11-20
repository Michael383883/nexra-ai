'use strict';

/**
 * responseManager.js
 * Tarea 3.2.4: gestor de respuestas (pegar y registrar).
 *
 * Valida el texto pegado, lo asocia a la consulta pendiente, organiza el
 * código recibido (3.2.6) y lo guarda en el historial (3.2.5).
 */

const crypto = require('crypto');

const MAX_RESPONSE_CHARS = 200000;
const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

function createResponseManager({ store, generated, baseDir, now = Date.now }) {
    function normalize(text) {
        const clean = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\0/g, '').trim();
        if (!clean) throw new Error('La respuesta está vacía. Copia primero la respuesta del asistente.');
        if (clean.length > MAX_RESPONSE_CHARS) {
            throw new Error(`La respuesta tiene ${clean.length} caracteres y el máximo es ${MAX_RESPONSE_CHARS}. Divide la consulta en partes más pequeñas.`);
        }
        return clean;
    }

    /**
     * Registra una respuesta.
     * @param {{conversationId: string, turnId?: string, text: string}} input
     */
    async function record({ conversationId, turnId, text }) {
        const clean = normalize(text);
        const hash = sha1(clean);
        const conversation = await store.getOrThrow(conversationId);

        // Consulta destino: la indicada, o la última sin respuesta
        let turn = null;
        if (turnId) {
            turn = conversation.turns.find((t) => t.id === turnId);
            if (!turn) throw new Error('La consulta no existe.');
            if (turn.response) throw new Error('Esa consulta ya tiene una respuesta registrada.');
        } else {
            turn = [...conversation.turns].reverse().find((t) => !t.response) || null;
        }

        // Protecciones contra errores frecuentes al copiar
        if (turn && turn.messageHash === hash) {
            throw new Error('Parece que copiaste tu propio mensaje y no la respuesta del asistente.');
        }
        if (conversation.turns.some((t) => t.response && t.response.hash === hash)) {
            throw new Error('Esta respuesta ya está registrada en la conversación.');
        }

        // Respuesta pegada sin una consulta enviada desde NEXRA
        if (!turn) {
            turn = await store.addTurn(conversationId, {
                orphan: true,
                assistantId: conversation.assistantId,
                mode: 'new',
                instruction: '(Respuesta pegada sin una consulta enviada desde NEXRA)',
                messageHash: null,
                messageChars: 0,
                messageTokens: 0,
                files: [],
                unchanged: [],
                truncated: false,
            });
        }

        const { entries, warnings } = await generated.organizeResponse({ text: clean, projectRoot: conversation.projectPath });
        const saveWarnings = await generated.saveEntries({ baseDir, conversationId, turnId: turn.id, entries });

        const response = {
            text: clean,
            hash,
            chars: clean.length,
            receivedAt: now(),
            files: entries.map((e) => ({
                kind: e.kind,
                path: e.path,
                language: e.language,
                bytes: e.bytes,
                lines: e.lines,
                status: e.status,
                sensitive: e.sensitive,
                command: Boolean(e.command),
                stored: e.stored,
            })),
            warnings: [...warnings, ...saveWarnings],
        };

        const saved = await store.setResponse(conversationId, turn.id, response);
        return { turn: saved, files: response.files, warnings: response.warnings };
    }

    return { record };
}

module.exports = { createResponseManager, MAX_RESPONSE_CHARS };