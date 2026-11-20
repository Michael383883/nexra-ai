import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useProject.js
 * Hook que conecta la interfaz con el módulo project-manager (proceso principal)
 * a través de window.devpilotProject (expuesto en preload.js).
 *
 * Maneja: proyecto abierto, recientes, árbol (expandir/contraer con carga
 * perezosa), selección de archivos, archivo activo, cambios en disco y contexto.
 */

const api = () => {
    if (!window.devpilotProject) {
        throw new Error('window.devpilotProject no existe. Revisa preload.js.');
    }
    return window.devpilotProject;
};

/** Desenvuelve la respuesta { ok, data, error } del IPC. */
async function call(promise) {
    const res = await promise;
    if (!res.ok) throw new Error(res.error || 'Error desconocido');
    return res.data;
}

/** Reemplaza (inmutablemente) el nodo con `targetPath` dentro del árbol. */
function mapTree(node, targetPath, fn) {
    if (node.path === targetPath) return fn(node);
    if (!node.children) return node;
    let changed = false;
    const children = node.children.map((child) => {
        const next = mapTree(child, targetPath, fn);
        if (next !== child) changed = true;
        return next;
    });
    return changed ? { ...node, children } : node;
}

/** Archivos seleccionables (legibles) de un nodo, solo de lo ya cargado. */
function collectSelectable(node, acc = []) {
    if (node.type === 'file') {
        if (node.readable) acc.push(node);
    } else if (node.children) {
        node.children.forEach((child) => collectSelectable(child, acc));
    }
    return acc;
}

function isSameOrInside(candidate, removed) {
    if (candidate === removed) return true;
    if (!candidate.startsWith(removed)) return false;
    const next = candidate[removed.length];
    return next === '/' || next === '\\';
}

const DEFAULT_CONTEXT_OPTIONS = {
    includeTree: true,
    includeAnalysis: true,
    redact: true,
    maxTokens: 30000,
    instructions: '',
};

