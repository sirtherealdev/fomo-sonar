/**
 * Mint extraction is the one piece of logic that decides whether the panel
 * appears at all, so it gets real tests. Run with: npm test -w @scope/extension
 *
 * The URL shapes below are candidates until a real Fomo token page confirms
 * them — when it does, update URL_PATTERNS and these cases together.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { detectToken, isValidAddress, mintFromUrl } from './mint';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x4200000000000000000000000000000000000006';

describe('mintFromUrl', () => {
  const found: [string, string][] = [
    ['path', `https://fomo.family/token/${MINT}`],
    ['chain segment', `https://fomo.family/token/solana/${MINT}`],
    ['coin route', `https://fomo.family/coin/${MINT}`],
    ['short route', `https://fomo.family/t/${MINT}`],
    ['trailing query', `https://fomo.family/trade/${MINT}?ref=abc`],
    ['query parameter', `https://fomo.family/swap?mint=${MINT}`],
  ];

  for (const [name, url] of found) {
    it(`finds the mint in a ${name}`, () => {
      assert.equal(mintFromUrl(url), MINT);
    });
  }

  const notFound: [string, string][] = [
    ['home', 'https://fomo.family/'],
    ['leaderboard', 'https://fomo.family/leaderboard'],
    ['an article slug', 'https://fomo.family/answers/what-is-a-meme-coin'],
    ['a non-address path', 'https://fomo.family/token/not-a-real-address'],
  ];

  for (const [name, url] of notFound) {
    it(`returns null for ${name}`, () => {
      assert.equal(mintFromUrl(url), null);
    });
  }
});

describe('isValidAddress', () => {
  it('accepts a real mint', () => {
    assert.equal(isValidAddress(MINT), true);
  });

  it('rejects base58-illegal characters', () => {
    // 0, O, I and l are not in the base58 alphabet.
    assert.equal(isValidAddress('0OIl'.padEnd(40, 'x')), false);
  });

  it('rejects anything too short to be 32 bytes', () => {
    assert.equal(isValidAddress('abc'), false);
  });
});

describe('detectToken', () => {
  it('reads a base58 address as Solana without needing a chain hint', () => {
    assert.deepEqual(detectToken(`https://fomo.family/token/${MINT}`), {
      chain: 'solana',
      address: MINT,
    });
  });

  it('reads the chain from the path for an EVM address', () => {
    assert.deepEqual(detectToken(`https://fomo.family/token/base/${EVM}`), {
      chain: 'base',
      address: EVM,
    });
  });

  it('maps bnb to bsc', () => {
    assert.deepEqual(detectToken(`https://fomo.family/token/bnb/${EVM}`), {
      chain: 'bsc',
      address: EVM,
    });
  });

  it('refuses an EVM address with no chain in the URL', () => {
    // Guessing here would mean reading Base's address against Ethereum's state
    // and reporting a confident, completely wrong result.
    assert.equal(detectToken(`https://fomo.family/token/${EVM}`), null);
  });
});
