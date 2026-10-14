import { jsonLanguage } from '@codemirror/lang-json';

type JsonNode = ReturnType<typeof jsonLanguage.parser.parse>['topNode'];
type Path = readonly (string | number)[];

function nestedValue(path: Path, value: unknown): unknown {
  return path.reduceRight<unknown>((child, key) => {
    if (typeof key !== 'string') throw new Error('Нельзя добавить отсутствующий индекс массива');
    return { [key]: child };
  }, value);
}

/** Patch only the chosen token; untouched numeric literals retain their precision. */
export function editJsonValue(text: string, path: Path, value: unknown): string {
  JSON.parse(text);
  const root = jsonLanguage.parser.parse(text).topNode.firstChild;
  if (!root) throw new Error('Нет JSON-значения');
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
