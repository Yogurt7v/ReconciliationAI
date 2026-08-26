<!-- stm:v1 -->
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- None captured yet.

### Long Horizon Context
- None captured yet.

### Decisions
- None captured yet.

### Conclusions
- None captured yet.

### Active References
- None captured yet.

</existing_memory>

<conversation_update>
USER:
Create or update `AGENTS.md` for this repository.

The goal is a compact instruction file that helps future OpenCode sessions avoid mistakes and ramp up quickly. Every line should answer: "Would an agent likely miss this without help?" If not, leave it out.

User-provided focus or constraints (honor these):


## How to investigate

Read the highest-value sources first:
- `README*`, root manifests, workspace config, lockfiles
- build, test, lint, formatter, typecheck, and codegen config
- CI workflows and pre-commit / task runner config
- existing instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`)
- repo-local OpenCode config such as `opencode.json`

If architecture is still unclear after reading config and docs, inspect a small number of representative code files to find the real entrypoints, package boundaries, and execution flow. Prefer reading the files that explain how the system is wired together over random leaf files.

Prefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source and only keep what you can verify.

## What to extract

Look for the highest-signal facts for an agent working in this repo:
- exact developer commands, especially non-obvious ones
- how to run a single test, a single package, or a focused verification step
- required command order when it matters, such as `lint -> typecheck -> test`
- monorepo or multi-package boundaries, ownership of major directories, and the real app/library entrypoints
- framework or toolchain quirks: generated code, migrations, codegen, build artifacts, special env loading, dev servers, infra deploy flow
- repo-specific style or workflow conventions that differ from defaults
- testing quirks: fixtures, integration test prerequisites, snapshot workflows, required services, flaky or expensive suites
- important constraints from existing instruction files worth preserving

Good `AGENTS.md` content is usually hard-earned context that took reading multiple files to infer.

## Questions

Only ask the user questions if the repo cannot answer something important. Use the `question` tool for one short batch at most.

Good questions:
- undocumented team conventions
- branch / PR / release expectations
- missing setup or test prerequisites that are known but not written down

Do not ask about anything the repo already makes clear.

## Writing rules

Include only high-signal, repo-specific guidance such as:
- exact commands and shortcuts the agent would otherwise guess wrong
- architecture notes that are not obvious from filenames
- conventions that differ from language or framework defaults
- setup requirements, environment quirks, and operational gotchas
- references to existing instruction sources that matter

Exclude:
- generic software advice
- long tutorials or exhaustive file trees
- obvious language conventions
- speculative claims or anything you could not verify
- content better stored in another file referenced via `opencode.json` `instructions`

When in doubt, omit.

Prefer short sections and bullets. If the repo is simple, keep the file simple. If the repo is large, summarize the few structural facts that actually change how an agent should work.

If `AGENTS.md` already exists at `/Users/sergej/VSProjects/ReconciliationAI`, improve it in place rather than rewriting blindly. Preserve verified useful guidance, delete fluff or stale claims, and reconcile it with the current codebase.

---

ASSISTANT:
Created `AGENTS.md` with the essential repo-specific guidance:

- **Quick commands** — `pnpm dev/test/typecheck/samples/smoke` and per-package filtering
- **Port gotcha** — 5057 default, not 5000 (AirPlay on macOS)
- **Environment setup** — `.env.example` → `backend/.env`, `OPENROUTER_API_KEY` degrades gracefully
- **TypeScript** — `verbatimModuleSyntax` requires `import type` for type-only imports
- **Test quirks** — backend 120s timeout, OCR opt-in with `RUN_OCR_E2E=1`, scan smoke `RUN_SCAN_SMOKE=1`
- **Package boundaries** — shared consumed by both backend/frontend via `workspace:*`
- **Backend architecture** — in-memory jobs, pipeline stages, parsers layout
- **Conventions** — Russian UI, no lint/format, no CI
</conversation_update>

</existing_memory>

<conversation_update>
USER:
мне не нравится распознование. Дата Документ на самом деле "Сальдо начальное" другие заголовки тоже неправильные

---

ASSISTANT:
Let me read the core structure detection files to understand the exact logic:

---

ASSISTANT:
Let me also check the frontend confirmation screen and reconciliation logic:

---

ASSISTANT:
Let me also look at what the `samples` script generates and the reconciliation report builder to understand the full picture:

---

ASSISTANT:
I've read through the entire structure detection pipeline. Here's my analysis of the problem:

## Root cause

The issue is in the **merge logic** in `backend/src/services/ai/structureAssist.ts:144-153`. When the AI model (GPT-4o-mini) returns column indices, they are **always preferred** over heuristic results. The merge only fills gaps — it never validates or overrides AI-provided values.

```
AI says: docDate → column 5 (actually "Сальдо начальное")
Heuristic says: docDate → column 1 ("Дата Документа") ← correct!
Merge result: docDate → column 5 (AI wins)
```

The heuristic regex `/^дата/i` correctly matches "Дата Документа", but the AI model confidently returns wrong column indices for real-world accounting tables with non-standard layouts. There's no cross-validation between AI and heuristic results.

## The code flow

1. `heuristics.ts:162-168` — `plan` regexes correctly map headers to fields
2. `structureAssist.ts:145` — `const columns = { ...parsed.columns }` — AI columns start as the base
3. `structureAssist.ts:146-153` — only fills `null` values from heuristic (no override)
4. If AI returns `docDate: 5` instead of `null`, the heuristic's correct `docDate: 1` is ignored

---

ASSISTANT:
First, let me strengthen the AI prompt:

---

ASSISTANT:
I'm in read-only plan mode. Let me present the complete plan:

---

## Plan: Fix header recognition (AI/ heuristic conflict)

### Problem

AI model (GPT-4o-mini) returns wrong column indices (e.g., `docDate` → "Сальдо начальное" column). The merge logic in `structureAssist.ts:144-153` always prefers AI columns, only filling `null` gaps from heuristics. The heuristic `/^дата/i` correctly matches "Дата Документа" but is overridden.

### Changes (2 files, ~30 lines)

#### 1. `backend/src/services/ai/structureAssist.ts` — Strengthen AI prompt

Replace `SYSTEM_PROMPT` (lines 30-40) with expanded version that:
- Explains typical "акт сверки" structure (header → data rows → summary rows)
- Explicitly says "Сальдо на начало/конец периода" and "Обороты за период" are **row labels**, not column headers
- Warns: do NOT assign `docDate` to cells containing "Сальдо" or "Обороты"
- Keeps existing field definitions (docNumber, docDate, amount, debit, credit)
