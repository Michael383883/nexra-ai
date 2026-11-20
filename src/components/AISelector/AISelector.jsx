import React, { useState } from 'react';
import './AISelector.css';
import AssistantCard from './AssistantCard';
import AssistantSettings from './AssistantSettings';
import SessionPanel from './SessionPanel';

function CustomAssistantForm({ onAdd }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        const result = await onAdd({ name, url });
        if (result !== null) {
            setName('');
            setUrl('');
            setOpen(false);
        }
    };

    if (!open) {
        return (
            <button type="button" className="ai-btn ai-add" onClick={() => setOpen(true)}>
                + Añadir asistente
            </button>
        );
    }

    return (
        <form className="ai-custom" onSubmit={submit}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Mi LLM local)" maxLength={40} aria-label="Nombre del asistente" />
            <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" spellCheck={false} aria-label="URL del asistente" />
            <div className="ai-custom-actions">
                <button type="submit" className="ai-btn ai-btn-primary">
                    Añadir
                </button>
                <button type="button" className="ai-btn" onClick={() => setOpen(false)}>
                    Cancelar
                </button>
            </div>
            <small>Solo https://. Se permite http:// únicamente para localhost.</small>
        </form>
    );
}

/**
 * Panel central de asistentes IA (Fase 3.1).
 * @param {object} props.ai        Objeto devuelto por useAssistants().
 * @param {object} [props.project] Objeto devuelto por useProject() (opcional, para las sesiones).
 */
export default function AISelector({ ai, project }) {
    const [settingsId, setSettingsId] = useState(null);
    const [onlyFavorites, setOnlyFavorites] = useState(false);

    const {
        assistants,
        browser,
        loading,
        busyId,
        error,
        notice,
        select,
        open,
        toggleFavorite,
        setEnabled,
        markClosed,
        saveSettings,
        resetSettings,
        addCustom,
        removeCustom,
        clearError,
        selected,
    } = ai;

    if (loading) {
        return (
            <div className="ai-layout">
                <p className="ai-loading">Cargando asistentes…</p>
            </div>
        );
    }

    const visible = onlyFavorites ? assistants.filter((a) => a.favorite) : assistants;
    const settingsAssistant = settingsId ? assistants.find((a) => a.id === settingsId) : null;
    const favoriteCount = assistants.filter((a) => a.favorite).length;

    return (
        <div className="ai-layout">
            <section className="ai-main" aria-label="Catálogo de asistentes">
                <header className="ai-header">
                    <div>
                        <h3>Asistentes IA</h3>
                        <p className="ai-sub">
                            {selected ? (
                                <>
                                    Elegido: <strong>{selected.name}</strong>
                                </>
                            ) : (
                                'No hay ningún asistente activo.'
                            )}
                        </p>
                    </div>
                    <label className="ai-check">
                        <input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />
                        Solo favoritos ({favoriteCount})
                    </label>
                </header>

                <div className={`ai-browser${browser && browser.found ? '' : ' is-missing'}`}>
                    {browser && browser.found
                        ? `Chrome detectado: ${browser.path}`
                        : 'No se encontró Chrome. Los asistentes se abrirán en el navegador predeterminado.'}
                </div>

                {error && (
                    <div className="ai-error" role="alert">
                        <span>{error}</span>
                        <button type="button" className="ai-icon-btn" onClick={clearError} aria-label="Cerrar aviso">
                            ✕
                        </button>
                    </div>
                )}
                {notice && (
                    <div className="ai-notice" role="status">
                        {notice}
                    </div>
                )}

                {settingsAssistant && (
                    <AssistantSettings
                        key={settingsAssistant.id}
                        assistant={settingsAssistant}
                        browser={browser}
                        onSave={saveSettings}
                        onReset={resetSettings}
                        onEnable={setEnabled}
                        onRemove={removeCustom}
                        onClose={() => setSettingsId(null)}
                    />
                )}

                {visible.length === 0 ? (
                    <p className="ai-empty">Aún no marcaste favoritos. Pulsa ☆ en un asistente para añadirlo.</p>
                ) : (
                    <div className="ai-grid">
                        {visible.map((a) => (
                            <AssistantCard
                                key={a.id}
                                assistant={a}
                                browser={browser}
                                busy={busyId === a.id}
                                onSelect={select}
                                onOpen={open}
                                onFavorite={toggleFavorite}
                                onSettings={setSettingsId}
                                onMarkClosed={markClosed}
                                onEnable={setEnabled}
                            />
                        ))}
                    </div>
                )}

                <CustomAssistantForm onAdd={addCustom} />
            </section>

            <SessionPanel ai={ai} project={project} />
        </div>
    );
}