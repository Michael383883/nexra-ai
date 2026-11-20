import React, { useMemo, useState } from 'react';
import './ProjectExplorer.css';
import FileTree from '../FileTree';
import { timeAgo } from '../../utils/format';

/** Devuelve una copia del árbol con solo los nodos que coinciden con la búsqueda. */
function filterTree(root, query) {
    function filter(node) {
        if (node.type === 'file') {
            return node.name.toLowerCase().includes(query) ? node : null;
        }
        if (node.name.toLowerCase().includes(query)) return node; // carpeta coincide: se conserva completa
        const kids = (node.children || []).map(filter).filter(Boolean);
        return kids.length ? { ...node, children: kids } : null;
    }
    const kids = (root.children || []).map(filter).filter(Boolean);
    return { ...root, children: kids };
}

function EmptyState({ project }) {
    const { recent, loading, openFolder, openRecent, removeRecent, clearRecent } = project;

    return (
        <div className="pe-empty">
            <div className="pe-empty-icon" aria-hidden="true">
                📂
            </div>
            <h3>Abre un proyecto</h3>
            <p>Selecciona la carpeta de tu proyecto para explorarlo y preparar contexto para la IA.</p>
            <button type="button" className="pe-btn pe-btn-primary" onClick={openFolder} disabled={loading}>
                {loading ? 'Abriendo…' : 'Abrir carpeta'}
            </button>

            {recent.length > 0 && (
                <div className="pe-recent">
                    <div className="pe-recent-head">
                        <span>Proyectos recientes</span>
                        <button type="button" className="pe-link" onClick={clearRecent}>
                            Borrar lista
                        </button>
                    </div>
                    <ul>
                        {recent.map((item) => (
                            <li key={item.path}>
                                <button type="button" className="pe-recent-item" onClick={() => openRecent(item.path)} title={item.path}>
                                    <span className="pe-recent-name">{item.name}</span>
                                    <span className="pe-recent-path">{item.path}</span>
                                    <span className="pe-recent-time">{timeAgo(item.lastOpened)}</span>
                                </button>
                                <button
                                    type="button"
                                    className="pe-icon-btn"
                                    onClick={() => removeRecent(item.path)}
                                    title="Quitar de recientes"
                                    aria-label={`Quitar ${item.name} de recientes`}
                                >
                                    ✕
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

/**
 * Panel del explorador de proyecto.
 * @param {object} props.project  Objeto devuelto por useProject().
 * @param {(file: object) => void} [props.onOpenFile]  Se llama al abrir un archivo (para el CodeEditor).
 */
export default function ProjectExplorer({ project, onOpenFile }) {
    const [query, setQuery] = useState('');
    const {
        project: current,
        loading,
        error,
        expanded,
        selected,
        selectedCount,
        modified,
        activeFile,
        openFolder,
        closeProject,
        refresh,
        toggleExpand,
        toggleSelect,
        clearSelection,
        openFile,
        clearModified,
        clearError,
    } = project;

    const q = query.trim().toLowerCase();
    const tree = useMemo(() => (current && q ? filterTree(current.tree, q) : current && current.tree), [current && current.tree, q]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleOpenFile = async (node) => {
        const file = await openFile(node);
        if (file && onOpenFile) onOpenFile(file);
    };

    if (!current) {
        return (
            <section className="pe">
                {error && (
                    <div className="pe-error" role="alert">
                        <span>{error}</span>
                        <button type="button" className="pe-icon-btn" onClick={clearError} aria-label="Cerrar aviso">
                            ✕
                        </button>
                    </div>
                )}
                <EmptyState project={project} />
            </section>
        );
    }

    return (
        <section className="pe">
            <header className="pe-header">
                <div className="pe-title" title={current.rootPath}>
                    <strong>{current.name}</strong>
                    <span className="pe-path">{current.rootPath}</span>
                </div>
                <div className="pe-actions">
                    <button type="button" className="pe-icon-btn" onClick={openFolder} title="Abrir otra carpeta" aria-label="Abrir otra carpeta">
                        📂
                    </button>
                    <button type="button" className="pe-icon-btn" onClick={refresh} disabled={loading} title="Actualizar" aria-label="Actualizar">
                        ⟳
                    </button>
                    <button type="button" className="pe-icon-btn" onClick={closeProject} title="Cerrar proyecto" aria-label="Cerrar proyecto">
                        ✕
                    </button>
                </div>
            </header>

            {error && (
                <div className="pe-error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="pe-icon-btn" onClick={clearError} aria-label="Cerrar aviso">
                        ✕
                    </button>
                </div>
            )}

            <div className="pe-search">
                <input
                    type="search"
                    placeholder="Buscar archivos…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Buscar archivos"
                />
            </div>

            {modified.size > 0 && (
                <div className="pe-notice">
                    <span>
                        ● {modified.size} {modified.size === 1 ? 'archivo cambió' : 'archivos cambiaron'} en disco
                    </span>
                    <button type="button" className="pe-link" onClick={clearModified}>
                        Marcar como vistos
                    </button>
                </div>
            )}

            <div className="pe-tree">
                <FileTree
                    tree={tree}
                    expanded={expanded}
                    selected={selected}
                    modified={modified}
                    activePath={activeFile && activeFile.path}
                    forceExpand={Boolean(q)}
                    onToggleExpand={toggleExpand}
                    onToggleSelect={toggleSelect}
                    onOpenFile={handleOpenFile}
                />
                {q && <div className="pe-hint">La búsqueda solo incluye carpetas ya cargadas.</div>}
            </div>

            {current.truncated && (
                <div className="pe-notice pe-warn">
                    Proyecto muy grande: algunas carpetas se cargan al expandirlas y es posible que falten archivos.
                </div>
            )}

            <footer className="pe-footer">
                <span>
                    {selectedCount} {selectedCount === 1 ? 'archivo seleccionado' : 'archivos seleccionados'}
                </span>
                {selectedCount > 0 && (
                    <button type="button" className="pe-link" onClick={clearSelection}>
                        Limpiar
                    </button>
                )}
            </footer>
        </section>
    );
}