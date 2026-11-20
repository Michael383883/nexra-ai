'use strict';

/**
 * jsonStore.js
 * Persistencia sencilla en un archivo JSON:
 *  - escritura atómica (archivo temporal + rename)
 *  - actualizaciones en cola (sin condiciones de carrera)
 *  - si una actualización falla, no se cambia nada
 *  - si el archivo está corrupto, se renombra a .corrupt-<fecha> y se parte de cero
 */

const fsp = require('fs/promises');
const path = require('path');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createJsonStore(filePath, defaults) {
    let data = null;
    let loading = null;
    let queue = Promise.resolve();

    async function doLoad() {
        try {
            const raw = await fsp.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('formato inválido');
            }
            data = { ...clone(defaults), ...parsed };
        } catch (err) {
            if (err.code !== 'ENOENT') {
                await fsp.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => { });
            }
            data = clone(defaults);
        }
        return data;
    }

    function load() {
        if (data) return Promise.resolve(data);
        if (!loading) loading = doLoad();
        return loading;
    }

    async function persist(next) {
        const tmp = `${filePath}.tmp`;
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
        await fsp.rename(tmp, filePath);
    }

    /** Devuelve los datos actuales (no los modifiques directamente: usa update). */
    function get() {
        return load();
    }

    /**
     * Aplica `fn(draft)` sobre una copia y guarda el resultado.
     * Devuelve lo que devuelva `fn`.
     */
    function update(fn) {
        const run = queue.then(async () => {
            const current = await load();
            const draft = clone(current);
            const result = await fn(draft);
            await persist(draft);
            data = draft;
            return result;
        });
        queue = run.catch(() => { });
        return run;
    }

    return { get, update };
}

module.exports = { createJsonStore };