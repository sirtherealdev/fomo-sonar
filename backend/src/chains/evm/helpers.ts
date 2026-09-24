/** Hex and address helpers shared across the EVM adapter. */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function toHex(n: number): string {
  return `0x${Math.max(0, Math.floor(n)).toString(16)}`;
}

export function hexToNumber(hex: string): number {
  return hex && hex !== '0x' ? Number.parseInt(hex, 16) : 0;
}

export function hexToBigInt(hex: string): bigint {
  return hex && hex !== '0x' ? BigInt(hex) : 0n;
}

/** The last 20 bytes of a 32-byte log topic are an address. */
export function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}
