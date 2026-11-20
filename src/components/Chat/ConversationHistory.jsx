import React from 'react';
import './Chat.css';
import { timeAgo } from '../../utils/format';

/**
 * Historial de conversaciones (3.2.5).
 * @param {object} props.chat     Objeto devuelto por useConversation().
 * @param {object} [props.ai]     Objeto devuelto por useAssistants() (para mostrar nombres).
 * @param {(id: string) => void} [props.onOpen]  Se llama al abrir una conversación.
 */
export default function ConversationHistory({ chat, ai, onOpen }) {
    const { conversations, error, clearError, deleteConversation } = chat;

    const assistantName = (id) => {
        const found = ai && ai.assistants ? ai.assistants.find((a) => a.id === id) : null;
        return found ? found.name : id || '—';
    };

    const remove = (c) => {
        if (window.confirm(`¿Eliminar la conversación "${c.title}" y sus archivos recibidos? No se puede deshacer.`)) {
            deleteConversation(c.id);
        }
    };

    return (
        <section className="ch-history">
            <header className="ch-history-head">
                <h3>Historial de conversaciones</h3>
                <span className="chat-sub">{conversations.length} {conversations.length === 1 ? 'conversación' : 'conversaciones'}</span>
            </header>

            {error && (
                <div className="chat-error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="chat-icon-btn" onClick={clearError} aria-label="Cerrar aviso">✕</button>
                </div>
            )}

            {conversations.length === 0 ? (
                <p className="chat-empty">Aún no hay conversaciones. Prepara y envía una consulta desde la sección Contexto.</p>
            ) : (
                <ul className="ch-history-list">
                    {conversations.map((c) => (
                        <li key={c.id} className="ch-history-item">
                            <div className="ch-history-main">
                                <strong>{c.title}</strong>
                                <span className="chat-sub">
                                    {c.projectName ? `${c.projectName} · ` : ''}
                                    {assistantName(c.assistantId)} · {c.turnCount} {c.turnCount === 1 ? 'consulta' : 'consultas'} · {timeAgo(c.updatedAt)}
                                    {c.pendingResponse ? ' · esperando respuesta' : ''}
                                </span>
                            </div>
                            <div className="ch-history-actions">
                                <button type="button" className="chat-btn" onClick={async () => { await chat.selectConversation(c.id); if (onOpen) onOpen(c.id); }}>
                                    Abrir
                                </button>
                                <button type="button" className="chat-icon-btn" onClick={() => remove(c)} title="Eliminar" aria-label={`Eliminar ${c.title}`}>
                                    🗑
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}