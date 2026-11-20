'use strict';

/**
 * assistantService.js  (proceso principal de Electron)
 *
 * Tareas: 3.1.2 selector, 3.1.3 abrir en Chrome, 3.1.4 sesiones,
 *         3.1.5 estado, 3.1.6 configuración y 3.1.7 favoritos.
 *
 * Uso en desktop/main.js:
 *   const { registerAiIpc } = require('../src/modules/ai-manager/assistantService');
 *   registerAiIpc(ipcMain);
 *
 * Estados (3.1.5):
 *   available → listo para abrirse
 *   open      → DevPilot lo abrió durante esta ejecución de la app
 *   pending   → requiere atención (p. ej. la ruta del navegador configurada ya no existe)
 *   disabled  → desactivado por el usuario
 *
 * Nota: "open" significa "abierto por DevPilot en esta sesión de la app".
 * Chrome no informa si cerraste la pestaña, por eso existe "Marcar cerrado".
 */

const path = require('path');
const { createJsonStore } = require('./jsonStore');
const { getBuiltinAssistants, validateCustomAssistant } = require('./assistantCatalog');
const { createBrowserManager, PROFILE_RE } = require('./browserManager');
const { createSessionManager } = require('./sessionManager');

const MAX_ASSISTANT_NOTES = 500;

function requireId(id) {
    if (typeof id !== 'string' || !id || id.length > 100) throw new Error('Identificador no válido.');
    return id;
}

