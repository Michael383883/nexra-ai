import React from 'react';
import './FileTree.css';
import { formatBytes, languageColor } from '../../utils/format';

/** Cuenta archivos seleccionables y marcados dentro de una carpeta (solo lo cargado). */
function selectionInfo(node, selected) {
    let total = 0;
    let checked = 0;
    (function walk(n) {
        if (n.type === 'file') {
            if (n.readable) {
                total += 1;
                if (selected.has(n.path)) checked += 1;
            }
        } else if (n.children) {
            n.children.forEach(walk);
        }
    })(node);
    return { total, checked };
}

function TreeNode({ node, depth, ctx }) {
    const { expanded, selected, modified, activePath, forceExpand, onToggleExpand, onToggleSelect, onOpenFile } = ctx;

    const isDir = node.type === 'directory';
    const isOpen = isDir && (forceExpand || expanded.has(node.path));
    const isActive = !isDir && node.path === activePath;
    const isModified = !isDir && modified.has(node.path);

    let checkState = null; // 'all' | 'some' | 'none' | null (sin checkbox)
    if (isDir) {
        const info = selectionInfo(node, selected);
        if (info.total > 0) {
            checkState = info.checked === 0 ? 'none' : info.checked === info.total ? 'all' : 'some';
        }
    } else if (node.readable) {
        checkState = selected.has(node.path) ? 'all' : 'none';
    }

    const activate = () => (isDir ? onToggleExpand(node) : onOpenFile(node));

    const onKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
        } else if (e.key === 'ArrowRight' && isDir && !isOpen) {
            e.preventDefault();
            onToggleExpand(node);
        } else if (e.key === 'ArrowLeft' && isDir && isOpen) {
            e.preventDefault();
            onToggleExpand(node);
        }
    };

    return (
        <li role="none">
            <div
                className={`ft-row${isActive ? ' is-active' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                role="treeitem"
                aria-expanded={isDir ? isOpen : undefined}
                aria-selected={isActive}
                tabIndex={0}
                onClick={activate}
                onKeyDown={onKeyDown}
                title={node.relativePath}
            >
                <span className="ft-chevron" aria-hidden="true">
                    {isDir ? (isOpen ? '▾' : '▸') : ''}
                </span>

                {checkState && (
                    <input
                        type="checkbox"
                        className="ft-check"
                        checked={checkState === 'all'}
                        ref={(el) => {
                            if (el) el.indeterminate = checkState === 'some';
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onToggleSelect(node)}
                        aria-label={`Incluir ${node.name} en el contexto`}
                    />
                )}

                {isDir ? (
                    <span className="ft-icon" aria-hidden="true">
                        {isOpen ? '📂' : '📁'}
                    </span>
                ) : node.sensitive ? (
                    <span className="ft-icon" title="Archivo protegido: puede contener secretos">
                        🔒
                    </span>
                ) : (
                    <span className="ft-dot" style={{ background: languageColor(node.language) }} title={node.language} />
                )}

                <span className={`ft-name${node.sensitive ? ' is-sensitive' : ''}`}>{node.name}</span>

                {isModified && (
                    <span className="ft-modified" title="Modificado en disco" aria-label="Modificado">
                        ●
                    </span>
                )}
                {!isDir && <span className="ft-size">{formatBytes(node.size)}</span>}
            </div>

            {isOpen && (
                <ul role="group" className="ft-list">
                    {node.children === null && (
                        <li className="ft-loading" style={{ paddingLeft: 30 + depth * 14 }}>
                            Cargando…
                        </li>
                    )}
                    {(node.children || []).map((child) => (
                        <TreeNode key={child.path} node={child} depth={depth + 1} ctx={ctx} />
                    ))}
                </ul>
            )}
        </li>
    );
}

/**
 * Árbol de directorios con expandir/contraer, selección y estado de cambios.
 */
export default function FileTree({
    tree,
    expanded,
    selected,
    modified,
    activePath,
    forceExpand = false,
    onToggleExpand,
    onToggleSelect,
    onOpenFile,
}) {
    if (!tree) return null;
    const ctx = { expanded, selected, modified, activePath, forceExpand, onToggleExpand, onToggleSelect, onOpenFile };
    const children = tree.children || [];

    if (!children.length) {
        return <div className="ft-empty">{forceExpand ? 'Sin coincidencias.' : 'Carpeta vacía.'}</div>;
    }

    return (
        <ul role="tree" className="ft-list ft-root">
            {children.map((child) => (
                <TreeNode key={child.path} node={child} depth={0} ctx={ctx} />
            ))}
        </ul>
    );
}