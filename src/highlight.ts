// Small dependency-free highlighter for fenced code. It only classifies text; the renderer
// builds React text nodes from the tokens, so nothing is ever interpreted as HTML.
export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'plain';
export interface Token { kind: TokenKind; text: string }

const MAX_HIGHLIGHT = 30_000;
const c = 'if else for while do switch case break continue return function class new this typeof instanceof in of import export from default const let var async await try catch finally throw null undefined true false void yield static extends super interface type enum implements public private protected readonly namespace as';
const keywordSets: Record<string, string> = {
  js: c, ts: c, json: 'true false null',
  py: 'def class if elif else for while return import from as with try except finally raise pass break continue lambda yield in is not and or None True False global nonlocal async await del assert',
  sh: 'if then else elif fi for while do done case esac function in return export local echo cd exit set unset source',
  go: 'func package import var const type struct interface map chan go defer return if else for range switch case default break continue select nil true false',
  rs: 'fn let mut pub struct enum impl trait use mod match if else for while loop return self Self crate const static as in ref move async await where true false',
  java: 'class interface enum extends implements public private protected static final void new return if else for while do switch case break continue try catch finally throw throws import package null true false this super abstract',
  c: 'int char float double long short unsigned signed void struct union enum typedef static const extern if else for while do switch case break continue return sizeof NULL true false class namespace template public private using new delete',
  sql: 'select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit as and or not null is in like distinct union',
  rb: 'def end class module if elsif else unless while until for do return yield begin rescue ensure nil true false self require include',
  css: 'important',
};
const aliases: Record<string, string> = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', typescript: 'ts', tsx: 'ts', python: 'py', bash: 'sh', shell: 'sh', zsh: 'sh',
  golang: 'go', rust: 'rs', ruby: 'rb', 'c++': 'c', cpp: 'c', h: 'c', hpp: 'c', cs: 'java', csharp: 'java', kotlin: 'java', swift: 'java', jsonc: 'json',
};
const hashComments = new Set(['py', 'sh', 'rb']);
const dashComments = new Set(['sql']);
const noSlashComments = new Set(['json', 'py', 'sh', 'rb', 'sql']);

export function languageFor(className?: string): string | undefined {
  const raw = /(?:^|\s)language-([\w+#-]+)/.exec(className ?? '')?.[1]?.toLowerCase();
  if (!raw) return undefined;
  const lang = aliases[raw] ?? raw;
  return lang in keywordSets ? lang : undefined;
}

export function tokenize(code: string, language: string): Token[] {
  if (code.length > MAX_HIGHLIGHT || !(language in keywordSets)) return [{ kind: 'plain', text: code }];
  const keywords = new Set(keywordSets[language].split(' '));
  const parts: string[] = [];
  if (!noSlashComments.has(language)) parts.push('\\/\\/[^\\n]*', '\\/\\*[\\s\\S]*?(?:\\*\\/|$)');
  if (hashComments.has(language)) parts.push('#[^\\n]*');
  if (dashComments.has(language)) parts.push('--[^\\n]*');
  const comment = parts.length ? `(?<comment>${parts.join('|')})|` : '';
  const pattern = new RegExp(`${comment}(?<string>"(?:\\\\.|[^"\\\\\\n])*"?|'(?:\\\\.|[^'\\\\\\n])*'?|\`(?:\\\\.|[^\`\\\\])*\`?)|(?<number>\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)|(?<word>[A-Za-z_$][\\w$]*)`, 'g');
  const tokens: Token[] = [];
  let last = 0;
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const previous = tokens[tokens.length - 1];
    if (previous?.kind === kind) previous.text += text; else tokens.push({ kind, text });
  };
  for (const match of code.matchAll(pattern)) {
    push('plain', code.slice(last, match.index));
    const groups = match.groups!;
    const kind: TokenKind = groups.comment !== undefined ? 'comment' : groups.string !== undefined ? 'string' : groups.number !== undefined ? 'number'
      : keywords.has(language === 'sql' ? match[0].toLowerCase() : match[0]) ? 'keyword' : 'plain';
    push(kind, match[0]);
    last = match.index! + match[0].length;
  }
  push('plain', code.slice(last));
  return tokens;
}

/** Language for a file name by extension, using the same aliases as fenced code. */
export function languageForFile(name: string): string | undefined {
  const extension = /\.([\w+#-]+)$/.exec(name)?.[1]?.toLowerCase();
  return extension ? languageFor(`language-${extension}`) : undefined;
}
