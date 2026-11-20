import React, { useEffect, useState } from 'react';
import { timeAgo } from '../../utils/format';

/**
 * Sesiones de trabajo (3.1.4): crear, activar, renombrar, archivar y eliminar.
 * @param {object} props.ai       Objeto devuelto por useAssistants().
 * @param {object} [props.project] Objeto devuelto por useProject() (para vincular el proyecto abierto).
 */
export default function SessionPanel({ ai, project }) {
    const {
        sessions,
        assistants,
        activeSessionId,
        activeSession,
        createSession,
        renameSession,
        setSessionNotes,
        activateSession,
        archiveSession,
        restoreSession,
        deleteSession,
    } = ai;

    const current = project && project.project;
    const [name, setName] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [renamingId, setRenamingId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [notes, setNotes] = useState('');

    // El campo de notas sigue a la sesión activa
    useEffect(() => {
        setNotes(activeSession ? activeSession.notes : '');
    }, [activeSession && activeSession.id, activeSession && activeSession.notes]); // eslint-disable-line react-hooks/exhaustive-deps

    const assistantName = (id) => {
        const found = assistants.find((a) => a.id === id);
        return found ? found.name : id;
    };

    const create = async (e) => {
        e.preventDefault();
        const result = await createSession({ name, projectPath: current ? current.rootPath : '' });
        if (result !== null) setName('');
    };

    const startRename = (session) => {
        setRenamingId(session.id);
        setRenameValue(session.name);
    };

    const commitRename = async () => {
        const id = renamingId;
        setRenamingId(null);
        if (id) await renameSession(id, renameValue);
    };

    const remove = (session) => {
        if (window.confirm(`¿Eliminar la sesión "${session.name}"? Esta acción no se puede deshacer.`)) {
            deleteSession(session.id);
        }
    };

    const visible = sessions.filter((s) => showArchived || !s.archived);
    const archivedCount = sessions.filter((s) => s.archived).length;

    return (
        <section className="ss" aria-label="Sesiones de trabajo">
            <header className="ss-head">
                <h3>Sesiones de trabajo</h3>
                <span className="ss-sub">{current ? `Proyecto: ${current.name}` : 'Sin proyecto abierto'}</span>
            </header>

            <form className="ss-new" onSubmit={create}>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nombre de la sesión (opcional)"
                    maxLength={80}
                    aria-label="Nombre de la nueva sesión"
                />
                <button type="submit" className="ai-btn ai-btn-primary">
                    Nueva sesión
                </button>
            </form>

            {visible.length === 0 ? (
                <p className="ss-empty">
                    Aún no tienes sesiones. Crea una para agrupar el trabajo de un proyecto con tus asistentes.
                </p>
            ) : (
                <ul className="ss-list">
                    {visible.map((s) => {
                        const isActive = s.id === activeSessionId;
                        return (
                            <li key={s.id} className={`ss-item${isActive ? ' is-active' : ''}${s.archived ? ' is-archived' : ''}`}>
                                <div className="ss-main">
                                    {renamingId === s.id ? (
                                        <input
                                            className="ss-rename"
                                            autoFocus
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onBlur={commitRename}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitRename();
                                                if (e.key === 'Escape') setRenamingId(null);
                                            }}
                                            maxLength={80}
                                            aria-label="Nuevo nombre de la sesión"
                                        />
                                    ) : (
                                        <strong className="ss-name">
                                            {s.name}
                                            {isActive && <span className="ai-chip">Activa</span>}
                                            {s.archived && <span className="ai-chip ai-chip-muted">Archivada</span>}
                                        </strong>
                                    )}
                                    <span className="ss-meta">
                                        {s.projectName ? `${s.projectName} · ` : ''}
                                        {s.assistantId ? `${assistantName(s.assistantId)} · ` : ''}
                                        {s.openCount} {s.openCount === 1 ? 'apertura' : 'aperturas'} · {timeAgo(s.updatedAt)}
                                    </span>
                                </div>

                                <div className="ss-actions">
                                    {!s.archived && (
                                        <button type="button" className="ai-icon-btn" onClick={() => activateSession(isActive ? null : s.id)} title={isActive ? 'Desactivar' : 'Activar'} aria-label={isActive ? `Desactivar ${s.name}` : `Activar ${s.name}`}>
                                            {isActive ? '⏸' : '▶'}
                                        </button>
                                    )}
                                    <button type="button" className="ai-icon-btn" onClick={() => startRename(s)} title="Renombrar" aria-label={`Renombrar ${s.name}`}>
                                        ✎
                                    </button>
                                    {s.archived ? (
                                        <button type="button" className="ai-icon-btn" onClick={() => restoreSession(s.id)} title="Restaurar" aria-label={`Restaurar ${s.name}`}>
                                            ↩
                                        </button>
                                    ) : (
                                        <button type="button" className="ai-icon-btn" onClick={() => archiveSession(s.id)} title="Archivar" aria-label={`Archivar ${s.name}`}>
                                            🗄
                                        </button>
                                    )}
                                    <button type="button" className="ai-icon-btn" onClick={() => remove(s)} title="Eliminar" aria-label={`Eliminar ${s.name}`}>
                                        🗑
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {archivedCount > 0 && (
                <label className="ai-check ss-toggle">
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                    Mostrar archivadas ({archivedCount})
                </label>
            )}

            {activeSession && (
                <div className="ss-notes">
                    <label htmlFor="ss-notes-input">Notas de «{activeSession.name}»</label>
                    <textarea
                        id="ss-notes-input"
                        rows={3}
                        value={notes}
                        maxLength={2000}
                        onChange={(e) => setNotes(e.target.value)}
                        onBlur={() => notes !== activeSession.notes && setSessionNotes(activeSession.id, notes)}
                        placeholder="Qué estás haciendo, qué falta, decisiones tomadas…"
                    />
                    <small>Se guardan al salir del campo.</small>
                </div>
            )}
        </section>
    );
}