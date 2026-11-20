'use strict';

/**
 * assistantCatalog.js
 * Tarea 3.1.1: catálogo de asistentes (Claude, ChatGPT, Gemini, etc.).
 *
 * - Los asistentes integrados se definen en src/services/<nombre>/index.js
 *   (Claude, ChatGPT, Gemini) y aquí se añaden algunos extra.
 * - El usuario puede registrar asistentes propios (con validación de URL).
 */

const claude = require('../../services/claude');
const chatgpt = require('../../services/chatgpt');
const gemini = require('../../services/gemini');

const EXTRA_ASSISTANTS = [
    {
        id: 'copilot',
        name: 'Copilot',
        vendor: 'Microsoft',
        url: 'https://copilot.microsoft.com/',
        description: 'Asistente de Microsoft.',
        color: '#2f6fed',
        icon: 'Co',
        defaultEnabled: false,
    },
    {
        id: 'perplexity',
        name: 'Perplexity',
        vendor: 'Perplexity AI',
        url: 'https://www.perplexity.ai/',
        description: 'Buscador con respuestas generadas por IA.',
        color: '#20b8cd',
        icon: 'P',
        defaultEnabled: false,
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        vendor: 'DeepSeek',
        url: 'https://chat.deepseek.com/',
        description: 'Asistente de DeepSeek.',
        color: '#4d6bfe',
        icon: 'D',
        defaultEnabled: false,
    },
];

const MAX_CUSTOM = 20;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Copia fresca del catálogo integrado (en orden de visualización). */
function getBuiltinAssistants() {
    return [claude, chatgpt, gemini, ...EXTRA_ASSISTANTS].map((a) => ({ ...a }));
}

/**
 * Solo se abren URLs https, o http únicamente hacia la propia máquina
 * (útil para asistentes locales como Open WebUI o LM Studio).
 */
function isAllowedUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch (_) {
        return false;
    }
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return LOCAL_HOSTS.has(url.hostname);
    return false;
}

function slugify(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20);
}

/**
 * Valida y normaliza un asistente personalizado.
 * @param {{name: string, url: string}} input
 * @param {object[]} existingCustom  Asistentes personalizados ya registrados.
 */
function validateCustomAssistant(input, existingCustom = []) {
    const name = String((input && input.name) || '').trim().replace(/\s+/g, ' ');
    const url = String((input && input.url) || '').trim();

    if (!name) throw new Error('Escribe un nombre para el asistente.');
    if (name.length > 40) throw new Error('El nombre no puede superar 40 caracteres.');
    if (!isAllowedUrl(url)) {
        throw new Error('La URL debe empezar por https:// (http:// solo se permite para localhost).');
    }
    if (existingCustom.length >= MAX_CUSTOM) {
        throw new Error(`Solo puedes registrar hasta ${MAX_CUSTOM} asistentes personalizados.`);
    }
    if (existingCustom.some((c) => c.url === url)) {
        throw new Error('Ya registraste un asistente con esa URL.');
    }

    const taken = new Set([...getBuiltinAssistants().map((a) => a.id), ...existingCustom.map((c) => c.id)]);
    const base = `custom-${slugify(name) || 'asistente'}`;
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;

    return {
        id,
        name,
        vendor: new URL(url).hostname,
        url,
        description: 'Asistente personalizado.',
        color: '#8b8e98',
        icon: name.charAt(0).toUpperCase(),
    };
}

module.exports = {
    MAX_CUSTOM,
    getBuiltinAssistants,
    isAllowedUrl,
    validateCustomAssistant,
};