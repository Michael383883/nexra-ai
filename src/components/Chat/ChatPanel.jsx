import React, { useState } from 'react';
import './Chat.css';
import GeneratedFiles from './GeneratedFiles';
import { formatTokens, timeAgo } from '../../utils/format';

const LIMIT_OPTIONS = [8000, 16000, 30000, 60000, 100000, 200000];

function ResponseBox({ chat, turn }) {
    const [text, setText] = useState('');
    const { busy, readClipboard, recordResponse } = chat;

    const paste = async () => {
        const clip = await readClipboard();
        if (clip !== null && clip !== undefined) setText(clip);
    };
    const save = async () => {
        const result = await recordResponse(text, turn ? turn.id : undefined);
        if (result) setText('');
    };

    return (
        <div className="chat-response">
            <label htmlFor="chat-response-input">Respuesta del asistente</label>
            <textarea
                id="chat-response-input"
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Copia la respuesta en el asistente y pulsa «Pegar del portapapeles»…"
            />
            <div className="chat-row">
                <button type="button" className="chat-btn" onClick={paste}>Pegar del portapapeles</button>
                <button type="button" className="chat-btn chat-btn-primary" onClick={save} disabled={!text.trim() || busy === 'recording'}>
                    {busy === 'recording' ? 'Guardando…' : 'Guardar respuesta'}
                </button>
                <span className="chat-sub">{text.length ? `${text.length} caracteres` : ''}</span>
            </div>
        </div>
    );
}

