import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import prettier from 'prettier';
const path = resolve(process.env.MADRIGAL_OPENAPI_FILE || '../contracts/gateway.openapi.json');
try {
  const spec = JSON.parse(await readFile(path, 'utf8'));
  if (typeof spec.openapi !== 'string' || !spec.openapi.startsWith('3.'))
    throw new Error('Нужен согласованный OpenAPI 3.x');
  const mapping = JSON.parse(
    await readFile('src/shared/api/contracts/gateway-mapping.json', 'utf8'),
  );
  for (const [name, entry] of Object.entries(mapping)) {
    const operation = spec.paths?.[entry.path]?.[entry.method.toLowerCase()];
    if (
      !operation ||
      operation.operationId !== entry.operationId ||
      entry.contractVersion !== spec.info.version ||
      entry.path.includes('/internal/')
    )
      throw new Error('Mapping does not match public OpenAPI: ' + name);
  }
  const target = 'src/shared/api/generated/gateway.d.ts';
  const output = await prettier.format(
    '// GENERATED from Gateway OpenAPI. Do not edit.\n' + astToString(await openapiTS(spec)),
    { ...(await prettier.resolveConfig(target)), parser: 'typescript' },
  );
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
    'API CONTRACT ERROR: ' +
      error.message +
      '\nПроверьте contracts/gateway.openapi.json и выполните api:generate.\n',
  );
  process.exitCode = 1;
}
