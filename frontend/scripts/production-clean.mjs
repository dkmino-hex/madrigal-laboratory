import { unlink, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const directory = resolve('dist');
for (const file of ['mockServiceWorker.js', 'demo-project.zip']) {
  const target = resolve(directory, file);
  if (relative(directory, target).startsWith('..')) throw new Error('Неверный путь build');
  try {
    await unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const files = await readFile('dist/index.html', 'utf8');
if (files.includes('https://')) throw new Error('Production HTML содержит внешний ресурс');
process.stdout.write('Production: mock worker и demo ZIP исключены.\n');
