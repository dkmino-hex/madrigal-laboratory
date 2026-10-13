const owners = new Set<symbol>();
const listeners = new Set<() => void>();

export const navigationIsBlocked = () => owners.size > 0;
export function setNavigationBlocked(owner: symbol, blocked: boolean) {
  const previous = navigationIsBlocked();
  if (blocked) owners.add(owner);
  else owners.delete(owner);
  if (previous !== navigationIsBlocked()) listeners.forEach((listener) => listener());
}
export function subscribeNavigationBlocking(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
