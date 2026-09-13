# Toolsmith Agent (Google Apps Script)

**Toolsmith Agent** is an autonomous, single-agent/multi-skill system built on Google Apps Script and Groq's `openai/gpt-oss-120b`. One shared agent loop drives several independent "skills" (acting opportunities, scene study, SWE job listings) rather than running separate agent instances per goal.

See also: [ARCHITECTUREOVERVIEW.md](./ARCHITECTUREOVERVIEW.md) · [CONTRIBUTING.md](./CONTRIBUTING.md)

## What this is
A scheduled agent that wakes up on triggers, reasons about what to do using an LLM-driven planner/tool-dispatch loop, and executes tools (fetching data, filtering duplicates, sending emails, etc.) to accomplish a goal. New goals are added as **skills**, not new agents.

## Key design decisions
- **Single agent, multiple skills.** One `agentLoop()` / `planner()` / tool-dispatch pipeline is shared across all goals. Per-goal `.gs` files (e.g. `actorSchedule.gs`) are just schedule/trigger entry points — they are not separate assistants.
- **Groq free tier constraint (8,000 TPM cap)** shaped several decisions: agent/skill instructions are kept out of required LLM output, and prompts are kept lean.
- **Idempotent, deduped tool design.** `filterSentOpportunities` dedupes actor/SWE listings against a 10-day TTL sent-history so nothing gets re-emailed.
- Considered a strong resume project: agentic system design without a framework, with real production concerns (rate limits, caching, idempotent tools).

## Repository structure
This repo is a **public mirror** of a live Google Apps Script project, bridged via [`clasp`](https://github.com/google/clasp) — Apps Script has no local runtime, so the `.gs` files here are the same source that runs in Google's cloud, not a separate local version.

```
.
├── util.gs                  # core engine: llm(), execute(), agentLoop(), planner(), tools
├── db.gs                    # hash-table storage over Google Sheets
├── actorSchedule.gs         # (and other per-goal schedule/trigger files)
├── appsscript.json          # Apps Script manifest (pulled by clasp)
└── docs/
    ├── AGENT.md              # snapshot of the AGENT Google Doc
    ├── TOOLS.md               # snapshot of the TOOLS Google Doc
    └── SKILLS.md              # snapshot of the SKILLS Google Doc
```
The `docs/` files are **point-in-time exports** of the live Google Docs the agent actually loads at runtime (via `loadAgent()` etc.) — they're for public readability, not the live source. Re-export them after any change to the real Docs, since there's no automatic sync.

## Required properties / environment variables
This project runs on Google Apps Script, so configuration lives in **Script Properties** (Project Settings → Script Properties) rather than a `.env` file — none of this lives in the repo.

| Property | Purpose | Required |
|---|---|---|
| `GROQ_API_KEY` | Auth for `llm()` calls to Groq (`openai/gpt-oss-120b`) | Yes |
| `AGENT_DOC_ID` | Google Doc ID for the AGENT instructions doc, loaded via `loadAgent()` | Yes |
| `TOOLS_DOC_ID` | Google Doc ID for the TOOLS definitions doc | Yes |
| `SKILLS_DOC_ID` | Google Doc ID for the SKILLS definitions doc | Yes |
| `DB_SPREADSHEET_NAME` (or equivalent) | Spreadsheet used by `db.gs` as hash-table storage (sent-history, per-skill caches) | Yes |

> Note: property names above reflect the project's known architecture (a Groq key, three doc IDs, and a storage spreadsheet are all required inputs) — confirm the exact key names against your live Script Properties, since these weren't dictated verbatim in project notes.

## Deploy your own copy

> Apps Script runs on Google's servers, not on your machine — "deploying" here means pushing this repo's code into your own Apps Script project via `clasp`, not running it locally.

### Prerequisites
- Node.js (for `clasp`) and a Google account with Apps Script access.
- A Groq account with an API key (free tier: `openai/gpt-oss-120b`, capped at 8,000 TPM).

### Steps
1. **Install clasp** and log in: `npm install -g @google/clasp` then `clasp login`.
2. **Clone this repo**, then either `clasp create` (new Apps Script project) or point `.clasp.json` at an existing `scriptId` you own.
3. **Create the three Google Docs** the agent depends on: AGENT, TOOLS, SKILLS — you can start from the `docs/*.md` snapshots in this repo as content. Record each new Doc's ID.
4. **Set Script Properties** in the Apps Script UI (Project Settings → Script Properties) per the table above — never commit the Groq API key or doc IDs to the repo.
5. **Set up the underlying Sheets** that `db.gs` uses as hash-table storage (sent-history, per-skill caches, etc.).
6. **Push and deploy**: `clasp push` to sync the code into your Apps Script project.
7. **Wire up triggers** for each skill's schedule file (Apps Script → Triggers → Add Trigger), pointing each at its own entry function.
8. **Test one skill at a time** (e.g. run `send-scene-study` manually) before enabling all triggers, since the shared agent loop makes all skills sensitive to AGENT/TOOLS/SKILLS doc formatting.
9. **Watch TPM usage** early on — the 8,000 TPM Groq free-tier cap is the tightest constraint in this system.

### Keeping the repo and live script in sync
Pick one direction as source of truth to avoid silently overwriting changes:
- **Repo is source of truth**: edit `.gs` files locally, `clasp push` to deploy.
- **Apps Script UI is source of truth**: edit in the browser editor, `clasp pull` before your next local edit, then commit.

## Planned direction
- Eventually migrate to Node + Docker/Kubernetes, exposing the custom tools via MCP (Model Context Protocol) so they're callable by any MCP-compatible client, not just this project's own planner loop.
- Extract a shared `utils` package (the `llm()` wrapper, a generic sheet-by-name resolver) usable by both this project and the separate finance tracker, once each is split into its own repo.
