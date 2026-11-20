import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * useConversation.js  (Fase 3.2)
 * Conecta la interfaz con el flujo de mensajes (proceso principal) a través de
 * window.devpilotChat (expuesto en preload.js).
 *
 * @param {{project: object, ai: object}} deps
 *   project → objeto devuelto por useProject()
 *   ai      → objeto devuelto por useAssistants()
 */

const DEFAULT_LIMIT = 30000;

const api = () => {
    if (!window.devpilotChat) {
        throw new Error('window.devpilotChat no existe. Revisa preload.js.');
    }
    return window.devpilotChat;
};

async function call(promise) {
    const res = await promise;
    if (!res.ok) throw new Error(res.error || 'Error desconocido');
    return res.data;
}

export default function useConversation({ project, ai }) {
    const [conversations, setConversations] = useState([]);
    const [current, setCurrent] = useState(null); // conversación completa
    const [instruction, setInstruction] = useState('');
    const [mode, setMode] = useState('new'); // 'new' | 'continue'
    const [draft, setDraft] = useState(null); // resultado de prepare()
    const [lastSent, setLastSent] = useState(null); // para "Copiar de nuevo"
    const [settings, setSettings] = useState(null);
    const [busy, setBusy] = useState(null); // 'preparing' | 'sending' | 'recording' | null
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const noticeTimer = useRef(null);

    const assistantId = ai ? ai.selectedId : null;
    const selectedFiles = useMemo(
        () => (project && project.selected ? [...project.selected] : []),
        [project && project.selected] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const limit = settings ? settings.limits[assistantId] || settings.defaultLimit : DEFAULT_LIMIT;

    // Si cambia algo de lo que se preparó, la vista previa queda desactualizada
    const draftKey = useMemo(
        () => JSON.stringify([current && current.id, instruction.trim(), selectedFiles, mode, limit, assistantId]),
        [current, instruction, selectedFiles, mode, limit, assistantId]
    );
    const stale = Boolean(draft && draft.key !== draftKey);

    const showNotice = useCallback((text) => {
        setNotice(text);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 9000);
    }, []);
    useEffect(() => () => noticeTimer.current && clearTimeout(noticeTimer.current), []);

    const run = useCallback(async (label, fn) => {
        setError(null);
        setBusy(label);
        try {
            return await fn();
        } catch (err) {
            setError(err.message || String(err));
            return null;
        } finally {
            setBusy(null);
        }
    }, []);

    const refreshList = useCallback(async () => {
        try {
            setConversations(await call(api().conversations()));
        } catch (err) {
            setError(err.message);
        }
    }, []);

    const loadConversation = useCallback(async (id) => {
        const conversation = await call(api().conversation(id));
        setCurrent(conversation);
        return conversation;
    }, []);

    useEffect(() => {
        refreshList();
        call(api().getSettings())
            .then(setSettings)
            .catch((err) => setError(err.message));
    }, [refreshList]);

    // ───────────── preparar y enviar ─────────────
    const prepare = useCallback(
        () =>
            run('preparing', async () => {
                const data = await call(
                    api().prepare({
                        conversationId: current ? current.id : null,
                        instruction,
                        selectedFiles,
                        mode,
                        assistantId,
                        maxTokens: limit,
                    })
                );
                setDraft({ ...data, key: draftKey });
                return data;
            }),
        [run, current, instruction, selectedFiles, mode, assistantId, limit, draftKey]
    );

    const send = useCallback(async () => {
        if (!draft) return null;
        return run('sending', async () => {
            const data = await call(api().send({ draftId: draft.draftId }));
            setLastSent({ draftId: draft.draftId, assistantName: data.assistantName });
            setDraft(null);
            setInstruction('');
            setMode('continue');
            await loadConversation(data.conversationId);
            await refreshList();
            if (ai && ai.refresh) await ai.refresh();

            if (data.copied && data.opened) {
                showNotice(`Mensaje copiado y ${data.assistantName} abierto. Pégalo con Ctrl+V en el chat y envíalo.`);
            } else if (data.copied) {
                showNotice(`Mensaje copiado, pero no se pudo abrir el asistente: ${data.openError || 'abre su pestaña manualmente'}.`);
            } else {
                showNotice('Consulta registrada (no se copió al portapapeles).');
            }
            if (data.copied && data.verified === false) {
                showNotice('Mensaje copiado, pero no se pudo comprobar el portapapeles. Si al pegar sale otra cosa, usa «Copiar de nuevo».');
            }
            return data;
        });
    }, [draft, run, loadConversation, refreshList, ai, showNotice]);

    const copyAgain = useCallback(async () => {
        const id = draft ? draft.draftId : lastSent && lastSent.draftId;
        if (!id) return null;
        return run(null, async () => {
            await call(api().copyDraft(id));
            showNotice('Mensaje copiado de nuevo al portapapeles.');
            return true;
        });
    }, [draft, lastSent, run, showNotice]);

    // ───────────── respuestas ─────────────
    const readClipboard = useCallback(
        () => run(null, async () => (await call(api().readClipboard())).text),
        [run]
    );

    const recordResponse = useCallback(
        async (text, turnId) => {
            if (!current) {
                setError('Primero envía una consulta para tener una conversación.');
                return null;
            }
            return run('recording', async () => {
                const data = await call(api().recordResponse({ conversationId: current.id, turnId, text }));
                await loadConversation(current.id);
                await refreshList();
                const files = data.files.filter((f) => f.kind === 'file').length;
                showNotice(`Respuesta guardada${files ? ` · ${files} ${files === 1 ? 'archivo organizado' : 'archivos organizados'}` : ''}.`);
                return data;
            });
        },
        [current, run, loadConversation, refreshList, showNotice]
    );

    // ───────────── historial ─────────────
    const selectConversation = useCallback(
        (id) =>
            run(null, async () => {
                const conversation = await loadConversation(id);
                setDraft(null);
                setLastSent(null);
                setMode(conversation.turns.length ? 'continue' : 'new');
                return conversation;
            }),
        [run, loadConversation]
    );

    const newConversation = useCallback(() => {
        setCurrent(null);
        setDraft(null);
        setLastSent(null);
        setMode('new');
        setError(null);
    }, []);

    const deleteConversation = useCallback(
        (id) =>
            run(null, async () => {
                await call(api().deleteConversation(id));
                if (current && current.id === id) newConversation();
                await refreshList();
                return true;
            }),
        [run, current, newConversation, refreshList]
    );

    // ───────────── archivos generados ─────────────
    const generatedArgs = (turnId, filePath) => ({ conversationId: current && current.id, turnId, filePath });

    const readGenerated = useCallback(
        (turnId, filePath) => run(null, () => call(api().readGenerated(generatedArgs(turnId, filePath)))),
        [run, current] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const copyGenerated = useCallback(
        (turnId, filePath) =>
            run(null, async () => {
                await call(api().copyGenerated(generatedArgs(turnId, filePath)));
                showNotice(`«${filePath}» copiado al portapapeles.`);
                return true;
            }),
        [run, current, showNotice] // eslint-disable-line react-hooks/exhaustive-deps
    );
    const revealGenerated = useCallback(
        (turnId, filePath) => run(null, () => call(api().revealGenerated(generatedArgs(turnId, filePath)))),
        [run, current] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // ───────────── ajustes ─────────────
    const updateSettings = useCallback(
        (patch) =>
            run(null, async () => {
                const next = await call(api().setSettings(patch));
                setSettings(next);
                return next;
            }),
        [run]
    );
    const setLimit = useCallback((tokens) => updateSettings({ limits: { [assistantId]: tokens } }), [updateSettings, assistantId]);

    const clearError = useCallback(() => setError(null), []);

    const pendingTurn = current ? [...current.turns].reverse().find((t) => !t.response) || null : null;

    return {
        // estado
        conversations,
        current,
        pendingTurn,
        instruction,
        mode,
        draft,
        stale,
        lastSent,
        settings,
        limit,
        busy,
        error,
        notice,
        // acciones
        setInstruction,
        setMode,
        prepare,
        send,
        copyAgain,
        readClipboard,
        recordResponse,
        selectConversation,
        newConversation,
        deleteConversation,
        readGenerated,
        copyGenerated,
        revealGenerated,
        updateSettings,
        setLimit,
        refreshList,
        clearError,
    };
}