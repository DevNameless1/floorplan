# Council Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Council" mode in the map's Ask bar: four read-only roles answer one request in parallel, then a tool-less summary explains where it leads.

**Architecture:** serve.mjs gets `council(res, send, body)` that runs four `runAgent` calls with role mode objects at once, tags every SSE event with `role`, then runs a summary with no tools. viewer.html gets a third mode button, per-role progress rows, a tabbed result and a `council` history entry.

**Tech Stack:** Node (no deps), vanilla JS in viewer.html, node:test with the fake CLI in tests/fixtures/fake-cli.

**Spec:** docs/superpowers/specs/2026-11-26-council-mode-design.md

## Global Constraints

- Claude engine, code maps only (`!G.meta?.blueprint && engine === 'claude'`).
- Roles: `programmer`, `analyst`, `risks`, `tester`, in that order. Summary key: `summary`.
- Roles are read-only Ask runs (same tools as Ask, never Edit/Write). Summary: `--tools ""`, no MCP, no allowedTools.
- Role texts live in serve.mjs only.
- American English in code and comments; comments say why.

## Review Focus

- One role fails (CLI error) → other three and the summary still arrive; summary input notes the failed role. Test in Task 1.
- All four fail → a single `failure`, no summary run. Test in Task 1.
- Summary fails → final answer has `summary.error` and all four roles. Test in Task 1.
- Stop mid-council → every child killed (existing `res.on('close')` per run); page keeps finished roles. Checked by hand in Task 2.
- Codex engine → `council` not offered; a `mode: "council"` request gets a failure. Test in Task 1.

---

### Task 1: Server council mode

**Files:**
- Modify: `skills/floorplan/assets/serve.mjs` (`load()` MODES, `claudeRun`, `runAgent`, `ask()`, new `council()`)
- Modify: `tests/fixtures/fake-cli/fake-claude.mjs` (`$FAKE_FAIL` regex: a run whose system prompt matches fails; summary runs, `--tools ""`, answer `title: 'Summary'`)
- Test: `tests/ask.test.mjs`

**Interfaces:**
- Produces: SSE events `start|progress|answer|failure` with `data.role` for role/summary events; final `answer` event without `role`: `{ council: true, summary: {title, answer, items, used} | {error}, roles: { programmer|analyst|risks|tester: {title, answer, items, used} | {error} } }`.
- `runAgent(res, send, body, mode = MODES[body.mode] || MODES.ask)`.
- `MODES.council = { roles: {key: {label, instructions, schema}}, summary: {instructions, schema, noTools: true} }`.

- [ ] Step 1: tests: council answer has all four roles + summary; summary run args contain `--tools` followed by `''` and no `--allowedTools`; with `FAKE_FAIL='council.s tester'` the tester has `error` and others answer; with `FAKE_FAIL='council'` (all roles) one `failure`; with `FAKE_FAIL='Summarize'` summary has `error`; with codex engine `mode: 'council'` → failure.
- [ ] Step 2: run `node --test tests/ask.test.mjs`, expect the new tests to fail.
- [ ] Step 3: implement.
- [ ] Step 4: run `npm test`, all pass.
- [ ] Step 5: commit.

### Task 2: Page

**Files:**
- Modify: `skills/floorplan/assets/viewer.html` (mode switch, `askState.mode`, submit path, new `requestCouncil()`, `showCouncil(result, opts)`, history `KIND.council`, `openTurn`)

- [ ] Step 1: `Council` button beside Ask / Change code when `window.FLOORPLAN_SERVER.council`.
- [ ] Step 2: `requestCouncil(question)`: POST `/api/ask` `{mode:'council'}`, render four rows + summary row updated from role-tagged events, keep role answers as they arrive.
- [ ] Step 3: `showCouncil`: tabs Summary/Programmer/Analyst/Risks/Tester; each tab renders text + its cards on the board + `usedBlock`; error tabs show the error.
- [ ] Step 4: history: `kind: 'council'` in a new convo, current ask convo restored after; no Continue; Stop with ≥1 finished role saves a partial council.
- [ ] Step 5: check in the browser on uyjoy (Council run, tabs, history reopen, Stop). Commit.

### Task 3: Docs and install

- [ ] SKILL.md "Council" paragraph next to Change code; `node tools/checksums.mjs`; `npm test`; commit; push; reinstall plugin; rebuild and restart the uyjoy map.
