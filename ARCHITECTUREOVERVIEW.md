# Architecture Overview — Toolsmith Agent

For newcomers to the codebase. See [README.md](./README.md) for a high-level summary and [CONTRIBUTING.md](./CONTRIBUTING.md) for setup.

## Core files
| File | Responsibility |
|---|---|
| `util.gs` | Core engine: `llm()` (LLM call wrapper), `execute()`, `agentLoop()`, `planner()`, and tool functions |
| `db.gs` | Hash-table storage layered over Google Sheets, with collision handling via linear probing |
| Per-goal schedule files (e.g. `actorSchedule.gs`, formerly `cronjob.gs`) | Trigger entry points only — set up the schedule, then call into the shared agent loop |
| **AGENT doc** (Google Doc) | Loaded at runtime via `loadAgent()`; defines the agent's overall instructions/persona |
| **TOOLS doc** (Google Doc) | Defines available tools for the planner |
| **SKILLS doc** (Google Doc) | Defines the pluggable skills the agent can run |

## How a run works, conceptually
1. A time-based Apps Script trigger fires a per-goal schedule file.
2. That file invokes the shared `agentLoop()`.
3. `agentLoop()` loads the AGENT/TOOLS/SKILLS docs and calls `planner()`, which asks the LLM (via `llm()`) what to do next given the goal and available tools.
4. The planner's chosen tool calls run through `execute()`, which dispatches to the actual tool functions in `util.gs`.
5. State (sent-history, caches, etc.) is persisted via `db.gs`'s hash-table-over-Sheets layer.

## Skills (pluggable goals)
- **send-acting-opportunities** — finds and emails acting opportunities.
- **send-scene-study** — rotates through scene tags (`selectSceneTags`), paginates, and tracks a per-script "already sent" cache via `getNextSceneScript()`.
- **send-swe-jobs** — `fetchSweJobs()` hits RemoteOK's public JSON API directly (bypassing a scraping tool like Firecrawl, since the API is already structured data).

## Cross-cutting concern: deduplication
`filterSentOpportunities` is a shared tool that checks new acting/SWE listings against a 10-day TTL sent-history log (stored via `db.gs`) so the agent never emails the same opportunity twice.

## Design constraints to keep in mind
- Groq's free tier caps `openai/gpt-oss-120b` at 8,000 TPM — this is the tightest constraint in the system and has already shaped prompt design (agent/skill instructions kept out of required LLM output, prompts kept lean).
- The system is intentionally **one agent loop, many skills** — resist the urge to spin up a second agent loop for a new goal; add a skill instead.

## Where this is headed
- Migration to Node + Docker/Kubernetes is planned but not started, with the custom tools eventually exposed via MCP (Model Context Protocol) so they can be used by any MCP-compatible client, not just this project's own planner loop.
- A shared `utils` package (the `llm()` wrapper, a generic sheet-by-name resolver) is planned to be extracted for reuse between this project and the finance tracker, once both are split into separate repos.
