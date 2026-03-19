import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'brand' | 'brand-light' | 'cyberpunk';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'brand',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem('theme') as Theme) ?? 'brand',
  );

  useEffect(() => {
    const body = document.body;
    body.removeAttribute('data-theme');
    if (theme === 'cyberpunk') body.setAttribute('data-theme', 'cy');
    if (theme === 'brand-light') body.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