function createAssistantService({ dataDir, browser, now = Date.now, uuid } = {}) {
    if (!dataDir) throw new Error('dataDir es obligatorio.');
    if (!browser) throw new Error('browser es obligatorio.');

    const prefsStore = createJsonStore(path.join(dataDir, 'assistants.json'), {
        selectedId: 'claude',
        preferences: {},
        custom: [],
    });
    const sessionsStore = createJsonStore(path.join(dataDir, 'sessions.json'), {
        sessions: [],
        activeSessionId: null,
    });
    const sessions = createSessionManager(sessionsStore, { now, uuid });

    // Estado en memoria: asistentes abiertos en esta ejecución
    const openState = new Map();

    // ───────────── catálogo + preferencias ─────────────
    async function loadAll() {
        const data = await prefsStore.get();
        const builtin = getBuiltinAssistants().map((a) => ({ ...a, builtin: true }));
        const custom = data.custom.map((c) => ({ ...c, builtin: false, defaultEnabled: true }));
        return { data, base: [...builtin, ...custom] };
    }

    function prefsFor(data, assistant) {
        const p = data.preferences[assistant.id] || {};
        return {
            enabled: p.enabled === undefined ? Boolean(assistant.defaultEnabled) : Boolean(p.enabled),
            favorite: Boolean(p.favorite),
            browserPath: p.browserPath || '',
            profile: p.profile || '',
            newWindow: Boolean(p.newWindow),
            notes: p.notes || '',
            lastOpenedAt: p.lastOpenedAt || null,
        };
    }

    function computeStatus(assistant, prefs) {
        if (!prefs.enabled) return { status: 'disabled', detail: 'Desactivado' };

        if (prefs.browserPath) {
            const check = browser.checkCustomPath(prefs.browserPath);
            if (!check.ok) return { status: 'pending', detail: check.error };
        }
        if (openState.has(assistant.id)) {
            return { status: 'open', detail: 'Abierto desde DevPilot en esta sesión' };
        }
        if (prefs.browserPath) return { status: 'available', detail: 'Se abrirá con tu navegador personalizado' };

        const info = browser.getBrowserInfo();
        return {
            status: 'available',
            detail: info.found ? 'Se abrirá en Chrome' : 'Chrome no encontrado: se usará el navegador predeterminado',
        };
    }

    function effectiveSelectedId(data, list) {
        const selected = list.find((a) => a.id === data.selectedId && a.enabled);
        if (selected) return selected.id;
        const firstEnabled = list.find((a) => a.enabled);
        return firstEnabled ? firstEnabled.id : null;
    }

    // ───────────── consulta ─────────────
    async function snapshot() {
        const { data, base } = await loadAll();

        const list = base.map((a) => {
            const p = prefsFor(data, a);
            const s = computeStatus(a, p);
            return {
                id: a.id,
                name: a.name,
                vendor: a.vendor,
                url: a.url,
                description: a.description,
                color: a.color,
                icon: a.icon,
                builtin: a.builtin,
                enabled: p.enabled,
                favorite: p.favorite,
                selected: false,
                settings: { browserPath: p.browserPath, profile: p.profile, newWindow: p.newWindow, notes: p.notes },
                lastOpenedAt: p.lastOpenedAt,
                openedAt: openState.get(a.id) || null,
                status: s.status,
                statusDetail: s.detail,
            };
        });

        const selectedId = effectiveSelectedId(data, list);
        list.forEach((a) => {
            a.selected = a.id === selectedId;
        });

        // Activos primero, y dentro de ellos los favoritos (orden estable)
        list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.favorite) - Number(a.favorite));

        return {
            assistants: list,
            selectedId,
            browser: browser.getBrowserInfo(),
            sessions: await sessions.list({ includeArchived: true }),
            activeSessionId: await sessions.getActiveId(),
        };
    }

    async function findAssistant(id) {
        requireId(id);
        const { data, base } = await loadAll();
        const assistant = base.find((a) => a.id === id);
        if (!assistant) throw new Error('El asistente no existe.');
        return { data, assistant, prefs: prefsFor(data, assistant) };
    }

    // ───────────── 3.1.2 selector ─────────────
    async function select(id) {
        const { assistant, prefs } = await findAssistant(id);
        if (!prefs.enabled) throw new Error('Activa el asistente antes de elegirlo.');
        await prefsStore.update((draft) => {
            draft.selectedId = assistant.id;
        });
    }

    // ───────────── 3.1.7 favoritos ─────────────
    async function setFavorite(id, value) {
        const { assistant, prefs } = await findAssistant(id);
        const favorite = value === undefined ? !prefs.favorite : Boolean(value);
        await prefsStore.update((draft) => {
            draft.preferences[assistant.id] = { ...(draft.preferences[assistant.id] || {}), favorite };
        });
    }

    async function setEnabled(id, enabled) {
        const { assistant } = await findAssistant(id);
        await prefsStore.update((draft) => {
            draft.preferences[assistant.id] = { ...(draft.preferences[assistant.id] || {}), enabled: Boolean(enabled) };
        });
        if (!enabled) openState.delete(assistant.id);
    }

    // ───────────── 3.1.6 configuración ─────────────
    async function updateSettings(id, patch = {}) {
        const { assistant } = await findAssistant(id);
        const clean = {};

        if ('browserPath' in patch) {
            const value = String(patch.browserPath || '').trim();
            if (value.length > 500) throw new Error('La ruta del navegador es demasiado larga.');
            if (value) {
                const check = browser.checkCustomPath(value);
                if (!check.ok) throw new Error(check.error);
            }
            clean.browserPath = value;
        }
        if ('profile' in patch) {
            const value = String(patch.profile || '').trim();
            if (value && !PROFILE_RE.test(value)) {
                throw new Error('Nombre de perfil no válido. Usa letras, números, espacios, punto, guion o guion bajo (ej. Default, Profile 1).');
            }
            clean.profile = value;
        }
        if ('newWindow' in patch) clean.newWindow = Boolean(patch.newWindow);
        if ('notes' in patch) {
            const value = String(patch.notes || '');
            if (value.length > MAX_ASSISTANT_NOTES) throw new Error(`Las notas no pueden superar ${MAX_ASSISTANT_NOTES} caracteres.`);
            clean.notes = value;
        }

        await prefsStore.update((draft) => {
            draft.preferences[assistant.id] = { ...(draft.preferences[assistant.id] || {}), ...clean };
        });
    }

    /** Restablece navegador, perfil, ventana y notas (conserva favorito y activación). */
    async function resetSettings(id) {
        const { assistant } = await findAssistant(id);
        await prefsStore.update((draft) => {
            const current = draft.preferences[assistant.id] || {};
            draft.preferences[assistant.id] = {
                ...(current.favorite !== undefined ? { favorite: current.favorite } : {}),
                ...(current.enabled !== undefined ? { enabled: current.enabled } : {}),
                ...(current.lastOpenedAt ? { lastOpenedAt: current.lastOpenedAt } : {}),
            };
        });
    }

    // ───────────── 3.1.3 abrir en el navegador ─────────────
    async function openAssistant(id) {
        const { assistant, prefs } = await findAssistant(id);
        if (!prefs.enabled) throw new Error('El asistente está desactivado.');

        // La URL sale siempre del catálogo, nunca de la interfaz
        const result = await browser.open(assistant.url, {
            browserPath: prefs.browserPath,
            profile: prefs.profile,
            newWindow: prefs.newWindow,
        });

        const t = now();
        openState.set(assistant.id, t);
        await prefsStore.update((draft) => {
            draft.preferences[assistant.id] = { ...(draft.preferences[assistant.id] || {}), lastOpenedAt: t };
            draft.selectedId = assistant.id;
        });
        await sessions.recordAssistantOpen(assistant.id);

        return { kind: result.kind, name: assistant.name };
    }

    async function markClosed(id) {
        requireId(id);
        openState.delete(id);
    }

    // ───────────── 3.1.1 asistentes personalizados ─────────────
    async function addCustom(input) {
        const data = await prefsStore.get();
        const custom = validateCustomAssistant(input, data.custom);
        await prefsStore.update((draft) => {
            draft.custom.push(custom);
        });
        return custom.id;
    }

    async function removeCustom(id) {
        requireId(id);
        const data = await prefsStore.get();
        if (!data.custom.some((c) => c.id === id)) throw new Error('Solo se pueden eliminar asistentes personalizados.');
        await prefsStore.update((draft) => {
            draft.custom = draft.custom.filter((c) => c.id !== id);
            delete draft.preferences[id];
            if (draft.selectedId === id) draft.selectedId = 'claude';
        });
        openState.delete(id);
    }

    // ───────────── 3.1.4 sesiones ─────────────
    async function createSession(input = {}) {
        const { data, base } = await loadAll();
        const list = base.map((a) => ({ id: a.id, enabled: prefsFor(data, a).enabled }));
        const assistantId = input.assistantId || effectiveSelectedId(data, list);
        return sessions.create({ name: input.name, projectPath: input.projectPath, assistantId });
    }

    return {
        snapshot,
        select,
        setFavorite,
        setEnabled,
        updateSettings,
        resetSettings,
        openAssistant,
        markClosed,
        addCustom,
        removeCustom,
        createSession,
        renameSession: (id, name) => sessions.rename(requireId(id), name),
        setSessionNotes: (id, notes) => sessions.setNotes(requireId(id), notes),
        activateSession: (id) => sessions.setActive(id === null ? null : requireId(id)),
        archiveSession: (id) => sessions.archive(requireId(id)),
        restoreSession: (id) => sessions.restore(requireId(id)),
        deleteSession: (id) => sessions.remove(requireId(id)),
    };
}

