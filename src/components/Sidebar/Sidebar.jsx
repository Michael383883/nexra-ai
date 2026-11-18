import React from 'react';

export const SECTIONS = [
  { id: 'proyectos', icon: '📁', label: 'Proyectos', desc: 'Abrir y administrar proyectos' },
  { id: 'asistentes', icon: '🤖', label: 'Asistentes IA', desc: 'Claude, ChatGPT, Gemini' },
  { id: 'contexto', icon: '📄', label: 'Contexto', desc: 'Leer y preparar archivos' },
  { id: 'cambios', icon: '✏️', label: 'Editor de cambios', desc: 'Aplicar modificaciones al código' },
  { id: 'historial', icon: '🕘', label: 'Historial', desc: 'Instrucciones y recuperación de cambios' }
];

export default function Sidebar({ active, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="brand">NEXRA <span>AI</span></div>
      <nav>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={'nav-item' + (active === s.id ? ' active' : '')}
            onClick={() => onSelect(s.id)}
          >
            <span className="icon">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">v{window.nexra?.version ?? 'dev'}</div>
    </aside>
  );
}