export default function useProject() {
    const [project, setProject] = useState(null); // { rootPath, name, tree, analysis, truncated }
    const [recent, setRecent] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const [expanded, setExpanded] = useState(() => new Set());
    const [selected, setSelected] = useState(() => new Set());
    const [modified, setModified] = useState(() => new Set());
    const [activeFile, setActiveFile] = useState(null);

    const [contextOptions, setContextOptions] = useState(DEFAULT_CONTEXT_OPTIONS);
    const [context, setContext] = useState(null);
    const [contextLoading, setContextLoading] = useState(false);
    const [structureTick, setStructureTick] = useState(0);

    const loadingDirs = useRef(new Set());
    const activeFileRef = useRef(null);
    activeFileRef.current = activeFile;

    // ───────────── helpers ─────────────
    const run = useCallback(async (fn) => {
        setError(null);
        try {
            return await fn();
        } catch (err) {
            setError(err.message || String(err));
            return null;
        }
    }, []);

    const clearError = useCallback(() => setError(null), []);

    const refreshRecent = useCallback(async () => {
        try {
            setRecent(await call(api().recent()));
        } catch (_) {
            setRecent([]);
        }
    }, []);

    const applyProject = useCallback((data) => {
        setProject(data);
        setExpanded(new Set([data.tree.path]));
        setSelected(new Set());
        setModified(new Set());
        setActiveFile(null);
        setContext(null);
        setStructureTick((t) => t + 1);
    }, []);

    // ───────────── abrir / cerrar ─────────────
    const openFolder = useCallback(async () => {
        setLoading(true);
        const data = await run(() => call(api().selectFolder()));
        setLoading(false);
        if (data) {
            applyProject(data);
            refreshRecent();
        }
    }, [run, applyProject, refreshRecent]);

    const openRecent = useCallback(
        async (rootPath) => {
            setLoading(true);
            const data = await run(() => call(api().open(rootPath)));
            setLoading(false);
            if (data) {
                applyProject(data);
                refreshRecent();
            }
        },
        [run, applyProject, refreshRecent]
    );

    const closeProject = useCallback(async () => {
        await run(() => call(api().close()));
        setProject(null);
        setActiveFile(null);
        setContext(null);
        setSelected(new Set());
        setModified(new Set());
        refreshRecent();
    }, [run, refreshRecent]);

    const refresh = useCallback(async () => {
        setLoading(true);
        const data = await run(() => call(api().refresh()));
        setLoading(false);
        if (data) {
            setProject(data);
            setModified(new Set());
            setStructureTick((t) => t + 1);
        }
    }, [run]);

    const removeRecent = useCallback(
        async (rootPath) => {
            await run(() => call(api().removeRecent(rootPath)));
            refreshRecent();
        },
        [run, refreshRecent]
    );

    const clearRecent = useCallback(async () => {
        await run(() => call(api().clearRecent()));
        setRecent([]);
    }, [run]);

    // ───────────── árbol: expandir / contraer ─────────────
    const loadChildren = useCallback(async (node) => {
        if (loadingDirs.current.has(node.path)) return;
        loadingDirs.current.add(node.path);
        try {
            const children = await call(api().listDir(node.path));
            setProject((prev) =>
                prev
                    ? {
                        ...prev,
                        tree: mapTree(prev.tree, node.path, (n) => (n.children === null ? { ...n, children } : n)),
                    }
                    : prev
            );
        } catch (err) {
            setError(err.message);
        } finally {
            loadingDirs.current.delete(node.path);
        }
    }, []);

    const toggleExpand = useCallback((node) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(node.path)) next.delete(node.path);
            else next.add(node.path);
            return next;
        });
    }, []);

    // Carga perezosa: carpetas expandidas cuyo contenido aún no se ha cargado
    useEffect(() => {
        if (!project) return;
        const pending = [];
        (function walk(node) {
            if (node.type !== 'directory' || !expanded.has(node.path)) return;
            if (node.children === null) pending.push(node);
            else (node.children || []).forEach(walk);
        })(project.tree);
        pending.forEach(loadChildren);
    }, [project && project.tree, expanded, loadChildren]); // eslint-disable-line react-hooks/exhaustive-deps

    // ───────────── selección para el contexto ─────────────
    const toggleSelect = useCallback((node, force) => {
        const files = node.type === 'file' ? (node.readable ? [node] : []) : collectSelectable(node);
        if (!files.length) return;
        setSelected((prev) => {
            const next = new Set(prev);
            const check = force !== undefined ? force : !files.every((f) => next.has(f.path));
            files.forEach((f) => (check ? next.add(f.path) : next.delete(f.path)));
            return next;
        });
    }, []);

    const clearSelection = useCallback(() => setSelected(new Set()), []);

    // ───────────── archivo activo ─────────────
    const openFile = useCallback(
        async (node) => {
            if (!node || node.type !== 'file') return null;

            let allowSensitive = false;
            if (node.sensitive) {
                const ok = window.confirm(
                    `"${node.name}" puede contener secretos (claves, contraseñas).\n\n¿Quieres abrirlo solo para verlo aquí?\nNo se incluirá automáticamente en el contexto de la IA.`
                );
                if (!ok) return null;
                allowSensitive = true;
            }

            const result = await run(() => call(api().readFile(node.path, { allowSensitive, redact: false })));
            if (!result) return null;

            setModified((prev) => {
                if (!prev.has(node.path)) return prev;
                const next = new Set(prev);
                next.delete(node.path);
                return next;
            });
            const file = { ...result, path: result.path || node.path, node, authorized: allowSensitive };
            setActiveFile(file);
            return file;
        },
        [run]
    );

    const clearModified = useCallback(() => setModified(new Set()), []);
    const closeFile = useCallback(() => setActiveFile(null), []);

    // ───────────── cambios en disco (2.1.9) ─────────────
    useEffect(() => {
        let off = () => { };
        try {
            off = api().onChanged(async (changes) => {
                const touched = [...changes.added, ...changes.modified].filter((c) => c.type === 'file').map((c) => c.path);
                if (touched.length) {
                    setModified((prev) => {
                        const next = new Set(prev);
                        touched.forEach((p) => next.add(p));
                        return next;
                    });
                }

                if (changes.removed.length) {
                    setSelected((prev) => {
                        const next = new Set([...prev].filter((s) => !changes.removed.some((r) => isSameOrInside(s, r.path))));
                        return next.size === prev.size ? prev : next;
                    });
                }

                if (changes.added.length || changes.removed.length) {
                    try {
                        const current = await call(api().current());
                        if (current) {
                            setProject((prev) =>
                                prev && prev.rootPath === current.rootPath
                                    ? { ...prev, tree: current.tree, analysis: current.analysis }
                                    : prev
                            );
                            setStructureTick((t) => t + 1);
                        }
                    } catch (_) {
                        /* se ignora: el usuario puede refrescar manualmente */
                    }
                }

                const active = activeFileRef.current;
                if (active) {
                    if (changes.removed.some((c) => c.path === active.path)) {
                        setActiveFile(null);
                    } else if (changes.modified.some((c) => c.path === active.path)) {
                        try {
                            const result = await call(
                                api().readFile(active.path, { allowSensitive: active.authorized, redact: false })
                            );
                            if (result.ok !== false) setActiveFile({ ...active, ...result, path: active.path });
                        } catch (_) {
                            /* ignorado */
                        }
                    }
                }
            });
        } catch (_) {
            /* sin preload (p. ej. pruebas en navegador) */
        }
        return () => off();
    }, []);

    // ───────────── contexto ─────────────
    const updateContextOptions = useCallback((patch) => {
        setContextOptions((prev) => ({ ...prev, ...patch }));
    }, []);

    useEffect(() => {
        if (!project) return undefined;
        const timer = setTimeout(async () => {
            setContextLoading(true);
            try {
                setContext(await call(api().buildContext([...selected], contextOptions)));
            } catch (err) {
                setError(err.message);
            } finally {
                setContextLoading(false);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [project && project.rootPath, selected, contextOptions, structureTick]); // eslint-disable-line react-hooks/exhaustive-deps

    // ───────────── inicio ─────────────
    useEffect(() => {
        refreshRecent();
    }, [refreshRecent]);

    return {
        // estado
        project,
        recent,
        loading,
        error,
        expanded,
        selected,
        selectedCount: selected.size,
        modified,
        activeFile,
        context,
        contextLoading,
        contextOptions,
        // acciones
        openFolder,
        openRecent,
        closeProject,
        refresh,
        removeRecent,
        clearRecent,
        toggleExpand,
        toggleSelect,
        clearSelection,
        openFile,
        closeFile,
        clearModified,
        updateContextOptions,
        clearError,
    };
}