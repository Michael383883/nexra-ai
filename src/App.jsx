import React, { useState } from 'react';
import './styles/project-vars.css';
import Sidebar, { SECTIONS } from './components/Sidebar/Sidebar.jsx';

// Fase 2: proyectos
import useProject from './hooks/useProject';
import ProjectExplorer from './components/ProjectExplorer';
import ProjectInfo from './components/ProjectInfo';
import FileViewer from './components/FileViewer';
import ContextPreview from './components/ContextPreview';

// Fase 3.1: asistentes IA
import useAssistants from './hooks/useAssistants';
import AISelector from './components/AISelector';

// Fase 3.2: mensajes y respuestas
import useConversation from './hooks/useConversation';
import ChatPanel, { ConversationHistory } from './components/Chat';

export default function App() {
  const [active, setActive] = useState('proyectos');
  const section = SECTIONS.find((s) => s.id === active);

  // Los hooks viven aquí para que el estado no se pierda al cambiar de sección
  const project = useProject();
  const ai = useAssistants();
  const chat = useConversation({ project, ai });

  function renderSection() {
    switch (active) {
      case 'proyectos':
        return (
          <div className="project-layout">
            <ProjectExplorer project={project} />
            {project.activeFile ? (
              <FileViewer file={project.activeFile} onClose={project.closeFile} />
            ) : (
              <ProjectInfo project={project} />
            )}
          </div>
        );
      case 'asistentes':
        return <AISelector ai={ai} project={project} />;
      case 'contexto':
        return (
          <div className="chat-layout">
            <ChatPanel chat={chat} project={project} ai={ai} />
            <ContextPreview project={project} />
          </div>
        );
      case 'historial':
        return (
          <ConversationHistory
            chat={chat}
            ai={ai}
            onOpen={() => setActive('contexto')}
          />
        );
      default:
        return (
          <div className="placeholder">
            Esta sección se construirá en las próximas fases.
          </div>
        );
    }
  }

  return (
    <div className="app">
      <Sidebar active={active} onSelect={setActive} />
      <main className="panel">
        <header className="panel-header">
          <h1>{section.icon} {section.label}</h1>
          <p>{section.desc}</p>
        </header>
        <div className="panel-body">{renderSection()}</div>
      </main>
    </div>
  );
}