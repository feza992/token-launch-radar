# Token Launch Radar — make.fun token-radar-01

A program plus the dashboard it writes: it ranks pre-token protocols by implied
value and tells you how to farm each one.

- `main.ts` (Node, standard library only) reads the sealed DefiLlama snapshot at
  `input/snapshot.json`, writes a ranked board to `output/board.json`, writes the
  dashboard's data beside the page, and writes `output/dossier.json`.
- `dashboard/` is the page itself: a sortable, filterable board with a per-protocol
  farm plan. No network — all data is local.
- `screenshots/` are renders of the dashboard.

## The value model (radar-2)

Each protocol is priced at its own category's live-token multiple, read out of the
snapshot itself:

`implied = TVL × catMultiple × growthMult × maturityMult × breadthMult`

- `catMultiple`: median market-cap / TVL of the live-token protocols in the same
  category (clamped 0.05–1.00x; global live median 0.2227x when a category has
  fewer than 3 live tokens).
- `growthMult = 1 + clamp(change_7d, −60, 120) / 100 × 0.5`
- `maturityMult = 0.6 + min(age_days, 1095) / 1095 × 0.4` (unknown age = 365d)
- `breadthMult = 1 + 0.05 × min(chains − 1, 4)`

Only protocols that record no token — and are not wrapped, staked or bridged
products of one — are ranked. The dashboard states the formula and shows a
per-category benchmark table.

## Run it

```sh
node main.ts --input /path/to/snapshot.json
```

Output goes to `output/` (or `$MAKEFUN_OUTPUT_DIR`): `board.json`, `data.js`,
`dashboard/`, `screenshots/`, `dossier.json`.

## License

MIT — see `LICENSE`.
