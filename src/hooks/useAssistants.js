import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAssistants.js
 * Conecta la interfaz con el administrador de asistentes (proceso principal)
 * a través de window.devpilotAI (expuesto en preload.js).
 *
 * Cada acción devuelve el estado completo actualizado, así que la interfaz
 * siempre muestra lo que realmente quedó guardado.
 */

const EMPTY = { assistants: [], selectedId: null, browser: null, sessions: [], activeSessionId: null };

const api = () => {
    if (!window.devpilotAI) {
        throw new Error('window.devpilotAI no existe. Revisa preload.js.');
    }
    return window.devpilotAI;
};

async function call(promise) {
    const res = await promise;
    if (!res.ok) throw new Error(res.error || 'Error desconocido');
    return res.data;
}

const OPEN_NOTICES = {
    chrome: (name) => `${name} se abrió en Chrome.`,
    custom: (name) => `${name} se abrió en tu navegador personalizado.`,
    default: (name) => `${name} se abrió en el navegador predeterminado (no se encontró Chrome).`,
};

export default function useAssistants() {
    const [state, setState] = useState(EMPTY);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const noticeTimer = useRef(null);

    const showNotice = useCallback((text) => {
        setNotice(text);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 6000);
    }, []);

    useEffect(() => () => noticeTimer.current && clearTimeout(noticeTimer.current), []);

    const refresh = useCallback(async () => {
        try {
            setState(await call(api().snapshot()));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    /**
     * Ejecuta una acción que cambia datos y aplica el estado devuelto.
     * Devuelve el resultado de la acción, o null si falló.
     */
    const mutate = useCallback(async (fn) => {
        setError(null);
        try {
            const { snapshot, result } = await call(fn());
            setState(snapshot);
            return result;
        } catch (err) {
            setError(err.message);
            return null;
        }
    }, []);

    // ───────────── asistentes ─────────────
    const select = useCallback((id) => mutate(() => api().select(id)), [mutate]);
    const toggleFavorite = useCallback((id) => mutate(() => api().favorite(id)), [mutate]);
    const setEnabled = useCallback((id, enabled) => mutate(() => api().enable(id, enabled)), [mutate]);
    const saveSettings = useCallback((id, patch) => mutate(() => api().settings(id, patch)), [mutate]);
    const resetSettings = useCallback((id) => mutate(() => api().resetSettings(id)), [mutate]);
    const markClosed = useCallback((id) => mutate(() => api().markClosed(id)), [mutate]);
    const addCustom = useCallback((input) => mutate(() => api().addCustom(input)), [mutate]);
    const removeCustom = useCallback((id) => mutate(() => api().removeCustom(id)), [mutate]);

    const open = useCallback(
        async (id) => {
            setBusyId(id);
            const result = await mutate(() => api().open(id));
            setBusyId(null);
            if (result && result.kind) {
                const build = OPEN_NOTICES[result.kind] || OPEN_NOTICES.chrome;
                showNotice(build(result.name));
            }
            return result;
        },
        [mutate, showNotice]
    );

    // ───────────── sesiones ─────────────
    const createSession = useCallback((input) => mutate(() => api().sessionCreate(input)), [mutate]);
    const renameSession = useCallback((id, name) => mutate(() => api().sessionRename(id, name)), [mutate]);
    const setSessionNotes = useCallback((id, notes) => mutate(() => api().sessionNotes(id, notes)), [mutate]);
    const activateSession = useCallback((id) => mutate(() => api().sessionActivate(id)), [mutate]);
    const archiveSession = useCallback((id) => mutate(() => api().sessionArchive(id)), [mutate]);
    const restoreSession = useCallback((id) => mutate(() => api().sessionRestore(id)), [mutate]);
    const deleteSession = useCallback((id) => mutate(() => api().sessionDelete(id)), [mutate]);

    const clearError = useCallback(() => setError(null), []);

    const selected = state.assistants.find((a) => a.id === state.selectedId) || null;
    const activeSession = state.sessions.find((s) => s.id === state.activeSessionId) || null;

    return {
        // estado
        assistants: state.assistants,
        selectedId: state.selectedId,
        selected,
        browser: state.browser,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        activeSession,
        loading,
        busyId,
        error,
        notice,
        // acciones
        refresh,
        select,
        toggleFavorite,
        setEnabled,
        saveSettings,
        resetSettings,
        open,
        markClosed,
        addCustom,
        removeCustom,
        createSession,
        renameSession,
        setSessionNotes,
        activateSession,
        archiveSession,
        restoreSession,
        deleteSession,
        clearError,
    };
}