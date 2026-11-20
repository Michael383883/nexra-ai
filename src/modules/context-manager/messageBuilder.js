'use strict';

/**
 * messageBuilder.js
 * Tarea 3.2.1: constructor de mensajes (instrucción + continuidad + contexto).
 * Tarea 3.2.8: control de límites (ajusta el mensaje al tamaño permitido).
 *
 * Orden de prioridad cuando falta espacio:
 *   1) instrucción + formato de respuesta (siempre se conservan)
 *   2) continuidad (hasta el 25 % del espacio libre)
 *   3) contexto del proyecto (lo que quede; el constructor de contexto recorta
 *      archivos o los omite si no caben)
 */

const { estimateTokens } = require('../project-manager/contextBuilder');

const MIN_CONTEXT_TOKENS = 300;
const HEADER_SLACK = 40;

const RESPONSE_FORMAT = [
    '# Formato de respuesta',
    '- Responde en español.',
    '- Por cada archivo que crees o modifiques, escribe una línea "Archivo: ruta/relativa/al/proyecto.ext" y justo debajo el contenido COMPLETO del archivo en un bloque de código.',
    '- Usa siempre rutas relativas a la raíz del proyecto (sin "..").',
    '- Si hay comandos que ejecutar, ponlos en un bloque aparte al final.',
].join('\n');

/** Une las secciones del mensaje en su orden final. */
function buildMessage({ instruction, continuity = '', contextText = '', includeFormat = true }) {
    const parts = [`# Instrucción\n${String(instruction).trim()}`];
    if (continuity && continuity.trim()) parts.push(continuity.trim());
    if (contextText && contextText.trim()) parts.push(contextText.trim());
    if (includeFormat) parts.push(RESPONSE_FORMAT);
    return parts.join('\n\n');
}

function describeContext(context) {
    const warnings = [];
    let truncated = false;
    if (!context) return { warnings, truncated };

    const cut = context.included.filter((f) => f.truncated);
    if (cut.length) {
        truncated = true;
        warnings.push(`Se recortó el contenido de: ${cut.map((f) => f.path).join(', ')}.`);
    }
    const noRoom = context.skipped.filter((s) => s.reason === 'budget');
    if (noRoom.length) {
        truncated = true;
        warnings.push(`No cupieron en el límite: ${noRoom.map((s) => s.path).join(', ')}.`);
    }
    const protectedFiles = context.skipped.filter((s) => s.reason === 'sensitive');
    if (protectedFiles.length) {
        warnings.push(`Se omitieron por protección (posibles secretos): ${protectedFiles.map((s) => s.path).join(', ')}.`);
    }
    const binary = context.skipped.filter((s) => s.reason === 'binary');
    if (binary.length) {
        warnings.push(`Se omitieron por ser binarios: ${binary.map((s) => s.path).join(', ')}.`);
    }
    return { warnings, truncated };
}

/**
 * Arma el mensaje final respetando `maxTokens`.
 *
 * @param {object} params
 * @param {string} params.instruction
 * @param {number} params.maxTokens
 * @param {(budget: number) => (string|Promise<string>)} [params.continuityFor]
 * @param {(budget: number) => Promise<object|null>} [params.contextFor]  Devuelve el resultado de buildContext.
 * @param {boolean} [params.includeFormat=true]
 */
async function assembleMessage({ instruction, maxTokens, continuityFor, contextFor, includeFormat = true }) {
    const fixed = buildMessage({ instruction, includeFormat });
    const fixedTokens = estimateTokens(fixed);
    if (fixedTokens > maxTokens) {
        throw new Error(
            `La instrucción (≈${fixedTokens} tokens) no cabe en el límite de ${maxTokens} tokens. Acórtala o sube el límite.`
        );
    }

    const available = maxTokens - fixedTokens - HEADER_SLACK;
    const dropped = [];
    const warnings = [];

    // 1) continuidad
    let continuity = '';
    if (continuityFor) continuity = (await continuityFor(Math.max(0, Math.floor(available * 0.25)))) || '';
    const continuityTokens = continuity ? estimateTokens(continuity) + 2 : 0;

    // 2) contexto del proyecto: se reintenta con menos espacio si la estimación quedó corta
    let budget = available - continuityTokens;
    let context = null;

    if (contextFor) {
        for (let attempt = 0; attempt < 4; attempt++) {
            if (budget < MIN_CONTEXT_TOKENS) {
                dropped.push('contexto del proyecto');
                warnings.push('No quedó espacio para el contexto del proyecto: sube el límite o acorta la instrucción.');
                context = null;
                break;
            }
            const attemptContext = await contextFor(budget);
            const text = buildMessage({
                instruction,
                continuity,
                contextText: attemptContext ? attemptContext.text : '',
                includeFormat,
            });
            const tokens = estimateTokens(text);
            if (tokens <= maxTokens) {
                context = attemptContext;
                const info = describeContext(context);
                return { text, tokens, maxTokens, context, dropped, warnings: [...warnings, ...info.warnings], truncated: info.truncated || dropped.length > 0 };
            }
            budget -= tokens - maxTokens + 50;
            context = null;
        }
    }

    const text = buildMessage({ instruction, continuity, includeFormat });
    return {
        text,
        tokens: estimateTokens(text),
        maxTokens,
        context: null,
        dropped,
        warnings,
        truncated: dropped.length > 0,
    };
}

module.exports = { RESPONSE_FORMAT, buildMessage, assembleMessage };