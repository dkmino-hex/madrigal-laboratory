import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
const path = resolve(process.env.MADRIGAL_OPENAPI_FILE || 'contracts/gateway.openapi.json');
try {
  const spec = JSON.parse(await readFile(path, 'utf8'));
  if (typeof spec.openapi !== 'string' || !spec.openapi.startsWith('3.'))
    throw new Error('Нужен согласованный OpenAPI 3.x');
  const output =
    '// GENERATED from approved Gateway OpenAPI. Do not edit.\n' +
    astToString(await openapiTS(spec));
  const target = 'src/shared/api/generated/gateway.d.ts';
  if (process.argv[2] === 'generate') {
    await mkdir('src/shared/api/generated', { recursive: true });
    await writeFile(target, output);
    process.stdout.write('Типы Gateway созданы из ' + path + '\n');
  } else if (process.argv[2] === 'check') {
    if ((await readFile(target, 'utf8')) !== output)
      throw new Error('Generated-типы отличаются. Выполните api:generate и проверьте diff.');
    process.stdout.write('Generated-типы воспроизводимы; wire-совместимость требует API-suite.\n');
  } else throw new Error('Ожидается generate или check');
} catch (error) {
  process.stderr.write(
    'BLOCKED_EXTERNAL BASE-02: ' +
      error.message +
      '\nOpenAPI не предоставлен. Временные DTO не доказывают совместимость с Gateway.\n',
  );
  process.exitCode = 1;
}
