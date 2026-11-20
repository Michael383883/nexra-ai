'use strict';

/**
 * sessionManager.js
 * Tarea 3.1.4: organizar las sesiones de trabajo.
 *
 * Una sesión agrupa el trabajo que haces con un proyecto y uno o varios
 * asistentes: nombre, proyecto, asistentes usados, notas y cuántas veces
 * se abrió un asistente dentro de ella. Solo una sesión está activa a la vez.
 */

const crypto = require('crypto');

const MAX_SESSIONS = 200;
const MAX_NAME = 80;
const MAX_NOTES = 2000;

function createSessionManager(store, { now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
    const cleanName = (value, fallback) => {
        const text = String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
        return text || fallback;
    };

    const lastSegment = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

    const findOrThrow = (draft, id) => {
        const session = draft.sessions.find((s) => s.id === id);
        if (!session) throw new Error('La sesión no existe.');
        return session;
    };

    async function list({ includeArchived = false } = {}) {
        const data = await store.get();
        return data.sessions
            .filter((s) => includeArchived || !s.archived)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async function getActiveId() {
        const data = await store.get();
        const active = data.sessions.find((s) => s.id === data.activeSessionId && !s.archived);
        return active ? active.id : null;
    }

    function create({ name, projectPath, assistantId } = {}) {
        return store.update((draft) => {
            if (draft.sessions.length >= MAX_SESSIONS) {
                throw new Error('Hay demasiadas sesiones. Elimina algunas antes de crear otra.');
            }
            const path = typeof projectPath === 'string' ? projectPath.slice(0, 1000) : '';
            const projectName = lastSegment(path);
            const t = now();
            const session = {
                id: uuid(),
                name: cleanName(name, projectName ? `Sesión de ${projectName}` : `Sesión ${draft.sessions.length + 1}`),
                projectPath: path,
                projectName,
                assistantId: assistantId || null,
                assistantsUsed: assistantId ? [assistantId] : [],
                notes: '',
                openCount: 0,
                archived: false,
                createdAt: t,
                updatedAt: t,
                lastOpenedAt: null,
            };
            draft.sessions.push(session);
            draft.activeSessionId = session.id; // la nueva sesión pasa a ser la activa
            return session;
        });
    }

    function rename(id, name) {
        return store.update((draft) => {
            const session = findOrThrow(draft, id);
            session.name = cleanName(name, session.name);
            session.updatedAt = now();
            return session;
        });
    }

    function setNotes(id, notes) {
        return store.update((draft) => {
            const session = findOrThrow(draft, id);
            const text = String(notes == null ? '' : notes);
            if (text.length > MAX_NOTES) throw new Error(`Las notas no pueden superar ${MAX_NOTES} caracteres.`);
            session.notes = text;
            session.updatedAt = now();
            return session;
        });
    }

    /** Activa una sesión (o ninguna si id es null). */
    function setActive(id) {
        return store.update((draft) => {
            if (id !== null && id !== undefined) {
                const session = findOrThrow(draft, id);
                if (session.archived) throw new Error('No se puede activar una sesión archivada.');
                draft.activeSessionId = id;
            } else {
                draft.activeSessionId = null;
            }
            return draft.activeSessionId;
        });
    }

    function archive(id) {
        return store.update((draft) => {
            const session = findOrThrow(draft, id);
            session.archived = true;
            session.updatedAt = now();
            if (draft.activeSessionId === id) draft.activeSessionId = null;
            return session;
        });
    }

    function restore(id) {
        return store.update((draft) => {
            const session = findOrThrow(draft, id);
            session.archived = false;
            session.updatedAt = now();
            return session;
        });
    }

    function remove(id) {
        return store.update((draft) => {
            findOrThrow(draft, id);
            draft.sessions = draft.sessions.filter((s) => s.id !== id);
            if (draft.activeSessionId === id) draft.activeSessionId = null;
            return true;
        });
    }

    /** Registra en la sesión activa que se abrió un asistente. */
    function recordAssistantOpen(assistantId) {
        return store.update((draft) => {
            const session = draft.sessions.find((s) => s.id === draft.activeSessionId && !s.archived);
            if (!session) return null;
            const t = now();
            session.assistantId = assistantId;
            if (!session.assistantsUsed.includes(assistantId)) session.assistantsUsed.push(assistantId);
            session.openCount += 1;
            session.lastOpenedAt = t;
            session.updatedAt = t;
            return session;
        });
    }

    return { list, getActiveId, create, rename, setNotes, setActive, archive, restore, remove, recordAssistantOpen };
}

module.exports = { createSessionManager, MAX_SESSIONS };