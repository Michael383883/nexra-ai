/* ═══════════════════════════════════════════════════════════════
   NEXRA AI · Prueba automática de la Fase 2
   Uso: abre el proyecto de prueba en la app, abre la consola
   (Ctrl+Shift+I), escribe "allow pasting", pega TODO este archivo
   y pulsa Enter. Al final copia los resultados al portapapeles.
   ═══════════════════════════════════════════════════════════════ */
(async () => {
    const api = window.devpilotProject;
    if (!api) { console.error('❌ window.devpilotProject no existe: revisa preload.js'); return; }

    const PASS = '✅ OK', FAIL = '❌ FALLA', WARN = '⚠️ REVISAR', MANUAL = '👆 MANUAL';
    const results = [];
    const add = (code, name, status, detail = '') => results.push({ Código: code, Prueba: name, Estado: status, Detalle: detail });

    // ── utilidades ───────────────────────────────────────────────
    const unwrap = async (promise) => {
        const r = await promise;
        if (!r || r.ok !== true) throw new Error((r && r.error) || 'sin respuesta');
        return r.data;
    };
    // fn devuelve: true (pasa) | [estado, detalle] | texto (falla con ese detalle)
    const check = async (code, name, fn) => {
        try {
            const out = await fn();
            if (out === true) add(code, name, PASS);
            else if (Array.isArray(out)) add(code, name, out[0], out[1] || '');
            else add(code, name, FAIL, String(out));
        } catch (e) { add(code, name, FAIL, 'Error: ' + e.message); }
    };
    const norm = (p) => String(p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
    const findKeys = (obj, re, path = '', depth = 0, out = []) => {
        if (!obj || typeof obj !== 'object' || depth > 5) return out;
        for (const [k, v] of Object.entries(obj)) {
            const p = path ? path + '.' + k : k;
            if (re.test(k)) out.push({ path: p, value: v });
            if (v && typeof v === 'object') findKeys(Array.isArray(v) ? v.slice(0, 3) : v, re, p, depth + 1, out);
        }
        return out;
    };
    const longestString = (obj, depth = 0) => {
        let best = { key: '', len: 0 };
        const walk = (o, key, d) => {
            if (d > 5 || o == null) return;
            if (typeof o === 'string') { if (o.length > best.len) best = { key, len: o.length }; }
            else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, k, d + 1);
        };
        walk(obj, '', depth);
        return best;
    };

    // ── carpeta del proyecto ────────────────────────────────────
    let ROOT = window.NEXRA_TEST_ROOT;
    if (!ROOT) { try { const cur = await api.current(); ROOT = cur && cur.ok && cur.data && cur.data.rootPath; } catch (_) { } }
    if (!ROOT) { console.error('❌ Abre primero el proyecto de prueba en la app (Abrir carpeta) y vuelve a pegar el script.'); return; }
    const SEP = ROOT.includes('\\') ? '\\' : '/';
    const join = (...p) => [ROOT, ...p].join(SEP);

    let top;
    try { top = await unwrap(api.listDir(ROOT)); }
    catch (e) { console.error('❌ No se pudo listar la carpeta: ' + e.message); return; }
    const topNames = top.map((n) => n.name);
    if (!topNames.includes('src') || !topNames.includes('package.json')) {
        const inner = top.filter((n) => n.type === 'directory').map((n) => n.name);
        console.error('❌ Esta no es la carpeta del proyecto de prueba (no veo "src" ni "package.json").\n' +
            'Carpetas que veo: ' + (inner.join(', ') || 'ninguna') + '.\n' +
            'Si ves una carpeta con el mismo nombre dentro, abre esa con "Abrir carpeta".');
        return;
    }
    console.log('Probando en: ' + ROOT);

    const walkAll = async (dir, acc = [], depth = 0) => {
        if (depth > 6) return acc;
        const kids = await unwrap(api.listDir(dir));
        for (const k of kids) { acc.push(k); if (k.type === 'directory') await walkAll(k.path, acc, depth + 1); }
        return acc;
    };
    const read = async (...rel) => {
        const r = await api.readFile(join(...rel));
        if (!r || !r.ok) throw new Error((r && r.error) || 'readFile falló');
        return r.data;
    };

    // ═════════ API ═════════
    const required = ['selectFolder', 'open', 'close', 'refresh', 'current', 'listDir', 'readFile', 'buildContext', 'recent', 'removeRecent', 'clearRecent', 'onChanged'];
    const missing = required.filter((k) => typeof api[k] !== 'function');
    add('API', 'Funciones del preload', missing.length ? FAIL : PASS, missing.length ? 'Faltan: ' + missing.join(', ') : required.length + ' funciones');

    // ═════════ FASE 2.1 ═════════
    let project;
    await check('2.1.1', 'Abrir un proyecto por ruta', async () => {
        project = await unwrap(api.open(ROOT));
        return norm(project.rootPath) === norm(ROOT) || 'rootPath distinto: ' + project.rootPath;
    });
    await check('2.1.1', 'Ruta inexistente no rompe la app', async () => {
        let r;
        try { r = await api.open(join('__no_existe__')); }
        catch (e) { return [WARN, 'lanza excepción en vez de devolver {ok:false}: ' + e.message]; }
        return (r && r.ok === false) || 'abrió una ruta que no existe';
    });
    add('2.1.1', 'Botón "Abrir carpeta" (diálogo)', MANUAL, 'Pulsa el botón, elige una carpeta y también cancela el diálogo: no debe pasar nada raro');

    let all = [];
    await check('2.1.2', 'Explorador muestra carpetas y archivos', async () => {
        all = await walkAll(ROOT);
        const need = ['src', 'docs', 'data', 'package.json', 'README.md', 'index.html', '.env'];
        const miss = need.filter((n) => !topNames.includes(n));
        return miss.length ? 'No aparecen: ' + miss.join(', ') : true;
    });

    await check('2.1.3', 'Árbol: carpetas y subcarpetas se pueden abrir', async () => {
        const src = (await unwrap(api.listDir(join('src')))).map((n) => n.name);
        const utils = (await unwrap(api.listDir(join('src', 'utils')))).map((n) => n.name);
        const m1 = ['components', 'styles', 'utils', 'index.js'].filter((n) => !src.includes(n));
        const m2 = ['math.js', 'format.js'].filter((n) => !utils.includes(n));
        return m1.length || m2.length ? 'Faltan en src: ' + m1 + ' / en src/utils: ' + m2 : true;
    });
    add('2.1.3', 'Expandir/contraer en la pantalla', MANUAL, 'Abre y cierra data, docs y src haciendo clic');

    await check('2.1.4', 'Lector: código, CSV y Markdown', async () => {
        const a = await read('src', 'utils', 'math.js');
        const b = await read('data', 'clientes.csv');
        const c = await read('README.md');
        const bad = [];
        if (!a.ok || !String(a.content).includes('function sumar')) bad.push('math.js');
        if (!b.ok || !String(b.content).includes('Ana')) bad.push('clientes.csv');
        if (!c.ok || !String(c.content).includes('Proyecto de prueba')) bad.push('README.md');
        if (!(a.lines > 0)) bad.push('sin conteo de líneas');
        return bad.length ? 'Falla: ' + bad.join(', ') : true;
    });

    await check('2.1.5', 'Detección de extensiones y lenguajes', async () => {
        const by = (n) => all.find((x) => x.name === n);
        const exp = [['math.js', /javascript/i], ['Button.jsx', /jsx|javascript/i], ['main.css', /css/i], ['README.md', /markdown/i], ['package.json', /json/i], ['clientes.csv', /csv/i]];
        const bad = [];
        for (const [name, re] of exp) { const n = by(name); if (!n) bad.push(name + ' (no está)'); else if (!re.test(String(n.language))) bad.push(name + ' → ' + n.language); }
        const png = by('logo.png');
        if (!png) bad.push('logo.png (no está)'); else if (png.readable !== false) bad.push('logo.png debería ser no legible');
        return bad.length ? bad.join(' | ') : true;
    });

    await check('2.1.6', 'Filtros: node_modules, .git y archivos enormes', async () => {
        const bad = [];
        if (all.some((n) => n.name === 'node_modules' || n.name === '.git')) bad.push('aparecen node_modules o .git');
        if (all.some((n) => /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(String(n.path).slice(ROOT.length)))) bad.push('hay archivos dentro de node_modules o .git');
        const log = all.find((n) => n.name === 'registro-grande.log');
        if (log && log.readable !== false) bad.push('registro-grande.log (2.7 MB) es seleccionable');
        return bad.length ? bad.join(' | ') : true;
    });

    const envNode = all.find((n) => n.name === '.env');
    await check('2.1.7', '.env marcado como protegido', async () => {
        if (!envNode) return 'no aparece .env en el árbol';
        if (envNode.sensitive !== true) return '.env no está marcado como sensitive';
        if (envNode.readable !== false) return [WARN, '.env está marcado sensitive pero es seleccionable (readable=true): se podría marcar con el checkbox'];
        return true;
    });
    await check('2.1.7', '.env bloqueado sin autorización', async () => {
        const d = await read('.env');
        return (d.ok === false && d.reason === 'sensitive') || 'leyó .env sin pedir autorización: ' + JSON.stringify({ ok: d.ok, reason: d.reason });
    });
    await check('2.1.7', '.env se puede abrir CON autorización', async () => {
        const r = await api.readFile(join('.env'), { allowSensitive: true, redact: false });
        const d = r && r.data;
        return (d && d.ok === true && String(d.content).includes('API_KEY')) || 'no se pudo abrir con allowSensitive:true';
    });
    await check('2.1.7', '.env.example se lee normal', async () => {
        const n = all.find((x) => x.name === '.env.example');
        const d = await read('.env.example');
        return (n && n.sensitive === false && d.ok === true) || '.env.example quedó protegido o no se lee';
    });
    await check('2.1.7', 'No lee archivos fuera del proyecto', async () => {
        const outside = (window.nexra && window.nexra.platform === 'win32') ? 'C:\\Windows\\win.ini' : '/etc/hostname';
        const r = await api.readFile(outside);
        return (!r || !r.ok || !r.data || r.data.ok === false) || 'LEYÓ un archivo fuera del proyecto: ' + outside;
    });

    await check('2.1.8', 'Proyecto guardado en recientes', async () => {
        const has = async () => (await unwrap(api.recent())).some((x) => norm(x.path) === norm(ROOT));
        if (!(await has())) return 'el proyecto no aparece en recientes';
        await unwrap(api.removeRecent(ROOT));
        if (await has()) return 'removeRecent no lo quitó';
        await unwrap(api.open(ROOT));
        return (await has()) || 'al reabrirlo no volvió a recientes';
    });
    add('2.1.8', 'Persistencia al reiniciar la app', MANUAL, 'Cierra la app, ábrela: el proyecto debe salir en recientes y abrirse de un clic');

    await check('2.1.9', 'Actualizar (refresh) y suscripción a cambios', async () => {
        const d = await unwrap(api.refresh());
        if (!d || !d.tree) return 'refresh no devolvió el árbol';
        const off = api.onChanged(() => { });
        if (typeof off !== 'function') return 'onChanged no devuelve función para cancelar';
        off();
        return true;
    });
    add('2.1.9', 'Detecta archivos nuevos, borrados y modificados', MANUAL, 'Ejecuta:  await nexraTest.cambios()  y sigue las 3 instrucciones');

    // ═════════ FASE 2.2 ═════════
    let A = {};
    try { const cur = await unwrap(api.current()); A = cur.analysis || {}; } catch (_) { }

    await check('2.2.1', 'Detector de tecnologías (React, Vite, Express)', async () => {
        const f = (A.frameworks || []).map((x) => String(x).toLowerCase());
        if (!f.length) return 'frameworks vacío. ¿Usaste el package.json con dependencias de proyecto-prueba-v2?';
        const miss = ['react', 'vite'].filter((n) => !f.some((x) => x.includes(n)));
        const fake = ['laravel', 'django', 'vue', 'angular'].filter((n) => f.some((x) => x.includes(n)));
        if (miss.length) return 'No detecta: ' + miss.join(', ') + ' (detectó: ' + f.join(', ') + ')';
        if (fake.length) return 'Detecta tecnologías que no hay: ' + fake.join(', ');
        return [PASS, 'Detectó: ' + f.join(', ')];
    });

    await check('2.2.2', 'Analizador de dependencias y scripts', async () => {
        const bad = [];
        if (A.dependencyCount !== 4) bad.push('dependencyCount=' + A.dependencyCount + ' (esperado 4)');
        const sc = Object.keys(A.scripts || {});
        if (!sc.includes('start') || !sc.includes('build')) bad.push('scripts detectados: ' + (sc.join(', ') || 'ninguno'));
        if (bad.length) return bad.join(' | ');
        const lists = findKeys(A, /^(dependencies|devDependencies|deps)$/i);
        return lists.length ? true : [WARN, 'Cuenta bien (4), pero el análisis no trae la lista de dependencias con versiones'];
    });

    await check('2.2.3', 'Analizador de arquitectura (módulos/estructura)', async () => {
        const k = findKeys(A, /(architecture|arquitectura|module|modulo|structure|estructura|layers|folders|directories)/i);
        if (!k.length) return 'El análisis no trae módulos ni estructura. Campos que tiene: ' + Object.keys(A).join(', ');
        return [PASS, 'Campos: ' + k.map((x) => x.path).join(', ')];
    });

    await check('2.2.4', 'Resumen técnico del proyecto', async () => {
        const s = String(A.summary || '');
        if (s.length < 30) return 'summary vacío o muy corto: "' + s + '"';
        return [PASS, s.slice(0, 140)];
    });
    add('2.2.4', 'El resumen se muestra en pantalla', MANUAL, 'Comprueba que el resumen aparece en Proyectos o Contexto');

    add('2.2.5', 'Selector de contexto (checkbox)', MANUAL, 'Marca/desmarca archivos: el contador sube y baja');

    const OPTS = { includeTree: true, includeAnalysis: true, redact: true, maxTokens: 30000, instructions: '' };
    const files3 = [join('src', 'utils', 'math.js'), join('src', 'utils', 'format.js'), join('package.json')];
    let ctx;
    await check('2.2.6', 'Constructor de contexto con archivos elegidos', async () => {
        ctx = await unwrap(api.buildContext(files3, OPTS));
        const s = JSON.stringify(ctx);
        const miss = ['function sumar', 'formatearPrecio', 'vite'].filter((t) => !s.includes(t));
        return miss.length ? 'El contexto no contiene: ' + miss.join(', ') : true;
    });

    const tokenOf = (c) => findKeys(c, /token/i).filter((x) => typeof x.value === 'number' && !/max|limit|budget/i.test(x.path));
    await check('2.2.7', 'Cuenta de tokens', async () => {
        const t = tokenOf(ctx);
        if (!t.length) return [WARN, 'No encontré un campo numérico de tokens en el resultado. Campos: ' + Object.keys(ctx || {}).join(', ')];
        return t[0].value > 0 ? [PASS, t[0].path + ' = ' + t[0].value] : 'tokens = 0';
    });
    await check('2.2.7', 'Respeta el límite maxTokens', async () => {
        const files = all.filter((n) => n.type === 'file' && n.readable).map((n) => n.path);
        const LIMIT = 150;
        const c = await unwrap(api.buildContext(files, { ...OPTS, includeTree: false, includeAnalysis: false, maxTokens: LIMIT }));
        const t = tokenOf(c);
        const used = t.length ? Math.max(...t.map((x) => x.value)) : null;
        const flags = findKeys(c, /(omit|truncat|exceed|skipp|exclu)/i)
            .filter((x) => x.value === true || (Array.isArray(x.value) && x.value.length) || (typeof x.value === 'number' && x.value > 0));
        if (used !== null && used <= LIMIT * 1.3) return [PASS, 'tokens usados: ' + used + ' (límite ' + LIMIT + ')'];
        if (flags.length) return [PASS, 'avisa de recortes en: ' + flags.map((x) => x.path).join(', ')];
        return 'Con maxTokens=' + LIMIT + ' el contexto tiene ' + (used ?? '?') + ' tokens y no avisa de que se pasó';
    });
    await check('2.2.7', 'Archivo enorme no entra completo', async () => {
        let c;
        try { c = await unwrap(api.buildContext([join('data', 'registro-grande.log')], OPTS)); }
        catch (e) { return [PASS, 'rechazado: ' + e.message]; }
        return !JSON.stringify(c).includes('evento numero 39999') || 'metió el .log de 2.7 MB completo';
    });

    await check('2.2.8', 'Vista previa: hay texto del contexto', async () => {
        const b = longestString(ctx);
        return b.len > 200 ? [PASS, 'texto en "' + b.key + '" (' + b.len + ' caracteres)'] : 'no encontré texto de contexto (máximo ' + b.len + ' caracteres)';
    });
    add('2.2.8', 'Vista previa en la pantalla Contexto', MANUAL, 'Muestra texto, tokens y archivos omitidos; si desmarcas un archivo desaparece de la vista');

    const exp = Object.keys(api).filter((k) => /(export|clipboard|copy|save)/i.test(k));
    add('2.2.9', 'Exportador de contexto', exp.length ? PASS : WARN,
        exp.length ? 'API: ' + exp.join(', ') : 'No hay función de exportar en el preload. Si "Copiar" usa el portapapeles desde la interfaz, pruébalo a mano; para exportar a archivo falta la función');

    const prof = Object.keys(api).filter((k) => /(profile|perfil)/i.test(k));
    let lsProf = [];
    try { lsProf = Object.keys(localStorage).filter((k) => /(profile|perfil)/i.test(k)); } catch (_) { }
    add('2.2.10', 'Perfiles de contexto', prof.length || lsProf.length ? WARN : FAIL,
        prof.length ? 'API: ' + prof.join(', ') + ' (probar a mano)' : lsProf.length ? 'Hay datos en localStorage: ' + lsProf.join(', ') + ' (probar a mano)' : 'No encontré perfiles ni en el preload ni en localStorage: parece no estar implementado');

    // ═════════ LA PRUEBA MÁS IMPORTANTE ═════════
    await check('🔐', 'Los secretos del .env NO llegan al contexto', async () => {
        const SECRETS = ['sk-prueba-1234567890', 'usuario:clave'];
        const leaks = [];
        for (const redact of [true, false]) {
            let s = '';
            try {
                const c = await unwrap(api.buildContext([join('.env'), join('src', 'utils', 'math.js')], { ...OPTS, redact }));
                s = JSON.stringify(c);
            } catch (_) { continue; } // rechazar el archivo protegido también es válido
            SECRETS.forEach((x) => { if (s.includes(x)) leaks.push(x.slice(0, 7) + '… (redact=' + redact + ')'); });
        }
        return leaks.length ? 'SE FILTRÓ UN SECRETO: ' + leaks.join(', ') : true;
    });

    // ── 2.1.9 interactivo ───────────────────────────────────────
    const cambios = async (segundos = 90) => {
        const got = { added: false, modified: false, removed: false };
        const has = (list, tail) => (list || []).some((c) => String(c.path).replace(/\\/g, '/').endsWith(tail));
        const off = api.onChanged((c) => {
            if (has(c.added, '/nuevo-prueba.txt')) got.added = true;
            if (has(c.modified, '/src/utils/math.js')) got.modified = true;
            if (has(c.removed, '/nuevo-prueba.txt')) got.removed = true;
            console.log('📡 cambio detectado → nuevo:' + got.added + ' modificado:' + got.modified + ' eliminado:' + got.removed);
        });
        console.log('%c2.1.9 · Haz esto FUERA de la app, en este orden (tienes ' + segundos + ' s):', 'font-weight:bold');
        console.log('  1) Crea el archivo  nuevo-prueba.txt  dentro de ' + ROOT);
        console.log('  2) Abre src/utils/math.js, añade un espacio o una línea y guarda');
        console.log('  3) Borra nuevo-prueba.txt');
        const start = Date.now();
        await new Promise((res) => {
            const t = setInterval(() => {
                if ((got.added && got.modified && got.removed) || Date.now() - start > segundos * 1000) { clearInterval(t); res(); }
            }, 500);
        });
        off();
        const rows = [
            { Código: '2.1.9', Prueba: 'Detecta archivo nuevo', Estado: got.added ? PASS : FAIL },
            { Código: '2.1.9', Prueba: 'Detecta archivo modificado', Estado: got.modified ? PASS : FAIL },
            { Código: '2.1.9', Prueba: 'Detecta archivo eliminado', Estado: got.removed ? PASS : FAIL },
        ];
        console.table(rows);
        return rows;
    };

    // ── resultado ───────────────────────────────────────────────
    const count = (s) => results.filter((r) => r.Estado === s).length;
    console.log('%cNEXRA AI · Resultado de la prueba de Fase 2', 'font-weight:bold;font-size:14px');
    console.table(results);
    console.log(`Resumen: ${PASS} ${count(PASS)} · ${FAIL} ${count(FAIL)} · ${WARN} ${count(WARN)} · ${MANUAL} ${count(MANUAL)}`);

    const md = '| Código | Prueba | Estado | Detalle |\n|---|---|---|---|\n' +
        results.map((r) => `| ${r.Código} | ${r.Prueba} | ${r.Estado} | ${String(r.Detalle).replace(/\|/g, '/')} |`).join('\n');
    try { if (typeof copy === 'function') { copy(md); console.log('📋 Resultados copiados al portapapeles: pégalos en el chat.'); } } catch (_) { }

    window.nexraTest = { results, cambios, md };
    return results;
})();