'use strict';

/**
 * conversationService.js  (proceso principal de Electron)
 *
 * Tarea 3.2.3: lanzador de conversaciones (prepara el mensaje, lo copia y abre
 * el asistente). Orquesta además las tareas 3.2.1 a 3.2.8.
 *
 * Flujo:
 *   prepare() → vista previa del mensaje (no guarda nada)
 *   send()    → copia al portapapeles, guarda la consulta y abre el asistente
 *   (pegas el mensaje en el asistente con Ctrl+V y esperas su respuesta)
 *   recordResponse() → registra la respuesta y organiza el código recibido
 *
 * Uso en desktop/main.js:
 *   const ai = registerAiIpc(ipcMain);
 *   registerConversationIpc(ipcMain, { getAiService: ai.getService });
 */

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const { assembleMessage } = require('../context-manager/messageBuilder');
const { summarizeTurns, unchangedNote, classifyFiles, updateSentFiles, sha1 } = require('../context-manager/continuityManager');
const { createConversationStore } = require('./conversationStore');
const { createResponseManager } = require('./responseManager');
const generated = require('../file-manager/generatedFiles');
const { createClipboardService } = require('../../services/clipboard');

const MAX_INSTRUCTION = 20000;
const MAX_SELECTED_FILES = 200;
const MAX_DRAFTS = 10;
const DRAFT_TTL_MS = 30 * 60 * 1000;

function clampLimit(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1000 || n > 1000000) {
        throw new Error('El límite debe estar entre 1.000 y 1.000.000 de tokens.');
    }
    return n;
}

function cleanSettingsPatch(patch = {}) {
    const out = {};
    for (const key of ['autoCopy', 'autoOpen', 'includeHistory']) {
        if (key in patch) out[key] = Boolean(patch[key]);
    }
    if ('defaultLimit' in patch) out.defaultLimit = clampLimit(patch.defaultLimit);
    if (patch.limits && typeof patch.limits === 'object') {
        out.limits = {};
        for (const [id, value] of Object.entries(patch.limits)) {
            if (typeof id === 'string' && id && id.length <= 100) out.limits[id] = clampLimit(value);
        }
    }
    return out;
}

const assertId = (id) => {
    if (!generated.ID_RE.test(String(id))) throw new Error('Identificador no válido.');
    return String(id);
};

/**
 * @param {object} deps
 * @param {string} deps.dataDir
 * @param {{copy: Function, read: Function}} deps.clipboard
 * @param {{snapshot: Function, openAssistant: Function}} deps.ai          Servicio de asistentes (3.1).
 * @param {{getCurrent: Function, buildContext: Function}} deps.project    Servicio de proyectos (Fase 2).
 * @param {(fullPath: string) => void} [deps.reveal]
 */
