/** A small tokenizer for Python and JavaScript, enough to colour code the model wrote. No dependency. */

export type Token = { kind: "kw" | "str" | "num" | "cmt" | "fn" | "txt"; text: string };

const KEYWORDS = new Set([
  "def", "return", "import", "from", "as", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "None", "True", "False",
  "class", "with", "try", "except", "finally", "raise", "lambda", "yield", "pass", "break", "continue", "global", "nonlocal", "del", "assert", "async", "await",
  "const", "let", "var", "function", "new", "this", "null", "undefined", "true", "false", "typeof", "instanceof", "throw", "catch", "switch", "case", "default", "export",
]);

const PATTERN = /(#.*|\/\/.*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)(?=\s*\()|(\b[A-Za-z_]\w*\b)/g;

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of code.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "txt", text: code.slice(last, index) });
    const [whole, cmt, str, num, fn, word] = match;
    if (cmt !== undefined) tokens.push({ kind: "cmt", text: whole });
    else if (str !== undefined) tokens.push({ kind: "str", text: whole });
    else if (num !== undefined) tokens.push({ kind: "num", text: whole });
    else if (fn !== undefined) tokens.push({ kind: KEYWORDS.has(fn) ? "kw" : "fn", text: whole });
    else if (word !== undefined) tokens.push({ kind: KEYWORDS.has(word) ? "kw" : "txt", text: whole });
    last = index + whole.length;
  }
  if (last < code.length) tokens.push({ kind: "txt", text: code.slice(last) });
  return tokens;
}
