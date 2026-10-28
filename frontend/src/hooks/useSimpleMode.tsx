import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// Simple mode trims the panel to its essentials: fewer menu entries, inbound
// form reduced to required fields (schema defaults fill the rest) and a
// first-run setup wizard. Expert mode is the full 3x-ui-derived panel.
// The choice persists per browser in localStorage.

const STORAGE_KEY = 'xui:simple-mode';

function readInitial(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    /* private mode: fall through to the default */
  }
  return true;
}

interface SimpleModeContextValue {
  simple: boolean;
  setSimple: (value: boolean) => void;
  toggle: () => void;
}

const SimpleModeContext = createContext<SimpleModeContextValue>({
  simple: true,
  setSimple: () => {},
  toggle: () => {},
});

export function SimpleModeProvider({ children }: { children: ReactNode }) {
  const [simple, setSimpleState] = useState(readInitial);

  const setSimple = useCallback((value: boolean) => {
    setSimpleState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* storage unavailable: keep session-only */
    }
  }, []);

  const toggle = useCallback(() => {
    setSimple(!simple);
  }, [setSimple, simple]);

  const value = useMemo(() => ({ simple, setSimple, toggle }), [simple, setSimple, toggle]);
  return <SimpleModeContext.Provider value={value}>{children}</SimpleModeContext.Provider>;
}

export function useSimpleMode(): SimpleModeContextValue {
  return useContext(SimpleModeContext);
}

// Routes hidden from navigation in simple mode. The router still serves them
// (deep links / palette in expert mode), they just disappear from the top bar.
export const SIMPLE_MODE_HIDDEN_ROUTES = new Set([
  '/outbound',
  '/routing',
  '/xray',
  '/hosts',
  '/groups',
  '/api-docs',
  '/sponsors',
]);
