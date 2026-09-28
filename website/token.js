/*
 * The contract address block.
 *
 * Everything about the token lives in TOKEN below. Launching means filling in
 * `address` and `chain` and deploying — no markup to write, nothing else to
 * remember.
 *
 * While `address` is null the whole section stays out of the document. A site
 * that shows a placeholder address, or announces one is coming, hands anyone
 * a screenshot to edit and pass off as ours; the safe default is silence.
 *
 * When it is set, the address is printed in full rather than truncated. A
 * shortened address is exactly what an impersonator relies on — the middle is
 * where the difference hides, and nobody can compare what they cannot see.
 */
(function () {
  const TOKEN = {
    /** Set at launch. Until then the section does not exist. */
    address: null,
    /** 'solana' | 'base' | 'bsc' | 'ethereum' | 'monad' | 'arc' | 'robinhood' */
    chain: 'solana',
  };

  const EXPLORERS = {
    solana: a => `https://solscan.io/token/${a}`,
    base: a => `https://basescan.org/token/${a}`,
    bsc: a => `https://bscscan.com/token/${a}`,
    ethereum: a => `https://etherscan.io/token/${a}`,
    monad: a => `https://explorer.monad.xyz/token/${a}`,
    arc: a => `https://explorer.arc.network/token/${a}`,
    robinhood: a => `https://explorer.robinhood.com/token/${a}`,
  };

  const section = document.getElementById('token');
  if (!section) return;

  if (!TOKEN.address) {
    section.remove();
    return;
  }

  section.hidden = false;

  const out = section.querySelector('.ca-value');
  out.textContent = TOKEN.address;

  const explorer = section.querySelector('.ca-explorer');
  const url = EXPLORERS[TOKEN.chain];
  if (url) {
    explorer.href = url(TOKEN.address);
  } else {
    explorer.remove();
  }

  const copy = section.querySelector('.ca-copy');
  const label = copy.textContent;
  let reset;

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(TOKEN.address);
      copy.textContent = 'Copied';
    } catch {
      // Clipboard access can be refused; select the text so it can still be
      // copied by hand rather than leaving the button looking broken.
      const range = document.createRange();
      range.selectNodeContents(out);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copy.textContent = 'Selected';
    }
    copy.classList.add('done');
    clearTimeout(reset);
    reset = setTimeout(() => {
      copy.textContent = label;
      copy.classList.remove('done');
    }, 1600);
  });
})();
