/* ============================================================================
   matching.js — decides how close a guess is to the real prompt.
   Returns a verdict: 'exact' | 'close' | 'wrong' with a 0..1 score.
   Tolerant of spelling, plurals, word order, synonyms and filler words.
   global Match.score(guess, answer)
   ========================================================================== */
(function (global) {
  'use strict';

  const STOP = new Set(['a','an','the','of','in','on','at','with','and','to','is','that','this','some','someone','your','my','it']);

  // small synonym clusters — each member maps to a canonical token
  const SYN_GROUPS = [
    ['cat','kitten','kitty','feline'], ['dog','puppy','pup','hound','doggo'],
    ['happy','joyful','glad','cheerful'], ['sad','unhappy','depressed','gloomy'],
    ['phone','smartphone','mobile','cellphone','iphone'], ['car','automobile','vehicle'],
    ['robot','bot','android','droid'], ['boat','ship','vessel'], ['plane','airplane','aeroplane','jet'],
    ['big','huge','giant','large','massive'], ['small','tiny','little','mini'],
    ['scared','afraid','frightened','terrified'], ['fast','quick','speedy','rapid'],
    ['house','home','cottage','cabin'], ['ghost','spirit','phantom','spook'],
    ['fish','goldfish'], ['octopus','squid'], ['couch','sofa'], ['tv','television'],
    ['bin','trash','rubbish','garbage'], ['sweater','jumper','pullover'],
    ['trolley','cart','shopping cart','shopping trolley'], ['biscuit','cookie'],
    ['flame','fire','torch'], ['wizard','mage','sorcerer'], ['dinosaur','dino','t-rex','trex'],
  ];
  const SYN = new Map();
  for (const g of SYN_GROUPS) { const canon = g[0]; for (const w of g) SYN.set(w, canon); }

  function normalize(s) {
    return String(s).toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .replace(/['-]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function singular(w) {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s'))  return w.slice(0, -1);
    return w;
  }
  function canon(w) { w = singular(w); return SYN.get(w) || w; }

  function tokens(s) {
    return normalize(s).split(' ')
      .filter(w => w && !STOP.has(w))
      .map(canon);
  }

  // Levenshtein distance (bounded use)
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let cur = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[n];
  }
  // are two tokens "the same word" allowing typos?
  function tokenMatch(a, b) {
    if (a === b) return true;
    const d = lev(a, b);
    const tol = Math.max(a.length, b.length) >= 6 ? 2 : 1;
    return d <= tol;
  }

  const Match = {
    normalize, tokens,

    /** returns { verdict, score, matched } */
    score(guess, answer) {
      const g = tokens(guess), a = tokens(answer);
      if (!g.length || !a.length) return { verdict: 'wrong', score: 0 };

      // whole-string near-equality (handles short answers fast)
      const gj = g.join(' '), aj = a.join(' ');
      if (gj === aj) return { verdict: 'exact', score: 1 };

      // count matched answer tokens
      let matched = 0; const used = new Set();
      for (const at of a) {
        for (let i = 0; i < g.length; i++) {
          if (used.has(i)) continue;
          if (tokenMatch(at, g[i])) { matched++; used.add(i); break; }
        }
      }
      const coverage = matched / a.length;              // how much of answer captured
      const precision = matched / g.length;             // how on-topic the guess is
      const score = coverage * 0.75 + precision * 0.25;

      // exact: every meaningful answer token captured (typos allowed)
      if (coverage >= 0.999) return { verdict: 'exact', score: 1, matched };
      // close: caught the key noun(s)
      if (coverage >= 0.5 || (a.length >= 3 && matched >= a.length - 1))
        return { verdict: 'close', score, matched };
      return { verdict: 'wrong', score, matched };
    },

    points(verdict) {
      return verdict === 'exact' ? 500 : verdict === 'close' ? 250 : 0;
    },
  };

  global.Match = Match;
})(window);
