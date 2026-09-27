/**
 * A link out to Bubblemaps for the token being looked at.
 *
 * A link, not a data source: nothing here is fetched, nothing of ours is sent
 * anywhere, and no number in the panel comes from them. It is built from the
 * address we already have and only opens if the reader clicks it, which keeps
 * the "we compute our own data" promise intact while still admitting that
 * their map is the better tool for staring at wallet clusters.
 *
 * Only the chains they actually host get a link. Fomo lists three more, and a
 * link that lands on a chain-not-found page is worse than no link.
 */

const SLUGS: Record<string, string> = {
  solana: 'sol',
  ethereum: 'eth',
  bsc: 'bsc',
  base: 'base',
};

export function bubbleMapUrl(chain: string, address: string): string | null {
  const slug = SLUGS[chain];
  if (!slug) return null;
  // The address comes from the URL we parsed and is already known to be a
  // plausible mint or 0x address, but encode it anyway: it ends up in a URL.
  return `https://app.bubblemaps.io/${slug}/token/${encodeURIComponent(address)}`;
}
