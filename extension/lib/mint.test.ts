/**
 * Address extraction decides whether the panel appears at all, so it gets real
 * tests. Run with: npm test -w @sonar/extension
 *
 * The confirmed Fomo shape is `/tokens/<chain>/<address>`. The first version of
 * this file guessed `/token/` (singular) and would have matched nothing on
 * every real page — hence the rule that the detector walks path segments
 * rather than matching a list of route shapes.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { detectToken, isValidAddress, mintFromUrl } from './mint';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x4200000000000000000000000000000000000006';

describe('mintFromUrl', () => {
  const found: [string, string][] = [
    ['the real Fomo route', `https://fomo.family/tokens/solana/${MINT}`],
    ['a trailing slash', `https://fomo.family/tokens/solana/${MINT}/`],
    ['a query string', `https://fomo.family/tokens/solana/${MINT}?ref=abc`],
    ['a route with no chain segment', `https://fomo.family/token/${MINT}`],
    ['an unknown future route', `https://fomo.family/whatever/${MINT}`],
    ['a query parameter', `https://fomo.family/swap?mint=${MINT}`],
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
    ['a non-address path', 'https://fomo.family/tokens/solana/not-a-real-address'],
    ['the token list page', 'https://fomo.family/tokens/solana'],
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
  it('reads the real Fomo token URL', () => {
    assert.deepEqual(detectToken(`https://fomo.family/tokens/solana/${MINT}`), {
      chain: 'solana',
      address: MINT,
    });
  });

  it('reads a base58 address as Solana even with no chain segment', () => {
    assert.deepEqual(detectToken(`https://fomo.family/token/${MINT}`), {
      chain: 'solana',
      address: MINT,
    });
  });

  it('reads the chain from the segment before an EVM address', () => {
    assert.deepEqual(detectToken(`https://fomo.family/tokens/base/${EVM}`), {
      chain: 'base',
      address: EVM,
    });
  });

  it('maps bnb to bsc', () => {
    assert.deepEqual(detectToken(`https://fomo.family/tokens/bnb/${EVM}`), {
      chain: 'bsc',
      address: EVM,
    });
  });

  it('refuses an EVM address with no chain in the URL', () => {
    // Guessing here would mean reading Base's address against Ethereum's state
    // and reporting a confident, completely wrong result.
    assert.equal(detectToken(`https://fomo.family/tokens/${EVM}`), null);
  });
});