function createConversationService({ dataDir, clipboard, ai, project, reveal = () => { }, now = Date.now, uuid = () => crypto.randomUUID() }) {
    const baseDir = path.join(dataDir, 'generated');
    const store = createConversationStore({ dataDir, now, uuid });
    const responses = createResponseManager({ store, generated, baseDir, now });
    const drafts = new Map();

    function pruneDrafts() {
        const t = now();
        for (const [id, draft] of drafts) if (t - draft.createdAt > DRAFT_TTL_MS) drafts.delete(id);
        while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value);
    }

    // ───────────── 3.2.1 + 3.2.7 + 3.2.8: preparar el mensaje ─────────────
    async function prepare(input = {}) {
        const instruction = String(input.instruction || '').trim();
        if (!instruction) throw new Error('Escribe una instrucción.');
        if (instruction.length > MAX_INSTRUCTION) throw new Error(`La instrucción supera ${MAX_INSTRUCTION} caracteres.`);

        const selectedFiles = Array.isArray(input.selectedFiles)
            ? input.selectedFiles.filter((f) => typeof f === 'string' && f).slice(0, MAX_SELECTED_FILES)
            : [];

        const snapshot = await ai.snapshot();
        const assistantId = typeof input.assistantId === 'string' && input.assistantId ? input.assistantId : snapshot.selectedId;
        if (!assistantId) throw new Error('Elige un asistente en la sección Asistentes IA.');

        const settings = await store.getSettings();
        const maxTokens = clampLimit(input.maxTokens != null ? input.maxTokens : settings.limits[assistantId] || settings.defaultLimit);

        const projectInfo = project.getCurrent();
        const conversation = input.conversationId ? await store.getOrThrow(assertId(input.conversationId)) : null;
        if (conversation && conversation.projectPath && projectInfo && conversation.projectPath !== projectInfo.rootPath) {
            throw new Error(`Esta conversación pertenece al proyecto "${conversation.projectName}". Ábrelo de nuevo o empieza una conversación nueva.`);
        }

        const notes = [];
        let mode = input.mode === 'continue' ? 'continue' : 'new';
        if (mode === 'continue' && !(conversation && conversation.turns.length)) {
            mode = 'new';
            notes.push('Todavía no hay mensajes previos: se preparó como conversación nueva.');
        }

        // 3.2.7: qué archivos ya se enviaron y cuáles cambiaron
        let classified = { changed: selectedFiles, unchanged: [], hashes: {} };
        if (projectInfo && selectedFiles.length) {
            classified = await classifyFiles({
                rootPath: projectInfo.rootPath,
                selectedFiles,
                sentFiles: conversation && mode === 'continue' ? conversation.state.sentFiles : {},
            });
        }

        const contextFor = projectInfo
            ? async (budget) => {
                if (mode === 'continue') {
                    if (!classified.changed.length) return null;
                    return project.buildContext(classified.changed, { includeTree: false, includeAnalysis: false, maxTokens: budget, redact: true });
                }
                return project.buildContext(selectedFiles, { includeTree: true, includeAnalysis: true, maxTokens: budget, redact: true });
            }
            : null;

        const continuityFor = async (budget) => {
            if (mode === 'continue') return unchangedNote(classified.unchanged);
            if (conversation && settings.includeHistory) return summarizeTurns(conversation.turns, budget);
            return '';
        };

        // 3.2.8: ajustar al límite
        const result = await assembleMessage({ instruction, maxTokens, continuityFor, contextFor });
        if (!projectInfo) notes.push('No hay proyecto abierto: el mensaje solo lleva tu instrucción.');

        const included = result.context ? result.context.included : [];
        const draftId = uuid();
        drafts.set(draftId, {
            createdAt: now(),
            sent: false,
            text: result.text,
            tokens: result.tokens,
            instruction,
            assistantId,
            mode,
            conversationId: conversation ? conversation.id : null,
            projectRoot: projectInfo ? projectInfo.rootPath : '',
            projectName: projectInfo ? projectInfo.name : '',
            included,
            hashes: classified.hashes,
            unchanged: mode === 'continue' ? classified.unchanged : [],
            truncated: result.truncated,
        });
        pruneDrafts();

        return {
            draftId,
            text: result.text,
            mode,
            assistantId,
            stats: {
                tokens: result.tokens,
                maxTokens,
                chars: result.text.length,
                files: included.map((f) => f.path),
                unchanged: mode === 'continue' ? classified.unchanged : [],
                skipped: result.context ? result.context.skipped : [],
                redactions: result.context ? result.context.redactions : 0,
                truncated: result.truncated,
                dropped: result.dropped,
                warnings: [...notes, ...result.warnings],
            },
        };
    }

    const getDraft = (draftId) => {
        pruneDrafts();
        const draft = drafts.get(String(draftId));
        if (!draft) throw new Error('El borrador expiró. Vuelve a preparar el mensaje.');
        return draft;
    };

    // ───────────── 3.2.2: portapapeles ─────────────
    async function copyDraft(draftId) {
        return clipboard.copy(getDraft(draftId).text);
    }

    async function readClipboard() {
        return clipboard.read();
    }

    // ───────────── 3.2.3: lanzar la conversación ─────────────
    async function send({ draftId, assistantId, autoCopy, autoOpen } = {}) {
        const draft = getDraft(draftId);
        if (draft.sent) throw new Error('Este mensaje ya se envió. Prepara uno nuevo.');

        const settings = await store.getSettings();
        const shouldCopy = autoCopy === undefined ? settings.autoCopy : Boolean(autoCopy);
        const shouldOpen = autoOpen === undefined ? settings.autoOpen : Boolean(autoOpen);
        const targetAssistant = typeof assistantId === 'string' && assistantId ? assistantId : draft.assistantId;

        // 1) copiar primero: si falla no se guarda nada
        const copied = shouldCopy ? clipboard.copy(draft.text) : null;

        // 2) guardar la consulta en el historial
        let conversation = draft.conversationId ? await store.getOrThrow(draft.conversationId) : null;
        if (!conversation) {
            const snapshot = await ai.snapshot();
            conversation = await store.create({
                instruction: draft.instruction,
                projectPath: draft.projectRoot,
                projectName: draft.projectName,
                assistantId: targetAssistant,
                sessionId: snapshot.activeSessionId,
            });
        }
        const turn = await store.addTurn(conversation.id, {
            assistantId: targetAssistant,
            mode: draft.mode,
            instruction: draft.instruction,
            messageHash: sha1(draft.text),
            messageChars: draft.text.length,
            messageTokens: draft.tokens,
            files: draft.included.map((f) => f.path),
            unchanged: draft.unchanged,
            truncated: draft.truncated,
        });
        await store.patchState(conversation.id, {
            sentFiles: updateSentFiles(conversation.state.sentFiles, draft.included, draft.hashes),
        });
        draft.sent = true;

        // 3) abrir el asistente
        let opened = false;
        let openError = null;
        let assistantName = null;
        let browserKind = null;
        if (shouldOpen) {
            try {
                const result = await ai.openAssistant(targetAssistant);
                opened = true;
                assistantName = result.name;
                browserKind = result.kind;
            } catch (err) {
                openError = err.message;
            }
        }

        return {
            conversationId: conversation.id,
            turnId: turn.id,
            copied: Boolean(copied),
            verified: copied ? copied.verified : null,
            opened,
            openError,
            assistantName,
            browserKind,
        };
    }

    // ───────────── 3.2.4: registrar respuesta ─────────────
    async function recordResponse(input = {}) {
        assertId(input.conversationId);
        if (input.turnId) assertId(input.turnId);
        return responses.record({ conversationId: input.conversationId, turnId: input.turnId, text: input.text });
    }

    // ───────────── 3.2.5: historial ─────────────
    const listConversations = () => store.list();
    const getConversation = (id) => store.getOrThrow(assertId(id));

    async function deleteConversation(id) {
        assertId(id);
        await store.remove(id);
        await fsp.rm(path.join(baseDir, id), { recursive: true, force: true });
        return true;
    }

    // ───────────── 3.2.6: archivos generados ─────────────
    async function locateGenerated({ conversationId, turnId, filePath }) {
        assertId(conversationId);
        assertId(turnId);
        const conversation = await store.getOrThrow(conversationId);
        const turn = conversation.turns.find((t) => t.id === turnId);
        const known = turn && turn.response && turn.response.files.find((f) => f.path === filePath && f.stored);
        if (!known) throw new Error('Ese archivo no existe en la respuesta.');
        return { baseDir, conversationId, turnId, relativePath: filePath };
    }

    const readGenerated = async (input) => generated.readStored(await locateGenerated(input));
    const copyGenerated = async (input) => clipboard.copy(await readGenerated(input));
    const revealGenerated = async (input) => {
        reveal(generated.storedPath(await locateGenerated(input)));
        return true;
    };

    // ───────────── ajustes ─────────────
    const getSettings = () => store.getSettings();
    const setSettings = async (patch) => store.updateSettings(cleanSettingsPatch(patch));

    return {
        prepare,
        copyDraft,
        readClipboard,
        send,
        recordResponse,
        listConversations,
        getConversation,
        deleteConversation,
        readGenerated,
        copyGenerated,
        revealGenerated,
        getSettings,
        setSettings,
    };
}

