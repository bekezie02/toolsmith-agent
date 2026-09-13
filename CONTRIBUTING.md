# Contributing — Toolsmith Agent

Coding standards and submission steps for this project. See [README.md](./README.md) for what it does and how to install it, and [ARCHITECTUREOVERVIEW.md](./ARCHITECTUREOVERVIEW.md) for how the pieces fit together.

## Coding standards

- **One agent loop, many skills.** Never add a second `agentLoop()`/`planner()` pipeline for a new goal. Add a skill to the SKILLS doc and, if needed, a schedule file that simply calls the existing shared loop. Per-goal `.gs` files are trigger entry points only — keep business logic out of them.
- **Keep prompts lean.** The Groq free tier caps `openai/gpt-oss-120b` at 8,000 TPM. Don't add agent/skill instructions to required LLM output; keep AGENT/TOOLS/SKILLS doc content and prompts as small as the task allows.
- **Tools must be idempotent.** Any tool that sends something externally (email, notification) must be safe to re-run without duplicating output — follow the `filterSentOpportunities` pattern (TTL sent-history via `db.gs`) rather than inventing a new dedup mechanism per skill.
- **Secrets never in source.** Groq API key and Google Doc IDs belong in Script Properties, never hardcoded or committed.
- **Respect file boundaries:**
  - `util.gs` — core engine only (`llm()`, `execute()`, `agentLoop()`, `planner()`, tool functions).
  - `db.gs` — storage only (hash-table-over-Sheets, collision handling).
  - Schedule files — triggers/entry points only.
- **New tools** get documented in the TOOLS doc before (or in the same change as) their implementation, so the planner can discover them.

## Submission steps

1. **Branch from the latest pushed state.** `clasp pull` first if the live Apps Script project may have changed via the browser IDE since your last pull, so you don't clobber it; then create a git branch off `main`.
2. **Implement the change**, respecting the file boundaries and patterns above.
3. **Test manually before wiring a trigger**: run the affected skill's entry function directly in the Apps Script editor (or via `clasp run`) and confirm expected behavior, especially dedup behavior and TPM usage, before enabling or re-enabling a time-based trigger.
4. **Update the relevant Google Doc(s)** (AGENT/TOOLS/SKILLS) in the same change if the change adds or alters a tool or skill — code and doc drifting apart breaks the planner silently.
5. **Re-export doc snapshots.** If you changed AGENT/TOOLS/SKILLS, update the matching file under `docs/` so the public repo reflects the live Docs — this repo's `docs/*.md` files are point-in-time exports, not synced automatically.
6. **`clasp push`** to sync, then do a final manual run to confirm the deployed version behaves as tested.
7. **Commit and open a pull request on GitHub.** Describe the change (what skill/tool it touches, why, and how it was tested) — since failures here are silent (a malformed doc, a TPM overrun), the description should make it easy to verify without re-deriving your test steps. Merge only after the manual test in step 3/6 passes.
