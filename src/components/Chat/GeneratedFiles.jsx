import React, { useState } from 'react';
import { formatBytes } from '../../utils/format';

const STATUS = {
    new: ['Nuevo', 'is-new'],
    modified: ['Modificado', 'is-modified'],
    identical: ['Sin cambios', 'is-identical'],
    protected: ['Protegido', 'is-protected'],
    fragment: ['Fragmento', 'is-fragment'],
    unknown: ['—', 'is-fragment'],
};

/**
 * Archivos generados por una respuesta (3.2.6): ver, copiar y mostrar en carpeta.
 * Los archivos NO se escriben en el proyecto: quedan en una zona de preparación.
 */
export default function GeneratedFiles({ turnId, files, onRead, onCopy, onReveal }) {
    const [openPath, setOpenPath] = useState(null);
    const [content, setContent] = useState('');

    if (!files || !files.length) return null;

    const toggle = async (file) => {
        if (openPath === file.path) {
            setOpenPath(null);
            return;
        }
        const text = await onRead(turnId, file.path);
        if (text !== null && text !== undefined) {
            setContent(text);
            setOpenPath(file.path);
        }
    };

    return (
        <div className="gf">
            <h5>Archivos recibidos ({files.length})</h5>
            <ul>
                {files.map((f) => {
                    const [label, cls] = STATUS[f.status] || STATUS.unknown;
                    return (
                        <li key={f.path} className="gf-item">
                            <div className="gf-row">
                                <code className="gf-path" title={f.path}>{f.path}</code>
                                <span className={`gf-status ${cls}`}>{f.command ? 'Comando' : label}</span>
                                <span className="gf-meta">{f.lines} líneas · {formatBytes(f.bytes)}</span>
                                <span className="gf-actions">
                                    <button type="button" className="chat-link" onClick={() => toggle(f)} disabled={!f.stored}>
                                        {openPath === f.path ? 'Ocultar' : 'Ver'}
                                    </button>
                                    <button type="button" className="chat-link" onClick={() => onCopy(turnId, f.path)} disabled={!f.stored}>
                                        Copiar
                                    </button>
                                    <button type="button" className="chat-link" onClick={() => onReveal(turnId, f.path)} disabled={!f.stored}>
                                        Carpeta
                                    </button>
                                </span>
                            </div>
                            {f.sensitive && (
                                <p className="gf-warn">Este archivo parece contener secretos (claves, contraseñas). Revísalo con cuidado antes de usarlo.</p>
                            )}
                            {openPath === f.path && <pre className="gf-content">{content}</pre>}
                        </li>
                    );
                })}
            </ul>
            <p className="gf-note">Quedan en una zona de preparación; todavía no se aplican a tu proyecto.</p>
        </div>
    );
}