function Turn({ turn, chat, assistantName }) {
    return (
        <li className="chat-turn">
            <div className="chat-bubble chat-you">
                <div className="chat-bubble-head">
                    <strong>Tú</strong>
                    <span className="chat-sub">
                        {assistantName(turn.assistantId)} · {timeAgo(turn.createdAt)}
                    </span>
                </div>
                <p>{turn.instruction}</p>
                <small className="chat-sub">
                    ≈{formatTokens(turn.messageTokens)} tokens · {turn.files.length} {turn.files.length === 1 ? 'archivo' : 'archivos'}
                    {turn.unchanged && turn.unchanged.length ? ` (+${turn.unchanged.length} sin cambios)` : ''}
                    {turn.mode === 'continue' ? ' · continuación' : ''}
                    {turn.truncated ? ' · recortado por el límite' : ''}
                </small>
            </div>

            {turn.response ? (
                <div className="chat-bubble chat-ai">
                    <div className="chat-bubble-head">
                        <strong>{assistantName(turn.assistantId)}</strong>
                        <span className="chat-sub">{turn.response.chars} caracteres · {timeAgo(turn.response.receivedAt)}</span>
                    </div>
                    <details>
                        <summary>Ver respuesta completa</summary>
                        <pre className="chat-text">{turn.response.text}</pre>
                    </details>
                    {turn.response.warnings.length > 0 && (
                        <ul className="chat-warnings">
                            {turn.response.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                    )}
                    <GeneratedFiles
                        turnId={turn.id}
                        files={turn.response.files}
                        onRead={chat.readGenerated}
                        onCopy={chat.copyGenerated}
                        onReveal={chat.revealGenerated}
                    />
                </div>
            ) : (
                <div className="chat-pending">Esperando la respuesta del asistente…</div>
            )}
        </li>
    );
}

/**
 * Flujo de mensajes con los asistentes (Fase 3.2): preparar, enviar y recuperar la respuesta.
 * @param {object} props.chat     Objeto devuelto por useConversation().
 * @param {object} props.project  Objeto devuelto por useProject().
 * @param {object} props.ai       Objeto devuelto por useAssistants().
 */
export default function ChatPanel({ chat, project, ai }) {
    const {
        current, pendingTurn, instruction, setInstruction, mode, setMode, draft, stale, lastSent, settings, limit,
        busy, error, notice, prepare, send, copyAgain, newConversation, updateSettings, setLimit, clearError,
    } = chat;

    const selected = ai ? ai.selected : null;
    const assistantName = (id) => {
        const found = ai && ai.assistants ? ai.assistants.find((a) => a.id === id) : null;
        return found ? found.name : id || '—';
    };
    const hasProject = Boolean(project && project.project);
    const canContinue = Boolean(current && current.turns.length);
    const limits = LIMIT_OPTIONS.includes(limit) ? LIMIT_OPTIONS : [...LIMIT_OPTIONS, limit].sort((a, b) => a - b);

    const stats = draft ? draft.stats : null;
    const percent = stats ? Math.min(100, Math.round((stats.tokens / stats.maxTokens) * 100)) : 0;
    const level = percent >= 95 ? 'is-full' : percent >= 75 ? 'is-high' : '';
    const ready = Boolean(draft) && !stale;

    return (
        <section className="chat">
            <header className="chat-head">
                <div>
                    <h3>{current ? current.title : 'Nueva conversación'}</h3>
                    <p className="chat-sub">
                        Asistente: <strong>{selected ? selected.name : 'ninguno (elígelo en Asistentes IA)'}</strong>
                        {current && current.projectName ? ` · Proyecto: ${current.projectName}` : hasProject ? ` · Proyecto: ${project.project.name}` : ''}
                    </p>
                </div>
                {current && (
                    <button type="button" className="chat-btn" onClick={newConversation}>+ Nueva conversación</button>
                )}
            </header>

            {error && (
                <div className="chat-error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="chat-icon-btn" onClick={clearError} aria-label="Cerrar aviso">✕</button>
                </div>
            )}
            {notice && <div className="chat-notice" role="status">{notice}</div>}

            {/* ───────── Redactar ───────── */}
            <div className="chat-composer">
                <label htmlFor="chat-instruction">Instrucción</label>
                <textarea
                    id="chat-instruction"
                    rows={4}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="Qué quieres que haga el asistente (ej.: «Agrega validación al formulario de login»)…"
                />

                {!hasProject && (
                    <p className="chat-hint">No hay proyecto abierto: el mensaje llevará solo tu instrucción. Abre uno en la sección Proyectos para incluir su contexto.</p>
                )}
                {hasProject && (
                    <p className="chat-hint">{project.selectedCount} {project.selectedCount === 1 ? 'archivo seleccionado' : 'archivos seleccionados'} en el explorador.</p>
                )}

                <div className="chat-row chat-options">
                    <label className="chat-check" title="Nueva: envía el contexto completo y un resumen de la conversación. Continuar: solo reenvía lo que cambió.">
                        <input type="radio" name="chat-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
                        Chat nuevo en el asistente
                    </label>
                    <label className="chat-check" title="Úsalo si sigues en la misma pestaña del asistente.">
                        <input type="radio" name="chat-mode" checked={mode === 'continue'} disabled={!canContinue} onChange={() => setMode('continue')} />
                        Continuar el mismo chat
                    </label>
                    <label className="chat-select">
                        Límite
                        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                            {limits.map((n) => <option key={n} value={n}>{formatTokens(n)} tokens</option>)}
                        </select>
                    </label>
                </div>

                {settings && (
                    <div className="chat-row chat-options">
                        <label className="chat-check">
                            <input type="checkbox" checked={settings.autoCopy} onChange={(e) => updateSettings({ autoCopy: e.target.checked })} />
                            Copiar automáticamente
                        </label>
                        <label className="chat-check">
                            <input type="checkbox" checked={settings.autoOpen} onChange={(e) => updateSettings({ autoOpen: e.target.checked })} />
                            Abrir el asistente
                        </label>
                        <label className="chat-check">
                            <input type="checkbox" checked={settings.includeHistory} onChange={(e) => updateSettings({ includeHistory: e.target.checked })} />
                            Incluir resumen anterior
                        </label>
                    </div>
                )}

                <div className="chat-row">
                    <button type="button" className="chat-btn" onClick={prepare} disabled={!instruction.trim() || !selected || busy === 'preparing'}>
                        {busy === 'preparing' ? 'Preparando…' : 'Preparar mensaje'}
                    </button>
                    <button type="button" className="chat-btn chat-btn-primary" onClick={send} disabled={!ready || busy === 'sending'}>
                        {busy === 'sending' ? 'Enviando…' : `Copiar y abrir ${selected ? selected.name : 'asistente'}`}
                    </button>
                </div>

                {draft && (
                    <div className={`chat-draft${stale ? ' is-stale' : ''}`}>
                        {stale && <p className="chat-warn">Cambiaste algo después de preparar el mensaje. Vuelve a pulsar «Preparar mensaje».</p>}
                        <div className="chat-meter">
                            <div className="chat-meter-track"><div className={`chat-meter-fill ${level}`} style={{ width: `${percent}%` }} /></div>
                            <span>≈{formatTokens(stats.tokens)} / {formatTokens(stats.maxTokens)} tokens · {stats.chars} caracteres</span>
                        </div>
                        {stats.files.length > 0 && <p className="chat-sub">Archivos incluidos: {stats.files.join(', ')}</p>}
                        {stats.unchanged.length > 0 && <p className="chat-sub">Sin cambios desde el último envío (no se reenvían): {stats.unchanged.join(', ')}</p>}
                        {stats.redactions > 0 && <p className="chat-sub">🔐 {stats.redactions} {stats.redactions === 1 ? 'secreto ocultado' : 'secretos ocultados'}.</p>}
                        {stats.warnings.length > 0 && (
                            <ul className="chat-warnings">{stats.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                        )}
                        <details>
                            <summary>Vista previa del mensaje</summary>
                            <pre className="chat-text">{draft.text.length > 20000 ? `${draft.text.slice(0, 20000)}\n\n… (vista previa recortada; el mensaje completo se copia)` : draft.text}</pre>
                        </details>
                    </div>
                )}
            </div>

            {/* ───────── Conversación ───────── */}
            {current && (
                <>
                    <div className="chat-bar">
                        <h4>Conversación</h4>
                        {lastSent && (
                            <button type="button" className="chat-link" onClick={copyAgain}>Copiar de nuevo el último mensaje</button>
                        )}
                    </div>
                    <ul className="chat-thread">
                        {current.turns.map((turn) => (
                            <Turn key={turn.id} turn={turn} chat={chat} assistantName={assistantName} />
                        ))}
                    </ul>
                    {pendingTurn ? (
                        <ResponseBox key={pendingTurn.id} chat={chat} turn={pendingTurn} />
                    ) : (
                        <details className="chat-manual">
                            <summary>Registrar una respuesta sin consulta previa</summary>
                            <ResponseBox key="manual" chat={chat} turn={null} />
                        </details>
                    )}
                </>
            )}
        </section>
    );
}