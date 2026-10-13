import { useCallback, useState } from "react";

/** Boolean preference persisted in localStorage ("1" / "0"). */
export function usePersistedBool(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [value, setValueState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return raw === "1";
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (v: boolean) => {
      setValueState(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* ignore quota / private mode */
      }
    },
    [key]
  );

  return [value, setValue];
}
