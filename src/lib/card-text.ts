export type CardTextToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; label: string }
  | { type: 'newline' };

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);

function countChar(str: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i += 1) {
    if (str[i] === ch) count += 1;
  }
  return count;
}

function splitUrlAndTrailing(raw: string): { url: string; trailing: string } {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1];
    if (TRAILING_PUNCTUATION.has(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ')') {
      const slice = raw.slice(0, end);
      if (countChar(slice, ')') > countChar(slice, '(')) {
        end -= 1;
        continue;
      }
    }
    if (ch === ']') {
      const slice = raw.slice(0, end);
      if (countChar(slice, ']') > countChar(slice, '[')) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return {
    url: raw.slice(0, end),
    trailing: raw.slice(end),
  };
}

function isSafeHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function appendTextToken(tokens: CardTextToken[], value: string): void {
  if (value.length === 0) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === 'text') {
    last.value += value;
  } else {
    tokens.push({ type: 'text', value });
  }
}

function tokenizePlainSegment(segment: string, tokens: CardTextToken[]): void {
  if (segment.length === 0) return;

  URL_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null = URL_REGEX.exec(segment);

  while (match !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      appendTextToken(tokens, segment.slice(lastIndex, matchStart));
    }

    const { url, trailing } = splitUrlAndTrailing(match[0]);
    if (url.length > 0 && isSafeHttpUrl(url)) {
      tokens.push({ type: 'link', href: url, label: url });
      if (trailing.length > 0) {
        appendTextToken(tokens, trailing);
      }
    } else {
      appendTextToken(tokens, match[0]);
    }

    lastIndex = matchStart + match[0].length;
    match = URL_REGEX.exec(segment);
  }

  if (lastIndex < segment.length) {
    appendTextToken(tokens, segment.slice(lastIndex));
  }
}

function tokenizeLine(line: string, tokens: CardTextToken[]): void {
  let cursor = 0;
  while (cursor < line.length) {
    const openTick = line.indexOf('`', cursor);
    if (openTick === -1) {
      tokenizePlainSegment(line.slice(cursor), tokens);
      return;
    }

    const closeTick = line.indexOf('`', openTick + 1);
    if (closeTick === -1) {
      // Unclosed backtick: treat remainder as plain text.
      tokenizePlainSegment(line.slice(cursor), tokens);
      return;
    }

    if (closeTick === openTick + 1) {
      // Empty `` pair: treat as literal text and advance past both backticks.
      tokenizePlainSegment(line.slice(cursor, closeTick + 1), tokens);
      cursor = closeTick + 1;
      continue;
    }

    if (openTick > cursor) {
      tokenizePlainSegment(line.slice(cursor, openTick), tokens);
    }

    tokens.push({
      type: 'code',
      value: line.slice(openTick + 1, closeTick),
    });
    cursor = closeTick + 1;
  }
}

/**
 * Pure plain-text tokenizer for Card bodies (SPEC §3.2).
 * Preserves line breaks, auto-links `https?://` URLs, and parses inline
 * backtick code spans with zero raw HTML parsing.
 */
export function tokenizeCardText(input: string): CardTextToken[] {
  const normalized = input.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const tokens: CardTextToken[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) {
      tokens.push({ type: 'newline' });
    }
    tokenizeLine(lines[i], tokens);
  }

  return tokens;
}
