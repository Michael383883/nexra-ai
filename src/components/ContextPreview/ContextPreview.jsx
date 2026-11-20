import React, { useState } from 'react';
import './ContextPreview.css';
import { formatTokens } from '../../utils/format';

const TOKEN_OPTIONS = [8000, 16000, 30000, 60000, 100000];
const PREVIEW_LIMIT = 20000; // caracteres mostrados; el copiado siempre es completo

const SKIP_REASONS = {
    sensitive: 'protegido (posibles secretos)',
    binary: 'archivo binario',
    budget: 'sin presupuesto de tokens',
    'outside-project': 'fuera del proyecto',
    'not-found': 'ya no existe',
    error: 'error de lectura',
};

/**
 * Vista previa del contexto que se enviará a la IA.
 * @param {object} props.project  Objeto devuelto por useProject().
 * @param {(text: string) => void} [props.onUseContext]  Callback opcional (p. ej. enviar al chat).
 */
export default function ContextPreview({ project, onUseContext }) {
    const [copied, setCopied] = useState(false);
    const { project: current, context, contextLoading, contextOptions, updateContextOptions, selectedCount } = project;

    if (!current) {
        return (
            <section className="cp cp-empty">
                <p>Abre un proyecto para generar contexto.</p>
            </section>
        );
    }

    const used = context ? context.estimatedTokens : 0;
    const max = contextOptions.maxTokens;
    const percent = Math.min(100, Math.round((used / max) * 100));
    const level = percent >= 95 ? 'is-full' : percent >= 75 ? 'is-high' : '';

    const copy = async () => {
        if (!context) return;
        try {
            await navigator.clipboard.writeText(context.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (_) {
            setCopied(false);
        }
    };

    const text = context ? context.text : '';
    const shown = text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n\n… (vista previa recortada; el contenido completo se copia)` : text;

    return (
        <section className="cp">
            <header className="cp-header">
                <h3>Contexto para la IA</h3>
                <span className="cp-sub">{selectedCount} {selectedCount === 1 ? 'archivo' : 'archivos'}</span>
            </header>

            <div className="cp-options">
                <label>
                    <input type="checkbox" checked={contextOptions.includeAnalysis} onChange={(e) => updateContextOptions({ includeAnalysis: e.target.checked })} />
                    Resumen del proyecto
                </label>
                <label>
                    <input type="checkbox" checked={contextOptions.includeTree} onChange={(e) => updateContextOptions({ includeTree: e.target.checked })} />
                    Estructura de carpetas
                </label>
                <label title="Reemplaza claves y contraseñas reconocibles por [REDACTED]">
                    <input type="checkbox" checked={contextOptions.redact} onChange={(e) => updateContextOptions({ redact: e.target.checked })} />
                    Ocultar secretos
                </label>
                <label className="cp-select">
                    Límite
                    <select value={max} onChange={(e) => updateContextOptions({ maxTokens: Number(e.target.value) })}>
                        {TOKEN_OPTIONS.map((n) => (
                            <option key={n} value={n}>
                                {formatTokens(n)} tokens
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <textarea
                className="cp-instructions"
                rows={2}
                placeholder="Instrucciones para la IA (opcional)…"
                value={contextOptions.instructions}
                onChange={(e) => updateContextOptions({ instructions: e.target.value })}
                aria-label="Instrucciones para la IA"
            />

            <div className="cp-meter" aria-live="polite">
                <div className="cp-meter-track">
                    <div className={`cp-meter-fill ${level}`} style={{ width: `${percent}%` }} />
                </div>
                <span>
                    {contextLoading ? 'Calculando…' : `${formatTokens(used)} / ${formatTokens(max)} tokens (≈)`}
                </span>
            </div>

            {context && context.redactions > 0 && (
                <div className="cp-note">🔐 {context.redactions} {context.redactions === 1 ? 'secreto ocultado' : 'secretos ocultados'}</div>
            )}

            {context && context.skipped.length > 0 && (
                <div className="cp-skipped">
                    <strong>Omitidos</strong>
                    <ul>
                        {context.skipped.map((s) => (
                            <li key={s.path}>
                                <code>{s.path}</code> — {SKIP_REASONS[s.reason] || s.reason}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {context && context.included.length > 0 && (
                <details className="cp-included">
                    <summary>{context.included.length} {context.included.length === 1 ? 'archivo incluido' : 'archivos incluidos'}</summary>
                    <ul>
                        {context.included.map((f) => (
                            <li key={f.path}>
                                <code>{f.path}</code>
                                <span>
                                    {formatTokens(f.tokens)}
                                    {f.truncated ? ' · truncado' : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            <pre className="cp-text" tabIndex={0}>
                {shown || 'Aún no hay contexto.'}
            </pre>

            <div className="cp-actions">
                <button type="button" className="cp-btn cp-btn-primary" onClick={copy} disabled={!context || contextLoading}>
                    {copied ? 'Copiado ✓' : 'Copiar contexto'}
                </button>
                {onUseContext && (
                    <button type="button" className="cp-btn" onClick={() => onUseContext(text)} disabled={!context || contextLoading}>
                        Usar en el chat
                    </button>
                )}
            </div>
        </section>
    );
}