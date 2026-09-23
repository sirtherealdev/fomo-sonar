/**
 * The extension's only network call.
 *
 * It sends one thing — a chain id and a public token address — to our own
 * backend, and it sends no headers, cookies or credentials with it.
 * `credentials: 'omit'` is explicit rather than relied upon by default, so a
 * reader does not have to know the default.
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
): Promise<AnalyzeResult> {
  try {
    const res = await fetch(`${API_BASE}/analyze/${chain}/${address}`, {
      method: 'GET',
      credentials: 'omit',
      signal,
    });

    if (res.status === 501) return { status: 'unsupported', chain };

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      return { status: 'error', message: body?.message ?? 'Could not analyse this token.' };
    }

    return { status: 'ok', data: (await res.json()) as AnalyzeResponse };
  } catch (err) {
    // An aborted request is a navigation, not a failure worth showing.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'error', message: 'cancelled' };
    }
    return { status: 'error', message: 'Could not reach the risk service.' };
  }
}
