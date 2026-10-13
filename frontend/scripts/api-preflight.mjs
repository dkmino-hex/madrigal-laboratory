import { readFile } from 'node:fs/promises';
try {
  const gateway = process.env.MADRIGAL_GATEWAY_URL;
  if (!gateway) throw new Error('Задайте MADRIGAL_GATEWAY_URL публичного Gateway');
  const url = new URL(gateway);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname.includes('/internal/'))
    throw new Error('Нужен публичный HTTP Gateway');
  await readFile(process.env.MADRIGAL_OPENAPI_FILE || 'contracts/gateway.openapi.json', 'utf8');
  const mapping = JSON.parse(
    await readFile('src/shared/api/contracts/gateway-mapping.json', 'utf8'),
  );
  for (const operation of [
    'projects',
    'project',
    'captures',
    'bytes',
    'sources',
    'run',
    'results',
    'job',
  ])
    if (!mapping[operation]) throw new Error('CONTRACT_PENDING: ' + operation);
  for (const key of ['MADRIGAL_PROJECT_ID', 'MADRIGAL_RUN_ID', 'MADRIGAL_SOURCE_LINK'])
    if (!process.env[key]) throw new Error('Нужен реальный приёмочный корпус: ' + key);
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Gateway недоступен: HTTP ' + response.status);
  if (!(await response.text()).includes('<html')) throw new Error('Gateway не раздаёт SPA');
  process.stdout.write('API preflight прошёл. MSW и Playwright route-подмены отключены.\n');
} catch (error) {
  process.stderr.write(
    'API PREFLIGHT FAILED: ' +
      error.message +
      '\nРеальная интеграция не проверена. Отсутствие backend не превращается в зелёный отчёт.\n',
  );
  process.exitCode = 1;
}
