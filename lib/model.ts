// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks only protocols that record no token and are not a wrapped, staked or bridged
// product of a token that already trades: the same exclusions the snapshot's own watchlist uses
// (Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories,
// version-marked names, wrapped / staked / staking in the name, exchange-prefixed names). The
// watchlist is the floor: every one of its 40 slugs is ranked, and the early radar adds every other
// protocol the rule keeps below the floor. Live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, never from a hand-written list of
// names. The one idea the starter missed: a token is not worth the same fraction of TVL in every
// category. The market already tells us what each category's token is worth per dollar of TVL, so
// the model reads that benchmark out of the snapshot itself — the median market-cap-to-TVL ratio of
// the live-token protocols in the same category — and prices each pre-token protocol at its own
// category's multiple:
//
//   catMultiple = clamp(median(mcap_usd / tvl_usd over live-token protocols in the category), 0.05, 1.00)
//                 (global live median 0.2227 when the category has fewer than 3 live protocols)
//   growth      = clamp(change_7d, -60, 120) per cent
//   growthMult  = 1 + (growth / 100) x 0.5
//   maturity    = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth     = 1 + 0.05 x min(chains - 1, 4)            (more chains, more surface)
//   implied     = max(1, round(tvl_usd x catMultiple x growthMult x maturity x breadth))
//
// A protocol that has run longer with no token has had longer to earn one; a protocol whose TVL is
// still growing earns a higher multiple; a protocol live on more chains has more surface for a
// launch. The dashboard states the formula and shows every category's multiple, so the ranking can
// be checked row by row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  multiple_min_live: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  global_multiple: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  multiple_min_live: 3,
  breadth_per_chain: 0.05,
  breadth_max_chains: 4,
  global_multiple: 0.2227,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One row of the dashboard's category-benchmark table. */
export interface CategoryBenchmark {
  category: string;
  live_count: number;
  multiple: number;
  source: string;
}

/** Everything the dashboard needs: the board, the live set, the benchmarks, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  benchmarks: CategoryBenchmark[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers, or null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The category benchmarks: for each category, the median market-cap-to-TVL ratio of its live-token
 * protocols, clamped to the model's floor and cap; the global live median when a category has fewer
 * than `multiple_min_live` live protocols. Computed from the snapshot alone, once per build.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): Map<string, { multiple: number; source: string; liveCount: number }> {
  const liveByCategory = new Map<string, number[]>();
  const liveAll: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    liveAll.push(ratio);
    const key = p.category ?? 'Other';
    const list = liveByCategory.get(key) ?? [];
    list.push(ratio);
    liveByCategory.set(key, list);
  }
  const global = median(liveAll) ?? model.global_multiple;
  const out = new Map<string, { multiple: number; source: string; liveCount: number }>();
  const categories = new Set(snapshot.protocols.map((p) => p.category ?? 'Other'));
  for (const category of categories) {
    const list = liveByCategory.get(category) ?? [];
    if (list.length >= model.multiple_min_live) {
      const raw = median(list)!;
      const clamped = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
      out.set(category, {
        multiple: Math.round(clamped * 1e4) / 1e4,
        source: `median of ${list.length} live ${category} tokens`,
        liveCount: list.length,
      });
    } else {
      out.set(category, {
        multiple: Math.round(Math.min(model.multiple_cap, Math.max(model.multiple_floor, global)) * 1e4) / 1e4,
        source: `global live median (only ${list.length} live ${category} token${list.length === 1 ? '' : 's'})`,
        liveCount: list.length,
      });
    }
  }
  return out;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: Map<string, { multiple: number; source: string; liveCount: number }>,
): { implied: number; categoryMultiple: number; multipleSource: string; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const entry = multiples.get(protocol.category ?? 'Other')!;
  const categoryMultiple = entry.multiple;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult * breadthMult));
  return { implied, categoryMultiple, multipleSource: entry.source, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** Categories whose token would be a wrapped, staked or bridged product of one that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in the name: a staked receipt, not a launch of its own. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name: the exchange's own product, not a protocol launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked or bridged product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_OR_STAKED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the rule keeps, below the watchlist floor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMultiple,
      category_multiple_source: s.multipleSource,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * One category family's farm shape: the main action, the second qualifying action, and the risk to
 * watch. The family is matched on the protocol's category words, never on its name.
 */
