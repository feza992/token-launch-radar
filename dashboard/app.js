// Token Radar's night dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan, and the live-token view kept apart. No network: every byte
// it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category family, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 25e6) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  var FAMILIES = [
    { re: /lend|cdp|collateral/, main: function (n, c, ch) { return 'Supply $' + c + ' of USDC to ' + n + ' on ' + ch + ' and keep the supply position open.'; }, second: function (n, c) { return 'Borrow $' + Math.max(10, Math.round(c / 5)) + ' of a stablecoin against the supply, then repay it the same week.'; }, risk: 'Watch the health factor: a borrow that slips under 1 gets liquidated, so keep the loan small.' },
    { re: /dex|amm/, main: function (n, c, ch) { return 'Provide $' + c + " of liquidity to " + n + "'s deepest pool on " + ch + ', in the pair the app itself suggests.'; }, second: function (n, c, ch) { return 'Swap $' + Math.max(10, Math.round(c / 10)) + ' through ' + n + ' on ' + ch + ' so the wallet shows both providing and trading.'; }, risk: 'Impermanent loss: a pool whose assets drift apart pays less than holding them, so favour the stable pair.' },
    { re: /yield aggregator|vault|curator|allocator/, main: function (n, c, ch) { return 'Deposit $' + c + ' into a ' + n + ' vault on ' + ch + ' and keep the vault shares.'; }, second: function (n, c, ch) { return "Claim the vault's rewards once, then deposit the claimed amount back into the same vault on " + ch + '.'; }, risk: "The vault's strategy can change: read the vault's own page before each deposit, not the headline APY." },
    { re: /yield/, main: function (n, c, ch) { return 'Deposit $' + c + " into " + n + "'s highest-TVL yield position on " + ch + ' and keep it open.'; }, second: function () { return "Harvest the position's rewards once a week and restake them instead of selling them."; }, risk: "Yield is paid in the protocol's own incentives: a falling reward token can erase the yield, so track it weekly." },
    { re: /rwa/, main: function (n, c, ch) { return "Mint $" + c + " of the protocol's yield-bearing asset through " + n + ' on ' + ch + ' and hold it.'; }, second: function (n, c, ch) { return 'Move $' + Math.max(10, Math.round(c / 10)) + " of the minted asset into the protocol's own secondary use on " + ch + ', such as its lending market.'; }, risk: "The asset is backed by off-chain holdings: check the issuer's reserve report before minting more." },
    { re: /perpetual|derivative|basis/, main: function (n, c, ch) { return 'Deposit $' + c + ' of USDC as margin on ' + n + ' on ' + ch + ' and open one small hedged position.'; }, second: function (n, c) { return 'Close the hedge and open a fresh one in the opposite direction, keeping the margin at $' + c + '.'; }, risk: 'Leverage liquidates fast: keep the position small and never add margin to a losing trade.' },
    { re: /prediction/, main: function (n, c, ch) { return 'Fund $' + c + ' on ' + n + ' on ' + ch + ' and take one position in a market that settles within the month.'; }, second: function (n) { return 'Take a second position in a different market on ' + n + ' so the wallet shows more than one outcome.'; }, risk: 'A market can resolve against you: only stake what you can lose, and never chase a loss.' },
    { re: /launchpad/, main: function (n, c, ch) { return 'Hold $' + c + " in " + n + "'s staking or allocation position on " + ch + ' so the wallet qualifies for a sale.'; }, second: function (n) { return 'Join one ' + n + ' sale with the smallest allowed ticket and hold the allocation.'; }, risk: 'An allocation is not guaranteed: the sale can oversubscribe, so the position may earn nothing.' },
    { re: /insurance/, main: function (n, c, ch) { return 'Buy $' + c + ' of cover from ' + n + ' on ' + ch + ' and keep the policy for its full term.'; }, second: function (n, c, ch) { return 'Renew or extend the cover on ' + n + ' on ' + ch + ' once, so the wallet shows two cover periods.'; }, risk: "Cover pays only on the policy's own terms: read what events are excluded before buying." },
    { re: /staking|restak/, main: function (n, c, ch) { return "Stake $" + c + " of the chain's staking asset through " + n + ' on ' + ch + ' and keep the receipt token.'; }, second: function (n, c, ch) { return 'Use $' + Math.max(10, Math.round(c / 10)) + " of the receipt token in " + n + "'s own app on " + ch + ', such as its lending market.'; }, risk: 'Staked assets can unbond slowly and can be slashed: keep enough unstaked to pay gas.' },
    { re: /liquidity manager|leveraged farm/, main: function (n, c, ch) { return 'Deposit $' + c + " into " + n + "'s managed position on " + ch + ' and let it rebalance.'; }, second: function (n, c, ch) { return 'Add $' + Math.max(10, Math.round(c / 10)) + ' to the same managed position on ' + ch + ' after a week.'; }, risk: 'A managed position still carries impermanent loss, and leverage multiplies it: keep the deposit modest.' },
    { re: /index/, main: function (n, c, ch) { return 'Buy $' + c + " of " + n + "'s index token on " + ch + ' and hold it.'; }, second: function (n, c, ch) { return 'Rebalance by buying $' + Math.max(10, Math.round(c / 10)) + ' more of the index after a month on ' + ch + '.'; }, risk: "The basket can fall with its weakest holding: check the index's composition before buying." },
    { re: /farm/, main: function (n, c, ch) { return 'Provide $' + c + " of liquidity, then stake the LP tokens in " + n + "'s farm on " + ch + '.'; }, second: function () { return "Harvest the farm's rewards once a week and stake them again instead of selling them."; }, risk: 'Farm rewards dilute as more farmers join: the first weeks pay the most, so start early and track the rate.' },
    { re: /chain/, main: function (n, c, ch) { return 'Bridge $' + c + ' of USDC onto ' + n + ' on ' + ch + " and use it in two of the chain's own apps."; }, second: function (n, c, ch) { return 'Swap $' + Math.max(10, Math.round(c / 10)) + " on " + n + "'s native DEX on " + ch + ' and keep a small balance for gas.'; }, risk: 'Bridges are the most exploited contracts in the space: bridge only what you plan to use.' },
    { re: /stable/, main: function (n, c, ch) { return 'Mint or deposit $' + c + ' of the stable asset through ' + n + ' on ' + ch + ' and hold it.'; }, second: function (n, c, ch) { return 'Use $' + Math.max(10, Math.round(c / 10)) + " of the stable asset in " + n + "'s own market on " + ch + '.'; }, risk: 'A stable asset can depeg: watch its price against a dollar before minting more.' }
  ];
  var GENERIC = {
    main: function (n, c, ch) { return 'Deposit $' + c + ' of USDC into ' + n + ' on ' + ch + ' and keep the position open.'; },
    second: function (n, c, ch) { return 'Make a second deposit of $' + Math.max(10, Math.round(c / 10)) + ' into ' + n + ' on ' + ch + ' a week later.'; },
    risk: 'Smart contracts can fail: only deposit what you can afford to lose, and never share a seed phrase.'
  };
  function familyFor(p) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < FAMILIES.length; i++) if (FAMILIES[i].re.test(c)) return FAMILIES[i];
    return GENERIC;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var fam = familyFor(p);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: fam.main(p.name, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: fam.second(p.name, capital, chain), cost: 'about $' + Math.max(2, Math.round(gas / 2)) + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Open the protocol's own points or rewards page once a week and check what the position has earned.", cost: 'no fee to check', time: '5 minutes a week' },
      { text: fam.risk, cost: 'nothing to check, and never pay anyone to farm for you', time: '5 minutes' },
      { text: 'Before you withdraw, claim only from the link the protocol itself publishes, and write the wallet, the dates and every transaction in a farm log.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', html: '<b>Token Radar</b> &nbsp;·&nbsp; ' + DATA.model_version })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index · 758 protocols' }),
        el('span', { html: 'Top implied value <b>' + fmtUsd(DATA.rows[0].implied_value_usd) + '</b>' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by what a launch would be worth' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL</b> and no token on record. The early radar adds <b>' + DATA.early_size + ' pre-token protocols</b> below that floor. Implied value is a model, not a promise — and never a TVL table: each protocol is priced at its own category\u2019s live-token multiple. Strongest signal: <b>' + top.name + '</b> at ' + fmtUsd(top.implied_value_usd) + '.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function signals() {
    var top = DATA.rows.slice(0, 5);
    return el('div', null,
      el('div', { class: 'signals-label', text: 'Top signals — strongest implied value' }),
      el('div', { class: 'signals' }, top.map(function (r) {
        return el('button', { class: 'signal', type: 'button', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: '#' + r.rank + (r.watchlist ? ' · watchlist' : ' · early') }),
          el('b', { text: r.name }),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) + ' 7d' })
        );
      }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 12);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var sortSelect = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name']].map(function (o) {
        return el('option', { value: o[0], text: 'Sort: ' + o[1], selected: state.sort === o[0] ? 'selected' : null });
      })
    );
    sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; state.dir = -1; render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sortSelect),
      el('div', { class: 'field' }, el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function badge(r) {
    return r.watchlist ? el('span', { class: 'badge watch', text: 'Watchlist' }) : el('span', { class: 'badge early', text: 'Early' });
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, badge(r))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Tokens that already trade: their market cap is a fact, not a model — and it is what prices the pre-token board. They are set aside from the ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'MCap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var benchRows = DATA.benchmarks.map(function (b) {
      return el('tr', null,
        el('td', { text: b.category }),
        el('td', { class: 'num', text: String(b.live_count) }),
        el('td', { class: 'num', text: b.multiple.toFixed(3) + 'x' }),
        el('td', { class: 'sub', text: b.source })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot\u2019s own figures. No protocol name is special-cased, and no row is hand-picked. A token is not worth the same fraction of TVL in every category, so each category is priced at the median market-cap-to-TVL ratio of the tokens in it that already trade.' }),
      el('div', { class: 'formula', html: 'implied = round( tvl_usd × <b>category multiple</b> × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + ') × (1 + ' + m.breadth_per_chain + ' × min(chains − 1, ' + m.breadth_max_chains + ')) )' }),
      el('p', { class: 'sub', text: 'TVL, seven-day growth, chain count and age come from the snapshot. Age is the time since the protocol was first listed — the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Category multiples are clamped to ' + m.multiple_floor + '–' + m.multiple_cap + 'x, and a category with fewer than ' + m.multiple_min_live + ' live tokens uses the global live median of ' + m.global_multiple + 'x. Implied value is an estimate, not a price.' }),
      el('h3', { text: 'Category multiples — read from the live tokens in each category' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'bench' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live tokens' }),
            el('th', { scope: 'col', text: 'Multiple' }),
            el('th', { scope: 'col', text: 'How it was read' })
          )),
          el('tbody', null, benchRows)
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var m = DATA.model;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : ' · Early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: row.category_multiple.toFixed(3) + 'x' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains || []).length + ' chains)' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. The protocol records no token; that is the snapshot\u2019s record, not proof it has none.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 8 steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(signals());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'footnote', text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. Implied value is this entry\u2019s model, never a price make.fun states. A protocol that records no token may still have one its DefiLlama record does not carry.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
