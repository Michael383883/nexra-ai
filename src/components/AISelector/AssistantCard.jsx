import React from 'react';
import { timeAgo } from '../../utils/format';

const STATUS_LABELS = {
    available: 'Disponible',
    open: 'Abierto',
    pending: 'Pendiente',
    disabled: 'Desactivado',
};

/**
 * Tarjeta de un asistente: estado, favorito, selección, abrir y configurar.
 */
export default function AssistantCard({
    assistant,
    browser,
    busy,
    onSelect,
    onOpen,
    onFavorite,
    onSettings,
    onMarkClosed,
    onEnable,
}) {
    const a = assistant;
    const stop = (handler) => (e) => {
        e.stopPropagation();
        handler();
    };

    const usesChrome = !a.settings.browserPath && browser && browser.found;
    const openLabel = busy
        ? 'Abriendo…'
        : a.status === 'open'
            ? 'Abrir otra vez'
            : usesChrome
                ? 'Abrir en Chrome'
                : a.settings.browserPath
                    ? 'Abrir en el navegador'
                    : 'Abrir en el navegador';

    return (
        <article
            className={`ai-card${a.selected ? ' is-selected' : ''}${a.enabled ? '' : ' is-disabled'}`}
            onClick={() => a.enabled && onSelect(a.id)}
            aria-current={a.selected ? 'true' : undefined}
        >
            <header className="ai-card-head">
                <span className="ai-avatar" style={{ background: a.color }} aria-hidden="true">
                    {a.icon}
                </span>
                <div className="ai-card-title">
                    <strong>{a.name}</strong>
                    <span>{a.vendor}</span>
                </div>
                <button
                    type="button"
                    className={`ai-star${a.favorite ? ' is-on' : ''}`}
                    onClick={stop(() => onFavorite(a.id))}
                    title={a.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                    aria-label={a.favorite ? `Quitar ${a.name} de favoritos` : `Añadir ${a.name} a favoritos`}
                    aria-pressed={a.favorite}
                >
                    {a.favorite ? '★' : '☆'}
                </button>
            </header>

            <p className="ai-card-desc">{a.description}</p>

            <div className="ai-card-status">
                <span className={`ai-status is-${a.status}`} title={a.statusDetail}>
                    {STATUS_LABELS[a.status]}
                </span>
                {a.selected && <span className="ai-chip">Elegido</span>}
                {a.lastOpenedAt && <span className="ai-last">Último uso {timeAgo(a.lastOpenedAt)}</span>}
            </div>

            {a.status === 'pending' && <p className="ai-warn">{a.statusDetail}</p>}

            <footer className="ai-card-actions">
                {a.enabled ? (
                    <>
                        <button type="button" className="ai-btn ai-btn-primary" onClick={stop(() => onOpen(a.id))} disabled={busy}>
                            {openLabel}
                        </button>
                        {a.status === 'open' && (
                            <button type="button" className="ai-btn" onClick={stop(() => onMarkClosed(a.id))} title="Chrome no avisa cuando cierras la pestaña">
                                Marcar cerrado
                            </button>
                        )}
                        <button type="button" className="ai-btn ai-btn-icon" onClick={stop(() => onSettings(a.id))} title="Configuración" aria-label={`Configuración de ${a.name}`}>
                            ⚙
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className="ai-btn ai-btn-primary" onClick={stop(() => onEnable(a.id, true))}>
                            Activar
                        </button>
                        <button type="button" className="ai-btn ai-btn-icon" onClick={stop(() => onSettings(a.id))} title="Configuración" aria-label={`Configuración de ${a.name}`}>
                            ⚙
                        </button>
                    </>
                )}
            </footer>
        </article>
    );
}