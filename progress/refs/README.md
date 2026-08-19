# Reference shots — the bars P0..P6 are judged against

Captured by `npm run capture-refs` (scripts/capture-refs.mjs) at 1600x1000 @1.5x, dark
colour scheme. These are the public pages named in SPEC.md's quality table; compare
`progress/shots/*.png` against them. `manifest.json` records the exact URL and capture
time of every file; re-shoot one with `node scripts/capture-refs.mjs --only <name>`.

| File | Bar | Source | Captured |
|---|---|---|---|
| `vscode-pr-1.png` | Merged PR "agentHost: make the orchestrator own session enumeration and chat lifecycle" — an 11k-character description: summary, what each layer now owns, and how it was validated. | <https://github.com/microsoft/vscode/pull/329633> | 2026-08-19T04:17Z |
| `vscode-pr-2.png` | Merged PR "Integrate Copilot Voice conversation engine" — module-by-module walkthrough with rationale and follow-up notes. | <https://github.com/microsoft/vscode/pull/320785> | 2026-08-19T04:17Z |
| `vscode-issues.png` | Issue list — the bar for the bug board: dense rows, labels, assignees and state at a glance. | <https://github.com/microsoft/vscode/issues> | 2026-08-19T04:17Z |
| `grafana-play.png` | Grafana Play dashboard — the bar for the status dashboard: stat tiles, time series, dense panel grid. | <https://play.grafana.org/d/lAoEVhD7z/home-kubernetes-integration?orgId=1> | 2026-08-19T04:17Z |
| `grafana-play-2.png` | Grafana Play dashboard — stat tiles over live data, a geomap, a log table and time series below the fold: the density the status dashboard is measured against. | <https://play.grafana.org/d/T512JVH7z/loki-nginx-service-mesh-json-version?orgId=1> | 2026-08-19T04:17Z |
| `grafana-play-3.png` | Grafana Play "Time series graphs" — how Grafana draws a chart: axes, grid, legend and multi-series colour on live data. The reference for the dashboard's charts (work completed over time, bugs opened vs resolved). | <https://play.grafana.org/d/000000016/time-series-graphs?orgId=1> | 2026-08-19T04:17Z |
| `linear-home.png` | linear.app homepage — the visual bar for every screen. | <https://linear.app/> | 2026-08-19T04:17Z |
| `linear-product.png` | linear.app homepage, scrolled to the product UI shots. | <https://linear.app/> | 2026-08-19T04:17Z |
| `linear-issues.png` | linear.app product page — list density, status pills, sidebar treatment. | <https://linear.app/plan> | 2026-08-19T04:17Z |
| `linear-features.png` | linear.app features page — more product UI at full width. | <https://linear.app/features> | 2026-08-19T04:17Z |

## Which screen is judged against which reference

| App screen | Reference |
|---|---|
| `shots/work-detail.png` | `refs/vscode-pr-1.png`, `refs/vscode-pr-2.png`, `refs/linear-*.png` |
| `shots/work-list.png` | `refs/vscode-issues.png`, `refs/linear-issues.png` |
| `shots/bugs.png`, `shots/bug-detail.png` | `refs/vscode-issues.png`, `refs/linear-*.png` |
| `shots/dashboard.png` | `refs/grafana-play.png`, `refs/grafana-play-2.png`, `refs/grafana-play-3.png` |
| `shots/projects.png`, shell | `refs/linear-home.png`, `refs/linear-product.png` |