// ───────────────────────── IPC ─────────────────────────
function registerAiIpc(ipcMain) {
    let service = null;

    // Se crea la primera vez que se necesita (la app ya está lista)
    function getService() {
        if (!service) {
            const { app, shell } = require('electron');
            const browser = createBrowserManager({ openExternal: (url) => shell.openExternal(url) });
            service = createAssistantService({ dataDir: app.getPath('userData'), browser });
        }
        return service;
    }

    const query = (channel, fn) => {
        ipcMain.handle(channel, async (_event, ...args) => {
            try {
                return { ok: true, data: await fn(getService(), ...args) };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
    };

    // Las acciones que cambian algo devuelven el estado completo actualizado
    const mutate = (channel, fn) => {
        ipcMain.handle(channel, async (_event, ...args) => {
            try {
                const svc = getService();
                const result = await fn(svc, ...args);
                return { ok: true, data: { snapshot: await svc.snapshot(), result: result === undefined ? true : result } };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
    };

    query('ai:snapshot', (s) => s.snapshot());

    mutate('ai:select', (s, id) => s.select(id));
    mutate('ai:favorite', (s, id, value) => s.setFavorite(id, value));
    mutate('ai:enable', (s, id, enabled) => s.setEnabled(id, enabled));
    mutate('ai:settings', (s, id, patch) => s.updateSettings(id, patch));
    mutate('ai:reset-settings', (s, id) => s.resetSettings(id));
    mutate('ai:open', (s, id) => s.openAssistant(id));
    mutate('ai:mark-closed', (s, id) => s.markClosed(id));
    mutate('ai:add-custom', (s, input) => s.addCustom(input));
    mutate('ai:remove-custom', (s, id) => s.removeCustom(id));

    mutate('ai:session-create', (s, input) => s.createSession(input));
    mutate('ai:session-rename', (s, id, name) => s.renameSession(id, name));
    mutate('ai:session-notes', (s, id, notes) => s.setSessionNotes(id, notes));
    mutate('ai:session-activate', (s, id) => s.activateSession(id));
    mutate('ai:session-archive', (s, id) => s.archiveSession(id));
    mutate('ai:session-restore', (s, id) => s.restoreSession(id));
    mutate('ai:session-delete', (s, id) => s.deleteSession(id));

    // Permite que otros módulos (conversaciones, Fase 3.2) usen el mismo servicio
    return { getService };

}

module.exports = { createAssistantService, registerAiIpc };