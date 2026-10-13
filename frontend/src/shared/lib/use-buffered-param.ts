import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { navigationIsBlocked, subscribeNavigationBlocking } from './navigation-blocking';

/** Keep typing local; preserve other filters and honour back/forward URL changes. */
export function useBufferedParam(key: string, cursorKey = 'cursor', delay = 350) {
  const [params, setParams] = useSearchParams();
  const urlValue = params.get(key) ?? '';
  const [input, setInput] = useState({ urlValue, value: urlValue });
  const value = input.urlValue === urlValue ? input.value : urlValue;
  const blocked = useSyncExternalStore(
    subscribeNavigationBlocking,
    navigationIsBlocked,
    () => false,
  );
  useEffect(() => {
    if (value.trim() === urlValue || blocked) return;
    const timer = window.setTimeout(() => {
      if (navigationIsBlocked()) return;
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value.trim()) next.set(key, value.trim());
          else next.delete(key);
          next.delete(cursorKey);
          return next;
        },
        { replace: true },
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [value, urlValue, key, cursorKey, delay, setParams, blocked]);
  return {
    value,
    setValue: (value: string) => setInput({ urlValue, value }),
    pending: value.trim() !== urlValue,
  };
}