interface FarmFamily {
  main: (name: string, capital: number, chain: string) => string;
  second: (name: string, capital: number, chain: string) => string;
  risk: string;
}

const FAMILIES: { match: RegExp; family: FarmFamily }[] = [
  {
    match: /lend|cdp|collateral/,
    family: {
      main: (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the supply position open.`,
      second: (n, c) => `Borrow $${Math.max(10, Math.round(c / 5))} of a stablecoin against the supply, then repay it the same week.`,
      risk: `Watch the health factor: a borrow that slips under 1 gets liquidated, so keep the loan small.`,
    },
  },
  {
    match: /dex|amm/,
    family: {
      main: (n, c, ch) => `Provide $${c} of liquidity to ${n}'s deepest pool on ${ch}, in the pair the app itself suggests.`,
      second: (n, c, ch) => `Swap $${Math.max(10, Math.round(c / 10))} through ${n} on ${ch} so the wallet shows both providing and trading.`,
      risk: `Impermanent loss: a pool whose assets drift apart pays less than holding them, so favour the stable pair.`,
    },
  },
  {
    match: /yield aggregator|vault|curator|allocator/,
    family: {
      main: (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the vault shares.`,
      second: (n, c, ch) => `Claim the vault's rewards once, then deposit the claimed amount back into the same vault on ${ch}.`,
      risk: `The vault's strategy can change: read the vault's own page before each deposit, not the headline APY.`,
    },
  },
  {
    match: /yield/,
    family: {
      main: (n, c, ch) => `Deposit $${c} into ${n}'s highest-TVL yield position on ${ch} and keep it open.`,
      second: (n, c) => `Harvest the position's rewards once a week and restake them instead of selling them.`,
      risk: `Yield is paid in the protocol's own incentives: a falling reward token can erase the yield, so track it weekly.`,
    },
  },
  {
    match: /rwa/,
    family: {
      main: (n, c, ch) => `Mint $${c} of the protocol's yield-bearing asset through ${n} on ${ch} and hold it.`,
      second: (n, c, ch) => `Move $${Math.max(10, Math.round(c / 10))} of the minted asset into the protocol's own secondary use on ${ch}, such as its lending market.`,
      risk: `The asset is backed by off-chain holdings: check the issuer's reserve report before minting more.`,
    },
  },
  {
    match: /perpetual|derivative|basis/,
    family: {
      main: (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} on ${ch} and open one small hedged position.`,
      second: (n, c) => `Close the hedge and open a fresh one in the opposite direction, keeping the margin at $${c}.`,
      risk: `Leverage liquidates fast: keep the position small and never add margin to a losing trade.`,
    },
  },
  {
    match: /prediction/,
    family: {
      main: (n, c, ch) => `Fund $${c} on ${n} on ${ch} and take one position in a market that settles within the month.`,
      second: (n, c) => `Take a second position in a different market on ${n} so the wallet shows more than one outcome.`,
      risk: `A market can resolve against you: only stake what you can lose, and never chase a loss.`,
    },
  },
  {
    match: /launchpad/,
    family: {
      main: (n, c, ch) => `Hold $${c} in ${n}'s staking or allocation position on ${ch} so the wallet qualifies for a sale.`,
      second: (n) => `Join one ${n} sale with the smallest allowed ticket and hold the allocation.`,
      risk: `An allocation is not guaranteed: the sale can oversubscribe, so the position may earn nothing.`,
    },
  },
  {
    match: /insurance/,
    family: {
      main: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy for its full term.`,
      second: (n, c, ch) => `Renew or extend the cover on ${n} on ${ch} once, so the wallet shows two cover periods.`,
      risk: `Cover pays only on the policy's own terms: read what events are excluded before buying.`,
    },
  },
  {
    match: /staking|restak/,
    family: {
      main: (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} on ${ch} and keep the receipt token.`,
      second: (n, c, ch) => `Use $${Math.max(10, Math.round(c / 10))} of the receipt token in ${n}'s own app on ${ch}, such as its lending market.`,
      risk: `Staked assets can unbond slowly and can be slashed: keep enough unstaked to pay gas.`,
    },
  },
  {
    match: /liquidity manager|leveraged farm/,
    family: {
      main: (n, c, ch) => `Deposit $${c} into ${n}'s managed position on ${ch} and let it rebalance.`,
      second: (n, c, ch) => `Add $${Math.max(10, Math.round(c / 10))} to the same managed position on ${ch} after a week.`,
      risk: `A managed position still carries impermanent loss, and leverage multiplies it: keep the deposit modest.`,
    },
  },
  {
    match: /index/,
    family: {
      main: (n, c, ch) => `Buy $${c} of ${n}'s index token on ${ch} and hold it.`,
      second: (n, c, ch) => `Rebalance by buying $${Math.max(10, Math.round(c / 10))} more of the index after a month on ${ch}.`,
      risk: `The basket can fall with its weakest holding: check the index's composition before buying.`,
    },
  },
  {
    match: /farm/,
    family: {
      main: (n, c, ch) => `Provide $${c} of liquidity, then stake the LP tokens in ${n}'s farm on ${ch}.`,
      second: (n) => `Harvest the farm's rewards once a week and stake them again instead of selling them.`,
      risk: `Farm rewards dilute as more farmers join: the first weeks pay the most, so start early and track the rate.`,
    },
  },
  {
    match: /chain/,
    family: {
      main: (n, c, ch) => `Bridge $${c} of USDC onto ${n} on ${ch} and use it in two of the chain's own apps.`,
      second: (n, c, ch) => `Swap $${Math.max(10, Math.round(c / 10))} on ${n}'s native DEX on ${ch} and keep a small balance for gas.`,
      risk: `Bridges are the most exploited contracts in the space: bridge only what you plan to use.`,
    },
  },
  {
    match: /stable/,
    family: {
      main: (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch} and hold it.`,
      second: (n, c, ch) => `Use $${Math.max(10, Math.round(c / 10))} of the stable asset in ${n}'s own market on ${ch}.`,
      risk: `A stable asset can depeg: watch its price against a dollar before minting more.`,
    },
  },
];

const GENERIC_FAMILY: FarmFamily = {
  main: (n, c, ch) => `Deposit $${c} of USDC into ${n} on ${ch} and keep the position open.`,
  second: (n, c, ch) => `Make a second deposit of $${Math.max(10, Math.round(c / 10))} into ${n} on ${ch} a week later.`,
  risk: `Smart contracts can fail: only deposit what you can afford to lose, and never share a seed phrase.`,
};

/** The family a category's words match, or the generic one. */
function familyFor(p: SnapshotProtocol): FarmFamily {
  const c = (p.category ?? '').toLowerCase();
  for (const { match, family } of FAMILIES) if (match.test(c)) return family;
  return GENERIC_FAMILY;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Two steps are the same for every protocol (wallet hygiene, the log); the rest follow the
 * category family, the capital tier and the hold window.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyFor(p);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: family.main(p.name, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: family.second(p.name, capital, chain),
      cost: `about $${Math.max(2, Math.round(gas / 2))} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open the protocol's own points or rewards page once a week and check what the position has earned.`,
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: family.risk,
      cost: 'nothing to check, and never pay anyone to farm for you',
      time: '5 minutes',
    },
    {
      text: `Before you withdraw, claim only from the link the protocol itself publishes, and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The dashboard's category-benchmark table, strongest categories first. */
export function benchmarks(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryBenchmark[] {
  const multiples = categoryMultiples(snapshot, model);
  const used = new Set(snapshot.protocols.filter(isRankable).map((p) => p.category ?? 'Other'));
  return [...used]
    .map((category) => {
      const e = multiples.get(category)!;
      return { category, live_count: e.liveCount, multiple: e.multiple, source: e.source };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
    benchmarks: benchmarks(snapshot, model),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
