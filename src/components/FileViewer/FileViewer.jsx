import React, { useMemo, useState } from 'react';
import './FileViewer.css';
import { formatBytes } from '../../utils/format';
import { highlightLines } from './syntax';

const MENSAJES = {
    binary: 'Archivo binario: no se puede mostrar como texto.',
    'too-large': 'El archivo es demasiado grande para la vista previa.',
    'not-found': 'El archivo ya no existe en el disco.',
    outside: 'El archivo está fuera del proyecto.',
    sensitive: 'Archivo protegido: requiere autorización para abrirlo.',
};

/**
 * Visor de archivo (solo vista) con resaltado de sintaxis.
 * La lectura y la confirmación de archivos protegidos las hace useProject().openFile;
 * este componente muestra el resultado que queda en project.activeFile.
 *
 * @param {object} props.file         project.activeFile
 * @param {() => void} props.onClose  project.closeFile
 */
export default function FileViewer({ file, onClose }) {
    const [copied, setCopied] = useState(false);

    const failed = !file || file.ok === false;
    const content = !failed && typeof file.content === 'string' ? file.content : '';
    const extension = file ? file.extension || (file.node && file.node.extension) || '' : '';

    // Solo se vuelve a resaltar cuando cambia el contenido o el tipo de archivo
    const lines = useMemo(() => (failed ? [] : highlightLines(content, extension)), [failed, content, extension]);

    if (!file) return null;

    const name = file.name || (file.node && file.node.name) || 'archivo';
    const location = file.relativePath || (file.node && file.node.relativePath) || file.path;
    const authorized = Boolean(file.authorized);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (_) {
            /* sin permiso de portapapeles: se ignora */
        }
    };

    return (
        <section className="pi fv">
            <header className="fv-header">
                <div className="fv-title">
                    <div className="fv-name-row">
                        <strong>
                            {authorized ? '🔒 ' : ''}
                            {name}
                        </strong>
                        {!failed && file.language && <span className="fv-lang">{file.language}</span>}
                    </div>
                    <span className="fv-path" title={file.path}>
                        {location}
                    </span>
                    {!failed && (
                        <span className="fv-meta">
                            {file.lines} {file.lines === 1 ? 'línea' : 'líneas'} · {formatBytes(file.size)}
                        </span>
                    )}
                </div>
                <div className="fv-actions">
                    {!failed && (
                        <button type="button" className="fv-btn" onClick={copy}>
                            {copied ? '✓ Copiado' : 'Copiar'}
                        </button>
                    )}
                    <button type="button" className="fv-close" onClick={onClose} title="Cerrar archivo" aria-label="Cerrar archivo">
                        ✕
                    </button>
                </div>
            </header>

            {!failed && file.truncated && <div className="fv-notice">El archivo es largo: se muestra solo una parte.</div>}
            {!failed && authorized && (
                <div className="fv-notice">
                    Archivo protegido abierto con tu autorización. No se incluye automáticamente en el contexto de la IA.
                </div>
            )}
            {!failed && file.redactions > 0 && (
                <div className="fv-notice">Se ocultaron {file.redactions} valor(es) que parecían secretos.</div>
            )}

            <div className="fv-body">
                {failed ? (
                    <p className="fv-msg">{MENSAJES[file.reason] || file.error || 'No se pudo leer el archivo.'}</p>
                ) : (
                    <pre className="fv-code">
                        {lines.map((html, i) => (
                            <div className="fv-line" key={i}>
                                <span className="fv-num">{i + 1}</span>
                                {/* html lo genera highlight.js, que escapa el texto del archivo */}
                                <span className="fv-text" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
                            </div>
                        ))}
                    </pre>
                )}
            </div>
        </section>
    );
}