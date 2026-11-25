# Council mode for the map's Ask bar

## Intent

Before building a feature, the user wants to see it from several sides at once instead of asking one agent. They
pick **Council** in the Ask bar, write one request ("make feature X"), and get:

- four independent opinions, written in parallel by a **programmer**, an **analyst**, a **risk manager** and a
  **tester**;
- a **summary** that explains in plain words what would happen and where it leads.

The council only analyzes. It changes no code. Turning a council's result into a code change stays a separate step:
the user switches to **Change code** and writes that request themselves.

## Goals

- One request starts all four roles at the same time. The total wait is about one answer plus the summary.
- Each role reads the code, the map and Jira/Confluence with the tools enabled in the agent panel, read-only, the
  same as Ask today.
- Roles don't see each other's answers, so their opinions stay independent.
- The summary sees only the four answers. It runs no tools and reads no code.
- The user can see which role is doing what while they work, and afterwards what each role used.
- A role that fails doesn't sink the council. Its tab shows the error, and the summary says that role is missing.
- A council is kept in history like other answers.

## Non-goals

- Editing roles, or adding and removing them from the UI. The four roles are fixed in code.
- Roles debating or making a second round after seeing each other's answers.
- Turning the council into a code change ("do it" button). That may come later.
- Follow-up questions that continue a council's sessions. Each council stands alone.

## Anti-goals

- Any role able to write files or run anything beyond what Ask may run today.
- A role prompt or the summary that a repo file can change. Role texts live in serve.mjs.
- Hiding cost: the mode's label says it runs 5 agents.

## Approaches

1. **The map server runs the council (picked).** One `POST /api/ask` with `mode: "council"`. serve.mjs starts the
   four roles in parallel with the existing `runAgent`, then the summary, and streams one SSE stream where every
   event carries a `role`. Access rules stay where they are today. A failed role doesn't stop the others.
2. **The browser runs the council.** The page sends four Ask requests with a role, then a fifth for the summary.
   Less server code, but a reload mid-council loses it, and "the summary sees only the answers" would depend on the
   page.
3. **One agent with subagents (Task tool).** Rejected: per-role tool use can't be shown, and subagents bypass the
   agent panel's limits.

The user picked approach 1.

## Design

### Roles (fixed, in serve.mjs)

Every role gets the same base as Ask (`floorplanAskInstructions` + product context + CLAUDE.local.md through the
CLI), then its own text, and answers with the Ask answer schema (text + board cards). Each focuses on:

- **Programmer**: which services, files and endpoints the request touches; what exists already and what's missing;
  rough size of the work.
- **Analyst**: why it matters to users and the business; scenarios and edge cases; related Jira issues
  (URB/ESCROW); what's unclear in the requirements.
- **Risk manager**: security, what could break in other services, what
  must be checked before release.
- **Tester**: which tests already exist in the affected services; what to cover (positive, negative, edge cases);
  how to verify it by hand or with the Podman checks.

Every role is told to stick to its own angle, ground claims in code or Jira, and label guesses as guesses.

**Summary**: gets the request and the four answers (each role's text, plus a note for any role that failed). It
explains in plain words what would happen and where it leads, where the roles agree and where they conflict, the
main risks and open questions, and a suggested next step. No tools (`--tools ""`), answer schema with text only
(cards optional, taken from the roles' cards).

All answers are in the language of the request.

### Server

- `MODES.council` exists on code maps with the Claude engine only (not blueprints, not Codex): Codex can't run the
  summary without tools, and the page shows the mode switch only on Claude. Each role is a mode-like object
  `{ instructions, schema }` built in `load()`.
- `ask()` routes `mode: "council"` to `council(res, send, body)`:
  - wraps `send` per role so every event gets `role` (`start`, `progress`, `answer`, `failure`);
  - runs the four with `Promise.allSettled(runAgent(...))`;
  - if all four failed, sends `failure` and stops;
  - sends each role's `answer` as soon as that role finishes, so the user can read it while the others work;
  - otherwise runs the summary, then sends the final `answer`
    `{ council: true, summary, roles: { programmer: {answer|error, used, cards}, ... } }`;
  - if the summary fails, the council is still delivered: the four roles plus `summary: { error }`;
  - the browser closing or **Stop** kills every running child (each `runAgent` already watches `res` close).
    There's no per-role time limit: a stuck role is ended with Stop.
- `runAgent` needs one change: its `res.on('close')` listener and progress plumbing must work with several runs on
  one response (it already does per call; check there's no single-run assumption such as `running` ids).

### Page

- A third button in the mode switch: **Council** (title: "4 experts + summary, 5 agents").
- While running: four rows, one per role, each with a spinner and its latest progress line ("Programmer: reading
  auth/backend…"). The summary row appears once the roles finish.
- The result has tabs: **Summary** (open), **Programmer**, **Analyst**, **Risks**, **Tester**. Each tab renders
  like an Ask answer (text, cards on the board) with its own "what it used" block. A failed role's tab shows its
  error.
- History stores a council as one entry (`kind: 'council'`) with the summary and the four answers, in a
  conversation of its own. The current Ask conversation is left as it was, so the next Ask continues it. Reopening
  shows the same tabs. "Continue" isn't offered for a council conversation.
- **Stop** after some roles finished keeps them: the page saves a partial council (finished roles, the rest marked
  stopped, no summary) and shows it. Stop before any role finished closes the sheet as today.
- A failed summary shows its error on the Summary tab; the role tabs work as usual.

## Left to the builder

- Exact role prompt wording, within the focus above.
- How the board shows cards when switching tabs (each tab shows its own cards; Summary shows the union).
- Progress text wording.
