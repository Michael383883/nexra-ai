import React, { useState } from 'react';
import Sidebar, { SECTIONS } from './components/Sidebar/Sidebar.jsx';

export default function App() {
  const [active, setActive] = useState('proyectos');
  const section = SECTIONS.find((s) => s.id === active);

  return (
    <div className="app">
      <Sidebar active={active} onSelect={setActive} />
      <main className="panel">
        <header className="panel-header">
          <h1>{section.icon} {section.label}</h1>
          <p>{section.desc}</p>
        </header>
        <div className="panel-body">
          <div className="placeholder">
            Esta sección se construirá en las próximas fases.
          </div>
        </div>
      </main>
    </div>
  );
}
