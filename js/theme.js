/**
 * PennyHelm — Theme Manager
 *
 * Manages light/dark theme with system preference detection.
 * Persists user choice to localStorage.
 */

const THEME_KEY = 'pennyhelm-theme';

export function getThemePreference() {
    return localStorage.getItem(THEME_KEY) || 'system';
}

export function setThemePreference(value) {
    localStorage.setItem(THEME_KEY, value);
    applyTheme(value);
}

export function applyTheme(pref) {
    const html = document.documentElement;
    if (pref === 'light') {
        html.setAttribute('data-theme', 'light');
    } else if (pref === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        // 'system' — remove attribute, let CSS media query handle it
        html.removeAttribute('data-theme');
    }
    updateMetaThemeColor(pref);
}

/**
 * Returns the currently resolved theme ('light' or 'dark'),
 * accounting for system preference when set to 'system'.
 */
export function getEffectiveTheme() {
    const pref = getThemePreference();
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function updateMetaThemeColor(pref) {
    let color;
    if (pref === 'light') {
        color = '#f5f6f8';
    } else if (pref === 'dark') {
        color = '#0f1117';
    } else {
        color = window.matchMedia('(prefers-color-scheme: light)').matches ? '#f5f6f8' : '#0f1117';
    }
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.appendChild(meta);
    }
    meta.content = color;
}

// Initialize on module load
applyTheme(getThemePreference());

// Listen for system changes when in 'system' mode
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemePreference() === 'system') {
        applyTheme('system');
        // Dispatch event so components can re-render with new theme colors
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: getEffectiveTheme() } }));
    }
});
