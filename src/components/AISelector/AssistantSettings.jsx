import React, { useState } from 'react';

/**
 * Configuración individual de un asistente (3.1.6):
 * navegador, perfil de Chrome, ventana nueva y notas.
 * Se monta con key={assistant.id} para que el formulario se reinicie al cambiar de asistente.
 */
export default function AssistantSettings({ assistant, browser, onSave, onReset, onEnable, onRemove, onClose }) {
    const a = assistant;
    const [browserPath, setBrowserPath] = useState(a.settings.browserPath);
    const [profile, setProfile] = useState(a.settings.profile);
    const [newWindow, setNewWindow] = useState(a.settings.newWindow);
    const [notes, setNotes] = useState(a.settings.notes);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        const result = await onSave(a.id, { browserPath, profile, newWindow, notes });
        setSaving(false);
        if (result !== null) onClose();
    };

    const reset = async () => {
        const result = await onReset(a.id);
        if (result !== null) onClose();
    };

    const remove = async () => {
        if (!window.confirm(`¿Eliminar "${a.name}" de tu lista de asistentes?`)) return;
        const result = await onRemove(a.id);
        if (result !== null) onClose();
    };

    return (
        <section className="ai-settings" aria-label={`Configuración de ${a.name}`}>
            <header className="ai-settings-head">
                <h4>
                    <span className="ai-avatar ai-avatar-sm" style={{ background: a.color }} aria-hidden="true">
                        {a.icon}
                    </span>
                    Configuración de {a.name}
                </h4>
                <button type="button" className="ai-icon-btn" onClick={onClose} aria-label="Cerrar configuración">
                    ✕
                </button>
            </header>

            <label className="ai-check">
                <input type="checkbox" checked={a.enabled} onChange={(e) => onEnable(a.id, e.target.checked)} />
                Asistente activado
            </label>

            <label className="ai-field">
                <span>Navegador personalizado (opcional)</span>
                <input
                    type="text"
                    value={browserPath}
                    onChange={(e) => setBrowserPath(e.target.value)}
                    placeholder={browser && browser.path ? browser.path : 'Ruta completa del ejecutable (Edge, Brave, Chrome...)'}
                    spellCheck={false}
                />
                <small>
                    {browser && browser.found
                        ? 'Vacío = se usa el Chrome detectado en tu equipo.'
                        : 'No se encontró Chrome. Vacío = se usa el navegador predeterminado.'}
                </small>
            </label>

            <label className="ai-field">
                <span>Perfil de Chrome (opcional)</span>
                <input
                    type="text"
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                    placeholder="Default, Profile 1…"
                    spellCheck={false}
                />
                <small>Útil si usas una cuenta distinta para este asistente. Escribe chrome://version en Chrome y mira «Ruta del perfil».</small>
            </label>

            <label className="ai-check">
                <input type="checkbox" checked={newWindow} onChange={(e) => setNewWindow(e.target.checked)} />
                Abrir siempre en una ventana nueva
            </label>

            <label className="ai-field">
                <span>Notas</span>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ej.: cuenta de trabajo, plan Pro…" />
            </label>

            <footer className="ai-settings-actions">
                <button type="button" className="ai-btn ai-btn-primary" onClick={save} disabled={saving}>
                    {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="ai-btn" onClick={reset}>
                    Restablecer
                </button>
                {!a.builtin && (
                    <button type="button" className="ai-btn ai-btn-danger" onClick={remove}>
                        Eliminar
                    </button>
                )}
            </footer>
        </section>
    );
}