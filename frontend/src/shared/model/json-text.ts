import { jsonLanguage } from '@codemirror/lang-json';

type JsonNode = ReturnType<typeof jsonLanguage.parser.parse>['topNode'];
type Path = readonly (string | number)[];
let cachedText: string | undefined;
let cachedRoot: JsonNode | undefined;
function rootNode(text: string): JsonNode {
  if (cachedText !== text || !cachedRoot) {
    JSON.parse(text);
    const root = jsonLanguage.parser.parse(text).topNode.firstChild;
    if (!root) throw new Error('Нет JSON-значения');
    cachedText = text;
    cachedRoot = root;
  }
  return cachedRoot;
}

function nestedValue(path: Path, value: unknown): unknown {
  return path.reduceRight<unknown>((child, key) => {
    if (typeof key !== 'string') throw new Error('Нельзя добавить отсутствующий индекс массива');
    return { [key]: child };
  }, value);
}

/** Patch only the chosen token; untouched numeric literals retain their precision. */
export function editJsonValue(text: string, path: Path, value: unknown): string {
  const root = rootNode(text);
  const encode = (input: unknown) => {
    const encoded = JSON.stringify(input);
    if (encoded === undefined) throw new Error('Значение не представимо в JSON');
    return encoded;
  };
  const replace = (node: JsonNode, replacement: unknown) =>
    text.slice(0, node.from) + encode(replacement) + text.slice(node.to);
  let node = root;
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    if (node.name === 'Object' && typeof key === 'string') {
      const properties = node.getChildren('Property');
      const property = [...properties].reverse().find((item) => {
        const name = item.getChild('PropertyName')!;
        return JSON.parse(text.slice(name.from, name.to)) === key;
      });
      if (!property) {
        const last = properties.at(-1);
        const at = last?.to ?? node.from + 1;
        const addition = `${last ? ',' : ''}${encode(key)}: ${encode(nestedValue(path.slice(index + 1), value))}`;
        return text.slice(0, at) + addition + text.slice(at);
      }
      node = property.lastChild!;
    } else if (node.name === 'Array' && typeof key === 'number') {
      const values: JsonNode[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling)
        if (!['[', ']', ','].includes(child.name)) values.push(child);
      const next = values[key];
      if (!next) throw new Error('Индекс вне JSON-массива');
      node = next;
    } else {
      return replace(node, nestedValue(path.slice(index), value));
    }
  }
  return replace(node, value);
}

/** Format JSON tokens, preserving number spelling and string escapes. */
export function formatJsonText(text: string): string {
  JSON.parse(text);
  const tokens =
    text.match(
      /"(?:\\[\s\S]|[^"\\])*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g,
    ) ?? [];
  let depth = 0;
  let result = '';
  const newline = () => '\n' + '  '.repeat(depth);
  tokens.forEach((token, index) => {
    if (token === '{' || token === '[') {
      result += token;
      if (tokens[index + 1] !== (token === '{' ? '}' : ']')) {
        depth++;
        result += newline();
      }
    } else if (token === '}' || token === ']') {
      if (tokens[index - 1] !== (token === '}' ? '{' : '[')) {
        depth--;
        result += newline();
      }
      result += token;
    } else if (token === ',') result += ',' + newline();
    else if (token === ':') result += ': ';
    else result += token;
  });
  return result;
}

function valueNode(text: string, path: Path): JsonNode | undefined {
  let node: JsonNode | null = rootNode(text);
  for (const key of path) {
    if (!node) return undefined;
    if (node.name === 'Object' && typeof key === 'string') {
      node =
        [...node.getChildren('Property')].reverse().find((property) => {
          const name = property.getChild('PropertyName')!;
          return JSON.parse(text.slice(name.from, name.to)) === key;
        })?.lastChild ?? null;
    } else if (node.name === 'Array' && typeof key === 'number') {
      const values: JsonNode[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling)
        if (!['[', ']', ','].includes(child.name)) values.push(child);
      node = values[key] ?? null;
    } else return undefined;
  }
  return node ?? undefined;
}

export function jsonToken(text: string, path: Path) {
  const node = valueNode(text, path);
  return node ? text.slice(node.from, node.to) : undefined;
}

/** Insert an exact JSON token without passing numeric literals through Number. */
export function editJsonRaw(text: string, path: Path, raw: string): string {
  JSON.parse(raw);
  const existing = valueNode(text, path);
  if (existing) return text.slice(0, existing.from) + raw + text.slice(existing.to);
  const placeholder = '__madrigal_new_value__';
  const added = editJsonValue(text, path, placeholder);
  const node = valueNode(added, path)!;
  return added.slice(0, node.from) + raw + added.slice(node.to);
}

export function appendJsonValue(text: string, path: Path, value: unknown) {
  const node = valueNode(text, path);
  if (!node || node.name !== 'Array') return editJsonValue(text, path, [value]);
  const content = text.slice(node.from + 1, node.to - 1).trim();
  const at = node.to - 1;
  return text.slice(0, at) + (content ? ',' : '') + JSON.stringify(value) + text.slice(at);
}

export function removeJsonValue(text: string, path: Path): string {
  if (!path.length) throw new Error('Нельзя удалить всю схему');
  const parent = valueNode(text, path.slice(0, -1));
  const target = valueNode(text, path);
  if (!parent || !target) return text;
  const entries: JsonNode[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling)
    if (!['{', '}', '[', ']', ','].includes(child.name)) entries.push(child);
  const selected = parent.name === 'Object' ? target.parent! : target;
  const index = entries.findIndex((item) => item.from === selected.from);
  if (index < 0) throw new Error('Не найден элемент JSON');
  const from = index > 0 ? entries[index - 1]!.to : selected.from;
  const to = index === 0 && entries.length > 1 ? entries[1]!.from : selected.to;
  const result = text.slice(0, from) + text.slice(to);
  // Removing an optional key must not uncover an earlier duplicate property.
  return parent.name === 'Object' && valueNode(result, path)
    ? removeJsonValue(result, path)
    : result;
}
