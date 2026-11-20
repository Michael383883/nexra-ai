'use strict';

/**
 * projectAnalyzer.js
 * Tarea: 2.1.5 (detección de extensiones/lenguajes) + información del proyecto
 * para el panel ProjectInfo.
 */

const fsp = require('fs/promises');
const path = require('path');
const { readFile } = require('./fileReader');
const { flattenFiles } = require('./fileScanner');

const NPM_FRAMEWORKS = {
    react: 'React', vue: 'Vue', next: 'Next.js', nuxt: 'Nuxt', svelte: 'Svelte',
    '@angular/core': 'Angular', express: 'Express', fastify: 'Fastify', '@nestjs/core': 'NestJS',
    electron: 'Electron', vite: 'Vite', webpack: 'Webpack', tailwindcss: 'Tailwind CSS',
    typescript: 'TypeScript', 'react-native': 'React Native', jest: 'Jest', vitest: 'Vitest',
    prisma: 'Prisma', mongoose: 'Mongoose', sequelize: 'Sequelize',
};

const COMPOSER_FRAMEWORKS = {
    'laravel/framework': 'Laravel', 'symfony/framework-bundle': 'Symfony',
    'codeigniter4/framework': 'CodeIgniter', 'slim/slim': 'Slim', 'livewire/livewire': 'Livewire',
};

const PYTHON_FRAMEWORKS = {
    django: 'Django', flask: 'Flask', fastapi: 'FastAPI', pytest: 'Pytest',
    sqlalchemy: 'SQLAlchemy', numpy: 'NumPy', pandas: 'Pandas', tensorflow: 'TensorFlow', torch: 'PyTorch',
};

const LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'],
    ['composer.lock', 'composer'], ['poetry.lock', 'poetry'], ['Pipfile.lock', 'pipenv'],
    ['Cargo.lock', 'cargo'], ['Gemfile.lock', 'bundler'],
];

const ENTRY_CANDIDATES = [
    'main.js', 'index.js', 'app.js', 'server.js',
    'src/main.js', 'src/index.js', 'src/main.jsx', 'src/index.jsx', 'src/App.jsx', 'src/App.js',
    'src/main.ts', 'src/index.ts', 'src/App.tsx',
    'electron/main.js',
    'app.py', 'main.py', 'manage.py',
    'index.php', 'public/index.php', 'artisan',
    'main.go', 'cmd/main.go', 'src/main.rs', 'src/lib.rs',
];

const IMPORTANT_FILE_PATTERNS = [
    /^readme(\.\w+)?$/i, /^license(\.\w+)?$/i, /^package\.json$/, /^composer\.json$/,
    /^requirements\.txt$/, /^pyproject\.toml$/, /^go\.mod$/, /^cargo\.toml$/, /^pom\.xml$/,
    /^build\.gradle$/, /^dockerfile$/i, /^docker-compose\.ya?ml$/, /^\.env\.example$/,
    /^tsconfig\.json$/, /^vite\.config\.\w+$/, /^webpack\.config\.\w+$/,
];

async function exists(p) {
    try {
        await fsp.access(p);
        return true;
    } catch (_) {
        return false;
    }
}

async function readJson(rootPath, fileName) {
    const result = await readFile(path.join(rootPath, fileName), { projectRoot: rootPath });
    if (!result.ok) return null;
    try {
        return JSON.parse(result.content);
    } catch (_) {
        return null;
    }
}

function detectLanguages(files) {
    const map = new Map();
    let totalBytes = 0;
    const ignoredKinds = new Set(['config', 'doc', 'data', 'binary', 'image', 'other']);

    for (const file of files) {
        totalBytes += file.size || 0;
        if (ignoredKinds.has(file.kind)) continue;
        const entry = map.get(file.language) || { name: file.language, files: 0, bytes: 0 };
        entry.files += 1;
        entry.bytes += file.size || 0;
        map.set(file.language, entry);
    }

    const list = [...map.values()].sort((a, b) => b.bytes - a.bytes);
    const sum = list.reduce((acc, l) => acc + l.bytes, 0) || 1;
    list.forEach((l) => {
        l.percent = Math.round((l.bytes / sum) * 1000) / 10;
    });
    return { languages: list, totalBytes };
}

