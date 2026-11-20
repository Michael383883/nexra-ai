/**
 * Utilidades de formato para los componentes de proyecto.
 */

export function formatBytes(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatTokens(n) {
    if (n == null) return '0';
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function timeAgo(timestamp) {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'hace un momento';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `hace ${days} d`;
    return new Date(timestamp).toLocaleDateString();
}

const LANGUAGE_COLORS = {
    JavaScript: '#f1e05a',
    'JavaScript (JSX)': '#f1e05a',
    TypeScript: '#3178c6',
    'TypeScript (TSX)': '#3178c6',
    PHP: '#8892bf',
    'Blade (PHP)': '#f7523f',
    Python: '#3572a5',
    HTML: '#e34c26',
    CSS: '#8957e5',
    SCSS: '#c6538c',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    Go: '#00add8',
    Rust: '#dea584',
    Java: '#b07219',
    Kotlin: '#a97bff',
    'C#': '#178600',
    Ruby: '#cc342d',
    Shell: '#89e051',
    SQL: '#e38c00',
    C: '#7a7a7a',
    'C++': '#f34b7d',
    Swift: '#f05138',
    Dart: '#00b4ab',
    JSON: '#cbcb41',
    YAML: '#cb171e',
    Markdown: '#6b9bd1',
};

/** Color estable por lenguaje (con respaldo generado a partir del nombre). */
export function languageColor(name) {
    if (LANGUAGE_COLORS[name]) return LANGUAGE_COLORS[name];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
    return `hsl(${hash}, 55%, 60%)`;
}