// ───────────────────────── IPC ─────────────────────────
function registerConversationIpc(ipcMain, { getAiService }) {
    let service = null;

    // Se crea la primera vez que se necesita (la app ya está lista)
    function getService() {
        if (!service) {
            const { app, shell, clipboard } = require('electron');
            const projectService = require('../project-manager/projectService');
            service = createConversationService({
                dataDir: app.getPath('userData'),
                clipboard: createClipboardService(clipboard),
                ai: getAiService(),
                project: {
                    getCurrent: projectService.getCurrentProject,
                    buildContext: projectService.buildProjectContext,
                },
                reveal: (fullPath) => shell.showItemInFolder(fullPath),
            });
        }
        return service;
    }

    const handle = (channel, fn) => {
        ipcMain.handle(channel, async (_event, ...args) => {
            try {
                return { ok: true, data: await fn(getService(), ...args) };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
    };

    handle('chat:prepare', (s, input) => s.prepare(input));
    handle('chat:send', (s, input) => s.send(input));
    handle('chat:copy-draft', (s, draftId) => s.copyDraft(draftId));
    handle('chat:read-clipboard', (s) => s.readClipboard());
    handle('chat:record-response', (s, input) => s.recordResponse(input));
    handle('chat:conversations', (s) => s.listConversations());
    handle('chat:conversation', (s, id) => s.getConversation(id));
    handle('chat:delete-conversation', (s, id) => s.deleteConversation(id));
    handle('chat:read-generated', (s, input) => s.readGenerated(input));
    handle('chat:copy-generated', (s, input) => s.copyGenerated(input));
    handle('chat:reveal-generated', (s, input) => s.revealGenerated(input));
    handle('chat:get-settings', (s) => s.getSettings());
    handle('chat:set-settings', (s, patch) => s.setSettings(patch));
}

module.exports = { createConversationService, registerConversationIpc };