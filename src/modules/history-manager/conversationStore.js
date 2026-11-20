'use strict';

/**
 * conversationStore.js
 * Tarea 3.2.5: historial de conversaciones.
 *
 * Una conversación pertenece a un proyecto y a un asistente, y contiene
 * "turnos" (consulta enviada + respuesta registrada). También guarda el estado
 * de continuidad (archivos ya enviados) y los ajustes del flujo de mensajes.
 *
 * Límites: 100 conversaciones y 200 turnos por conversación. Al llegar al
 * límite se pide al usuario que elimine alguna (no se borra nada por su cuenta).
 */

const crypto = require('crypto');
const path = require('path');
const { createJsonStore } = require('../ai-manager/jsonStore');

const MAX_CONVERSATIONS = 100;
const MAX_TURNS = 200;
const DEFAULT_SETTINGS = { autoCopy: true, autoOpen: true, includeHistory: true, defaultLimit: 30000, limits: {} };

const clone = (value) => JSON.parse(JSON.stringify(value));

function titleFrom(instruction) {
    const first = String(instruction || '').split('\n').map((l) => l.trim()).find(Boolean) || 'Conversación';
    return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

function createConversationStore({ dataDir, now = Date.now, uuid = () => crypto.randomUUID() }) {
    const store = createJsonStore(path.join(dataDir, 'conversations.json'), { conversations: [], settings: {} });

    const find = (draft, id) => {
        const conversation = draft.conversations.find((c) => c.id === id);
        if (!conversation) throw new Error('La conversación no existe.');
        return conversation;
    };

    async function list() {
        const data = await store.get();
        return data.conversations
            .map((c) => ({
                id: c.id,
                title: c.title,
                projectPath: c.projectPath,
                projectName: c.projectName,
                assistantId: c.assistantId,
                sessionId: c.sessionId,
                turnCount: c.turns.length,
                pendingResponse: c.turns.some((t) => !t.response),
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async function getOrThrow(id) {
        const data = await store.get();
        const conversation = data.conversations.find((c) => c.id === id);
        if (!conversation) throw new Error('La conversación no existe.');
        return clone(conversation);
    }

    function create({ instruction, title, projectPath, projectName, assistantId, sessionId } = {}) {
        return store.update((draft) => {
            if (draft.conversations.length >= MAX_CONVERSATIONS) {
                throw new Error('Hay demasiadas conversaciones guardadas. Elimina algunas desde Historial.');
            }
            const t = now();
            const conversation = {
                id: uuid(),
                title: title || titleFrom(instruction),
                projectPath: projectPath || '',
                projectName: projectName || '',
                assistantId: assistantId || null,
                sessionId: sessionId || null,
                createdAt: t,
                updatedAt: t,
                state: { sentFiles: {} },
                turns: [],
            };
            draft.conversations.push(conversation);
            return clone(conversation);
        });
    }

    function addTurn(id, data) {
        return store.update((draft) => {
            const conversation = find(draft, id);
            if (conversation.turns.length >= MAX_TURNS) {
                throw new Error('Esta conversación alcanzó el máximo de consultas. Crea una nueva.');
            }
            const t = now();
            const turn = { id: uuid(), createdAt: t, response: null, ...data };
            conversation.turns.push(turn);
            conversation.updatedAt = t;
            return clone(turn);
        });
    }

    function setResponse(id, turnId, response) {
        return store.update((draft) => {
            const conversation = find(draft, id);
            const turn = conversation.turns.find((x) => x.id === turnId);
            if (!turn) throw new Error('La consulta no existe.');
            turn.response = response;
            conversation.updatedAt = now();
            return clone(turn);
        });
    }

    function patchState(id, patch) {
        return store.update((draft) => {
            const conversation = find(draft, id);
            conversation.state = { ...conversation.state, ...patch };
            return true;
        });
    }

    function remove(id) {
        return store.update((draft) => {
            find(draft, id);
            draft.conversations = draft.conversations.filter((c) => c.id !== id);
            return true;
        });
    }

    async function getSettings() {
        const data = await store.get();
        const s = data.settings || {};
        return { ...DEFAULT_SETTINGS, ...s, limits: { ...(s.limits || {}) } };
    }

    function updateSettings(patch) {
        return store.update((draft) => {
            const current = draft.settings || {};
            const next = { ...current, ...patch };
            if (patch.limits) next.limits = { ...(current.limits || {}), ...patch.limits };
            draft.settings = next;
            return { ...DEFAULT_SETTINGS, ...next, limits: { ...(next.limits || {}) } };
        });
    }

    return { list, getOrThrow, create, addTurn, setResponse, patchState, remove, getSettings, updateSettings };
}

module.exports = { createConversationStore, DEFAULT_SETTINGS, MAX_CONVERSATIONS, MAX_TURNS };