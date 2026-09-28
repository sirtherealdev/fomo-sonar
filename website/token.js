/*
 * The contract address block.
 *
 * Everything about the token lives in TOKEN below. Launching means filling in
 * `address` and `chain` and deploying — no markup to write, nothing else to
 * remember.
 *
 * Until then the section stands but says plainly that no token exists. That is
 * deliberately not a placeholder address: a plausible-looking string sitting
 * here is something anyone could screenshot, edit, and pass off as ours. A
 * flat "there is no token yet" does the opposite — it is what a reader can
 * check a stranger's link against.
 *
 * Once set, the address prints in full rather than truncated. A shortened
 * address is what an impersonator relies on: the middle is where the
 * difference hides, and nobody can compare what they cannot see.
 */
(function () {
  const TOKEN = {
    /** Set at launch. Until then the block says no token exists. */
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

  section.hidden = false;

  const out = section.querySelector('.ca-value');
  const copyBtn = section.querySelector('.ca-copy');
  const lede = section.querySelector('.section-lede');

  if (!TOKEN.address) {
    section.classList.add('pending');
    out.textContent = 'No token has launched yet.';
    lede.textContent =
      'There is no SONAR token. When there is one, its address will appear here '
      + 'first — so anything calling itself SONAR before then, or carrying an '
      + 'address this page does not show, is not us.';
    copyBtn.remove();
    section.querySelector('.ca-explorer').remove();
    return;
  }

  out.textContent = TOKEN.address;

  const explorer = section.querySelector('.ca-explorer');
  const url = EXPLORERS[TOKEN.chain];
  if (url) {
    explorer.href = url(TOKEN.address);
  } else {
    explorer.remove();
  }

  const copy = copyBtn;
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
