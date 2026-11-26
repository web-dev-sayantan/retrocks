import { expect } from 'vitest';

export interface SseTestStream<Message extends { type: string }> {
  /** Reads and parses the next complete SSE data frame. */
  next(): Promise<Message>;
  /** Reads the next complete SSE data frame's raw payload string (without `data: ` framing). */
  nextRaw(): Promise<string>;
  /** Reads frames until one matches `type` and optional predicate `matches`. */
  until<T extends Message['type']>(
    type: T,
    matches?: (message: Extract<Message, { type: T }>) => boolean,
  ): Promise<Extract<Message, { type: T }>>;
  /** Asserts that the stream ends cleanly with no remaining unread frames. */
  expectClosed(): Promise<void>;
  /** Cancels the underlying response body reader. */
  close(): Promise<void>;
}

function extractSseData(rawFrame: string): string | null {
  const dataLines: string[] = [];
  for (const line of rawFrame.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
    }
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

function nextFrameBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (lf !== -1 && (crlf === -1 || lf < crlf)) {
    return { index: lf, length: 2 };
  }
  return { index: crlf, length: 4 };
}

/**
 * Shared SSE stream reader for server tests across Boards and Pointing Poker Rooms.
 * Handles arbitrary chunk boundaries (split UTF-8 sequences, split frames, and coalesced frames).
 */
export function readSseStream<Message extends { type: string }>(
  response: Response,
  parse: (raw: string) => Message,
): SseTestStream<Message> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const body = response.body;
  if (!body) {
    throw new Error('Expected SSE response to include a readable body.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;

  async function readNextRawOrNull(): Promise<string | null> {
    while (true) {
      const boundary = nextFrameBoundary(buffer);
      if (boundary) {
        const rawFrame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const data = extractSseData(rawFrame);
        if (data !== null) return data;
        continue;
      }
      if (ended) {
        const trailing = buffer;
        buffer = '';
        if (trailing.trim().length === 0) return null;
        return extractSseData(trailing);
      }
      const chunk = await reader.read();
      if (chunk.done) {
        ended = true;
        buffer += decoder.decode();
        continue;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  async function nextRaw(): Promise<string> {
    const raw = await readNextRawOrNull();
    if (raw === null) {
      throw new Error('Live stream ended before the expected event.');
    }
    return raw;
  }

  async function next(): Promise<Message> {
    return parse(await nextRaw());
  }

  function isType<T extends Message['type']>(
    message: Message,
    type: T,
  ): message is Extract<Message, { type: T }> {
    return message.type === type;
  }

  return {
    next,
    nextRaw,
    async until<T extends Message['type']>(
      type: T,
      matches: (message: Extract<Message, { type: T }>) => boolean = () => true,
    ): Promise<Extract<Message, { type: T }>> {
      while (true) {
        const message = await next();
        if (isType(message, type) && matches(message)) {
          return message;
        }
      }
    },
    async expectClosed(): Promise<void> {
      const trailing = await readNextRawOrNull();
      expect(trailing).toBeNull();
    },
    async close(): Promise<void> {
      await reader.cancel();
    },
  };
}
