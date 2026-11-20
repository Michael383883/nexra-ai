import React from 'react';
import './ProjectInfo.css';
import { formatBytes, languageColor } from '../../utils/format';

const MAX_LANGUAGES = 6;

function LanguageBar({ languages }) {
    if (!languages.length) return null;

    const top = languages.slice(0, MAX_LANGUAGES);
    const rest = languages.slice(MAX_LANGUAGES);
    const restPercent = Math.round(rest.reduce((acc, l) => acc + l.percent, 0) * 10) / 10;
    const items = restPercent > 0 ? [...top, { name: 'Otros', percent: restPercent, files: rest.reduce((a, l) => a + l.files, 0) }] : top;

    return (
        <>
            <div className="pi-bar" role="img" aria-label="Distribución de lenguajes">
                {items.map((l) => (
                    <span
                        key={l.name}
                        style={{ width: `${l.percent}%`, background: l.name === 'Otros' ? '#6b6f7a' : languageColor(l.name) }}
                        title={`${l.name}: ${l.percent}%`}
                    />
                ))}
            </div>
            <ul className="pi-langs">
                {items.map((l) => (
                    <li key={l.name}>
                        <span className="pi-dot" style={{ background: l.name === 'Otros' ? '#6b6f7a' : languageColor(l.name) }} />
                        <span className="pi-lang-name">{l.name}</span>
                        <span className="pi-lang-pct">{l.percent}%</span>
                    </li>
                ))}
            </ul>
        </>
    );
}

function Section({ title, children }) {
    return (
        <div className="pi-section">
            <h4>{title}</h4>
            {children}
        </div>
    );
}

/**
 * Información del proyecto: tipo, lenguajes, frameworks, entradas, scripts.
 * @param {object} props.project  Objeto devuelto por useProject().
 */
export default function ProjectInfo({ project }) {
    const current = project && project.project;
    if (!current || !current.analysis) {
        return (
            <section className="pi pi-empty">
                <p>Abre un proyecto para ver su información.</p>
            </section>
        );
    }

    const a = current.analysis;
    const scripts = Object.entries(a.scripts || {});

    return (
        <section className="pi">
            <header className="pi-header">
                <h3>
                    {a.name}
                    {a.version && <span className="pi-version">v{a.version}</span>}
                </h3>
                <p className="pi-type">{a.type}</p>
                <div className="pi-badges">
                    {a.hasGit && <span className="pi-badge">Git</span>}
                    {a.packageManager && <span className="pi-badge">{a.packageManager}</span>}
                </div>
            </header>

            <div className="pi-stats">
                <div>
                    <strong>{a.stats.files}</strong>
                    <span>archivos</span>
                </div>
                <div>
                    <strong>{formatBytes(a.stats.totalBytes)}</strong>
                    <span>en total</span>
                </div>
                <div>
                    <strong>{a.dependencyCount}</strong>
                    <span>dependencias</span>
                </div>
            </div>

            {a.languages.length > 0 && (
                <Section title="Lenguajes">
                    <LanguageBar languages={a.languages} />
                </Section>
            )}

            {a.frameworks.length > 0 && (
                <Section title="Frameworks y librerías">
                    <div className="pi-chips">
                        {a.frameworks.map((f) => (
                            <span key={f} className="pi-chip">
                                {f}
                            </span>
                        ))}
                    </div>
                </Section>
            )}

            {a.entryPoints.length > 0 && (
                <Section title="Puntos de entrada">
                    <ul className="pi-files">
                        {a.entryPoints.map((f) => (
                            <li key={f}>{f}</li>
                        ))}
                    </ul>
                </Section>
            )}

            {a.importantFiles.length > 0 && (
                <Section title="Archivos importantes">
                    <ul className="pi-files">
                        {a.importantFiles.map((f) => (
                            <li key={f}>{f}</li>
                        ))}
                    </ul>
                </Section>
            )}

            {scripts.length > 0 && (
                <Section title="Scripts">
                    <ul className="pi-scripts">
                        {scripts.map(([name, cmd]) => (
                            <li key={name} title={cmd}>
                                <code>{name}</code>
                                <span>{cmd}</span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
        </section>
    );
}