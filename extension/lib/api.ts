/**
 * The extension's only network call.
 *
 * It sends one thing — a chain id and a public token address — to our own
 * backend, and it sends no headers, cookies or credentials with it.
 * `credentials: 'omit'` is explicit rather than relied upon by default, so a
 * reader does not have to know the default.
 *
 * The response is newline-delimited JSON: a partial report arrives first,
 * carrying everything that does not need per-wallet lookups, and the complete
 * one follows a few seconds later. `onUpdate` is called for each, so the panel
 * fills in rather than waiting.
 */

import { API_BASE } from './config';
import type { AnalyzeResponse, ApiError, ChainId } from '@scope/shared';

export type AnalyzeResult =
  | { status: 'ok'; data: AnalyzeResponse }
  | { status: 'unsupported'; chain: ChainId }
  | { status: 'error'; message: string };

export async function analyze(
  chain: ChainId,
  address: string,
  signal: AbortSignal,
  onUpdate: (result: AnalyzeResult) => void,
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/analyze/${chain}/${address}`, {
      method: 'GET',
      credentials: 'omit',
      signal,
    });

    if (res.status === 501) return onUpdate({ status: 'unsupported', chain });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      return onUpdate({ status: 'error', message: body?.message ?? 'Could not analyse this token.' });
    }
    if (!res.body) return onUpdate({ status: 'error', message: 'Empty response.' });

    await readLines(res.body, (line) => {
      const parsed = JSON.parse(line) as AnalyzeResponse | ApiError;

      // An error can arrive mid-stream, after a usable partial. Report it, but
      // never overwrite what the reader already has with an empty state.
      if ('error' in parsed) {
        onUpdate({ status: 'error', message: parsed.message });
        return;
      }
      onUpdate({ status: 'ok', data: parsed });
    });
  } catch (err) {
    // An aborted request is a navigation, not a failure worth showing.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return onUpdate({ status: 'error', message: 'cancelled' });
    }
    onUpdate({ status: 'error', message: 'Could not reach the risk service.' });
  }
}

/** Call `onLine` for each complete newline-delimited chunk as it arrives. */
async function readLines(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // A chunk can split a line anywhere, so only complete lines are emitted
    // and the remainder stays in the buffer.
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
      newline = buffer.indexOf('\n');
    }
  }

  const rest = buffer.trim();
  if (rest) onLine(rest);
}
