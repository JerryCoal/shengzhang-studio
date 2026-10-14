import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AppearancePreferences } from './types';
import './appearance.css';

export const DEFAULT_APPEARANCE: AppearancePreferences = { fontScale: 1, emphasize: false };
export const FONT_SIZES = [
  { value: 1, label: '标准', hint: '100%' },
  { value: 1.125, label: '舒适', hint: '112.5%' },
  { value: 1.25, label: '大字', hint: '125%' },
  { value: 1.375, label: '特大', hint: '137.5%' },
] as const;
type AppearanceContextValue = {
  preferences: AppearancePreferences; saving: boolean; error: string;
  change: (update: Partial<AppearancePreferences>) => void; retry: () => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);
export const useAppearance = () => useContext(AppearanceContext);
const key = (value: AppearancePreferences) => `${value.fontScale}:${value.emphasize}`;

export function AppearanceProvider({ persisted, save, children }: { persisted?: AppearancePreferences; save: (value: AppearancePreferences) => Promise<unknown>; children: ReactNode }) {
  const [preferences, setPreferences] = useState(persisted || DEFAULT_APPEARANCE);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const desired = useRef(preferences), saved = useRef(preferences), pending = useRef(false), alive = useRef(true), uncertain = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (persisted && !pending.current && !uncertain.current && !error && key(desired.current) === key(saved.current)) {
      desired.current = persisted; saved.current = persisted; setPreferences(persisted);
    }
  }, [persisted?.fontScale, persisted?.emphasize]);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--studio-font-scale', String(preferences.fontScale));
    document.documentElement.dataset.studioEmphasis = String(preferences.emphasize);
    document.documentElement.dataset.studioTextSize = String(preferences.fontScale);
    return () => {
      document.documentElement.style.removeProperty('--studio-font-scale');
      delete document.documentElement.dataset.studioEmphasis;
      delete document.documentElement.dataset.studioTextSize;
    };
  }, [preferences]);
  const flush = async () => {
    if (pending.current || !alive.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      // Serialize preference writes so fast switching always persists the last choice.
      while (alive.current && (uncertain.current || key(desired.current) !== key(saved.current))) {
        const value = { ...desired.current };
        await save(value); saved.current = value; uncertain.current = false;
      }
    } catch {
      uncertain.current = true;
      if (alive.current) setError('本次选择已预览，但尚未确认保存成功。请重试；重新打开后可能恢复为上次保存的设置。');
    } finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  const change = (update: Partial<AppearancePreferences>) => {
    desired.current = { ...desired.current, ...update };
    setPreferences(desired.current); void flush();
  };
  return <AppearanceContext.Provider value={{ preferences, saving, error, change, retry: () => void flush() }}>{children}</AppearanceContext.Provider>;
}
