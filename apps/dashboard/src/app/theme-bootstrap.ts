// Script exécuté avant l'hydratation : applique le thème enregistré par l'application, sauf sur les
// pages de vitrine, qui ne sont dessinées que pour le fond sombre.
const MARKETING_PATHS = ['/', '/pricing'];

export const THEME_BOOTSTRAP = `try {
  const root = document.documentElement;
  if (${JSON.stringify(MARKETING_PATHS)}.includes(window.location.pathname)) {
    root.classList.remove('dark', 'light');
  } else {
    const storedTheme = window.localStorage.getItem('sokar-dashboard-theme');
    const theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
  }
} catch {}`;