function guessProjectType(frameworks, primaryLanguage) {
    const has = (n) => frameworks.includes(n);
    if (has('Electron')) return 'Aplicación de escritorio (Electron)';
    if (has('React Native')) return 'Aplicación móvil (React Native)';
    if (has('Next.js') || has('Nuxt')) return 'Aplicación web full-stack';
    if (has('Laravel') || has('Symfony') || has('CodeIgniter')) return 'Aplicación web PHP';
    if (has('Django') || has('Flask') || has('FastAPI')) return 'Aplicación Python';
    if (has('NestJS') || has('Express') || has('Fastify')) return 'Backend Node.js';
    if (has('React') || has('Vue') || has('Svelte') || has('Angular')) return 'Aplicación web frontend';
    return primaryLanguage ? `Proyecto ${primaryLanguage}` : 'Proyecto genérico';
}

/**
 * Analiza el proyecto y devuelve un resumen estructurado.
 * @param {string} rootPath
 * @param {object} tree   Árbol devuelto por scanTree().tree
 */
async function analyzeProject(rootPath, tree) {
    const files = flattenFiles(tree);
    const filePaths = new Set(files.map((f) => f.relativePath));

    const { languages, totalBytes } = detectLanguages(files);
    const primaryLanguage = languages[0] ? languages[0].name : null;

    const frameworks = new Set();
    let name = path.basename(rootPath);
    let version = null;
    let scripts = {};
    let dependencyCount = 0;
    let packageMain = null;

    // Node.js
    const pkg = filePaths.has('package.json') ? await readJson(rootPath, 'package.json') : null;
    if (pkg) {
        name = pkg.name || name;
        version = pkg.version || null;
        scripts = pkg.scripts || {};
        packageMain = pkg.main || null;
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        dependencyCount += Object.keys(deps).length;
        for (const [dep, label] of Object.entries(NPM_FRAMEWORKS)) {
            if (deps[dep]) frameworks.add(label);
        }
    }

    // PHP
    const composer = filePaths.has('composer.json') ? await readJson(rootPath, 'composer.json') : null;
    if (composer) {
        name = composer.name || name;
        const deps = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
        dependencyCount += Object.keys(deps).length;
        for (const [dep, label] of Object.entries(COMPOSER_FRAMEWORKS)) {
            if (deps[dep]) frameworks.add(label);
        }
    }

    // Python
    for (const pyFile of ['requirements.txt', 'pyproject.toml']) {
        if (!filePaths.has(pyFile)) continue;
        const res = await readFile(path.join(rootPath, pyFile), { projectRoot: rootPath });
        if (!res.ok) continue;
        const text = res.content.toLowerCase();
        for (const [dep, label] of Object.entries(PYTHON_FRAMEWORKS)) {
            if (new RegExp(`(^|[\\s"'\\[,])${dep}([\\s=<>~!\\[\\]"',]|$)`, 'm').test(text)) frameworks.add(label);
        }
    }

    // Gestor de paquetes (los lockfiles se filtran del árbol, así que se miran en disco)
    let packageManager = null;
    for (const [file, manager] of LOCKFILES) {
        if (await exists(path.join(rootPath, file))) {
            packageManager = manager;
            break;
        }
    }

    // Puntos de entrada
    const entryPoints = [];
    if (packageMain && filePaths.has(packageMain.replace(/^\.\//, ''))) {
        entryPoints.push(packageMain.replace(/^\.\//, ''));
    }
    for (const candidate of ENTRY_CANDIDATES) {
        if (filePaths.has(candidate) && !entryPoints.includes(candidate)) entryPoints.push(candidate);
    }

    // Archivos importantes (solo en la raíz)
    const importantFiles = files
        .filter((f) => !f.relativePath.includes('/') && IMPORTANT_FILE_PATTERNS.some((re) => re.test(f.name)))
        .map((f) => f.relativePath);

    const frameworkList = [...frameworks];
    const type = guessProjectType(frameworkList, primaryLanguage);
    const hasGit = await exists(path.join(rootPath, '.git'));

    const summary =
        `${name}${version ? ` v${version}` : ''} — ${type}` +
        (frameworkList.length ? ` (${frameworkList.join(', ')})` : '') +
        `. ${files.length} archivos` +
        (primaryLanguage ? `, lenguaje principal: ${primaryLanguage}` : '') +
        '.';

    return {
        name,
        version,
        type,
        primaryLanguage,
        languages,
        frameworks: frameworkList,
        packageManager,
        scripts,
        dependencyCount,
        entryPoints,
        importantFiles,
        hasGit,
        stats: { files: files.length, totalBytes },
        summary,
    };
}

module.exports = { analyzeProject, detectLanguages };