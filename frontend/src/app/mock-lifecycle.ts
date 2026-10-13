export async function stopOwnMockWorker() {
  if (!('serviceWorker' in navigator)) return;
  const expected = new URL('/mockServiceWorker.js', location.origin).href;
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    const script =
      registration.active?.scriptURL ??
      registration.waiting?.scriptURL ??
      registration.installing?.scriptURL;
    if (script === expected) {
      registration.active?.postMessage('CLIENT_CLOSE');
      await registration.unregister();
    }
  }
}
