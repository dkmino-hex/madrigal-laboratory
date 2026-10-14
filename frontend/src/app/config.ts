export type DataMode = 'mock' | 'api';
function dataMode(): DataMode {
  const configured = import.meta.env.VITE_DATA_MODE === 'mock' ? 'mock' : 'api';
  if (!import.meta.env.DEV) return configured;
  const requested = new URLSearchParams(window.location.search).get('mode');
  const explicit = requested === 'mock' ? 'mock' : 'api';
  try {
    const key = 'madrigal:data-mode:' + import.meta.env.MODE;
    if (requested !== null) {
      window.sessionStorage.setItem(key, explicit);
      return explicit;
    }
    const saved = window.sessionStorage.getItem(key);
    if (saved === 'mock' || saved === 'api') return saved;
  } catch {
    /* В ограниченной среде остаётся явный URL или compile-time режим. */
  }
  return requested === null ? configured : explicit;
}
export const config = {
  mode: dataMode(),
  gateway: import.meta.env.VITE_API_BASE_URL || '/',
  development: import.meta.env.DEV,
  pageSize: 20,
  windowSize: 4096,
  previewLimit: 4096,
  maxByteWindows: 8,
};
export function publicGatewayPath(path: string) {
  let decoded = path;
  for (let depth = 0; depth < 8; depth++) {
    const normalized = new URL(decoded, 'http://gateway.invalid');
    if (
      normalized.origin !== 'http://gateway.invalid' ||
      /(?:^|\/)internal(?:\/|$)/i.test(normalized.pathname)
    )
      return false;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return false;
    }
    if (next === decoded) return true;
    decoded = next;
  }
  return false;
}
export function gatewayUrl(path: string) {
  const base = new URL(config.gateway, window.location.origin);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    !publicGatewayPath(base.pathname) ||
    !publicGatewayPath(path)
  ) {
    throw new Error('Некорректный адрес публичного Gateway');
  }
  return new URL(base.pathname.replace(/\/$/, '') + '/' + path.replace(/^\//, ''), base.origin)
    .href;
}
