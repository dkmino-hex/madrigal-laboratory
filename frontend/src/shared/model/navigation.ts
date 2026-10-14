import { locationSchema, type Location } from '../api/contracts/draft';
export function sourceLink(
  location: Location,
  context?: { runId?: string; revisionId?: string; returnTo?: string },
) {
  const params = new URLSearchParams(location);
  if (context?.runId) params.set('runId', context.runId);
  if (context?.revisionId) params.set('revisionId', context.revisionId);
  if (context?.returnTo?.startsWith('/projects/')) params.set('returnTo', context.returnTo);
  return '/projects/' + encodeURIComponent(location.projectId) + '/traffic?' + params.toString();
}
export function readLocation(params: URLSearchParams, projectId: string): Location | null {
  const data = Object.fromEntries(params);
  if (data.projectId && data.projectId !== projectId)
    throw new Error('Источник принадлежит другому проекту. Ссылка не будет переназначена.');
  if (!data.assemblyId) {
    if (params.has('assemblyId') || data.streamId)
      throw new Error(
        'Прямая ссылка содержит некорректные координаты или неполный контекст сборки.',
      );
    return null;
  }
  const parsed = locationSchema.safeParse({ ...data, projectId });
  if (!parsed.success)
    throw new Error('Прямая ссылка содержит некорректные координаты или неполный контекст сборки.');
  return parsed.data;
}
export const sameContext = (a: Location, b: Location) =>
  a.projectId === b.projectId &&
  a.captureId === b.captureId &&
  a.sessionId === b.sessionId &&
  a.streamId === b.streamId &&
  a.direction === b.direction &&
  a.assemblyId === b.assemblyId;
export function safeReturnPath(value: string | null, projectId: string) {
  if (!value || value.includes('//')) return null;
  try {
    const origin = window.location.origin;
    const url = new URL(value, origin);
    return url.origin === origin &&
      url.pathname.startsWith('/projects/' + encodeURIComponent(projectId) + '/')
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}
