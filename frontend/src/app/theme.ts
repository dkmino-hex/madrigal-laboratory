import { createContext, useContext } from 'react';
export const ThemeContext = createContext<'light' | 'dark'>('dark');
export const useTheme = () => useContext(ThemeContext);
