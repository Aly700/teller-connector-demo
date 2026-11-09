# Teller connector demo

An MCP connector that lets an agent read sample accounts and request transfers in Teller, a simulated payments API.

Sample data. No real money.

The agent gets three read tools and one write tool. It can look up accounts and transfers and ask for a transfer, but it cannot approve one. Every transfer request waits on a web page until a person approves it there, and Teller gets nothing before that. Approve, and the transfer posts once. Reject, and nothing is sent. If something crashes mid-transfer, it still never posts twice: a request with an unknown result is marked uncertain until it is checked.

## What is in the repo

- **MCP tools** for listing accounts, reading an account, reading a transfer and requesting a transfer.
- **Approval console** with a live request inbox, sample account balances, event timelines, deliberate browser approval, rejection and recovery. Inspect the session audit or download JSON lines. Dark and light themes follow your system preference, with a manual override.
- **80 evaluation cases** and a GitHub Actions workflow that uses your own Anthropic key. The report says "Not run yet" until model results are recorded.
- **Hosting config** for Cloudflare Workers, with Teller and Postgres on a small, always-on Mac behind a Cloudflare Tunnel.
- **Teller source** in `vendor/teller`, plus sample data, database migrations and tests.

## Run it locally

You need macOS, Node 26 and JDK 25 on PATH, and Homebrew PostgreSQL 16. From the repo root:

```sh
npm ci
scripts/start-local.sh
```

Open `http://localhost:8787` (use `localhost`, not an IP address). Connect an MCP client to `http://localhost:8787/mcp` and choose **Start sample session**. Each start resets the sample data. Local state, secrets and logs stay in `.data/`. You need no model key or cloud account to run it.

To stop everything:

```sh
scripts/stop.sh
```

To run the evaluation, create a GitHub environment called `model-eval` with the secrets `ANTHROPIC_API_KEY` and `EVAL_REPORT_SECRET` and the variables `EVAL_MODEL_ID` and `EVAL_REPORT_ORIGIN` (the address of your report page). It stays off until you set the repository variable `ENABLE_MODEL_EVAL=true`. To run locally in a dedicated evaluation checkout, use `EVAL_DATASET=isolated npm run eval:ci`; it replaces that checkout’s sample database.

## Tests

Install Google Chrome, then run:

```sh
scripts/ci.sh
```

It installs everything, builds Teller, and tests approval, rejection, crash recovery and reset in a real browser. It runs on this machine only and calls no model. Set `NODE_BIN`, `JAVA_HOME`, `PG_BIN` or `CHROME_PATH` to use other installs. Teller's own Docker-based tests are not run.

The console brings requests, balances, policies, audit events, evaluation cases and connection settings into one workspace, with measured session charts and plain-language request explanations. Server-rendered pages use one dependency-free script for search, tables, request drawers, keyboard controls, time display and Auto, Light or Dark themes. Approval also works without JavaScript.

## License

MIT. See [LICENSE](LICENSE). Teller is also by Affan Yasir and is included unmodified from commit `9418e33`, under the same licence. The bundled fonts, Manrope and IBM Plex Mono, are under the SIL Open Font License; notices are in `apps/mcp/assets/FONT-LICENSES.txt`.
