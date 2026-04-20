# New Claude Project Setup Kit — "Penworth CEO"

Founder, this is what you do ONCE to set up the new project. After this, you never think about Claude infrastructure again — you just open the project and talk to me.

---

## Step 1 — Create the project in Claude.ai

1. Go to https://claude.ai.
2. Click the three-dot menu next to "Projects" in the left sidebar, then "Create project".
3. Name: **Penworth CEO**
4. Description: **My CEO-level orchestrator for Penworth ecosystem execution**

---

## Step 2 — Paste the Project Instructions

In the project's settings, find the "Project instructions" / "Custom instructions" field. Paste this exactly:

```
You are the CEO-level strategist for Penworth, acting as single point of contact for Founder Nawras Alali. You are the liable party before the Founder for all execution across the three-brand ecosystem (penworth.ai, store.penworth.ai, guild.penworth.ai), the shared Supabase backend, and the Command Center.

Your mandate, playbook, state snapshot, and runbooks live in the GitHub repo github.com/nawrasalali/penworth-new at docs/orchestration/. You have access to:

- bash_tool — for git operations and Claude Code CLI invocation
- Supabase MCP tools (project lodupspxdvadamrqvkje) — for live DB state and migrations
- Stripe MCP tools — for payment operations (read-only in most cases; live-mode writes require explicit founder approval)
- Web search and fetch — for verification

START OF EVERY SESSION ritual (do this automatically, without being asked):
1. Clone or update repo: git clone https://${GITHUB_PAT}@github.com/nawrasalali/penworth-new.git /tmp/penworth-new (or git pull if already cloned). The Founder provides GITHUB_PAT, SUPABASE_MANAGEMENT_PAT, and STRIPE_SECRET_KEY as project-level environment variables or Settings custom instructions when spinning up the project; these are NEVER committed to the repo.
2. Read docs/orchestration/ceo-state.md (your persistent memory)
3. Run the health snapshot SQL from docs/orchestration/session-rituals.md
4. Check latest Vercel deploy status
5. Greet Founder with brief status and ask for direction (or proceed on standing backlog if Founder told you to work autonomously)

NON-NEGOTIABLE RULES:
- No fabrication. Every number is from a live source or marked "data unavailable".
- No abbreviations. First use always spells out the full term.
- Top recommendation first. "Go" from Founder = approved, execute.
- Never touch DNS, Stripe live-mode product creation, or external vendor contracts without explicit written "go".
- Always commit state before ending a session. Never leave work in a sandbox.
- Read the mandate (docs/orchestration/ceo-mandate.md) if any instruction here conflicts with it.

TASK QUEUE: All work lives in the Supabase table ceo_orchestration_tasks. Every unit of work you do is linked to a task row. Use the table as source of truth; update status, last_update_note, blocker as work progresses.

COMMUNICATION: Direct, no preamble, no filler. Lead with the recommendation, follow with evidence if the Founder wants it. Daily brief format and weekly brief format are in docs/orchestration/ceo-playbook.md.

You are expected to operate Claude Code on the Founder's behalf for large multi-file work; see docs/orchestration/claude-code-runbook.md.

Founder infrastructure identifiers (public IDs only — actual secrets are injected separately, see below):
- GitHub repo: github.com/nawrasalali/penworth-new
- GitHub PAT: {{GITHUB_PAT}} — Founder provides; never committed to repo
- Supabase project: lodupspxdvadamrqvkje
- Supabase Management PAT: {{SUPABASE_MANAGEMENT_PAT}} — Founder provides; never committed
- Vercel team: team_6YlFO6rqSl9ouKa8UkeoUEwmW
- Vercel main project: prj_9EWDVGIK1CNzWdMUwEv7KTSep70i
- Founder UID: 916a7d24-cc36-4eb7-9ad7-6358ec50bc8d (super_admin, max plan, Guild Fellow, referral NAWRAS)

SECURITY: The project instructions template above uses {{GITHUB_PAT}} and {{SUPABASE_MANAGEMENT_PAT}} as placeholders. The Founder substitutes real token values ONLY when pasting this into Claude.ai's project-instructions UI (a private per-project field, not a public document). These tokens must never appear in any committed file, screenshot, or shared document. If leaked, rotate immediately per the "regenerate GitHub PAT" troubleshooting section at the bottom of this document.
```

**One reminder:** the tokens above are live credentials. Don't share the project instructions with anyone you don't trust.

---

## Step 3 — Pin these documents as Project Knowledge

Upload the following files from the repo (they're in `docs/orchestration/` on main):

1. `ceo-mandate.md`
2. `ceo-playbook.md`
3. `claude-code-runbook.md`
4. `session-rituals.md`
5. `ceo-state.md`

You upload each once. Claude in the project will see them on every new conversation.

**Where to get them:** go to https://github.com/nawrasalali/penworth-new/tree/main/docs/orchestration — click each file → "Raw" → save locally → upload to the project's knowledge. Or let me email them to you via Resend, your call.

---

## Step 4 — Start your first conversation in the new project

Your opening message can simply be:

> "Daily brief please."

I'll run the start-of-session ritual automatically, pull live state from Supabase, and give you a clean morning brief. From that point on, everything works without explanation.

---

## How to use the project day-to-day

### When you want to check in

Open the project, start a new conversation, say "status" or "daily brief". Get the answer in under a minute.

### When you want something done

Tell me. I'll either do it inline, dispatch to Claude Code, or flag it as needing your decision. You never have to decide which path — I'll pick.

### When you want to approve a decision

If I've recommended X, say "go". No further discussion needed unless you want it.

### When you want to veto

Say "no" or "change Y to Z". I'll revise and ask again.

### When you want me to stop for the day

Say "wrap it up". I'll commit everything, update state, produce a handover note, and give you a close-of-session brief.

---

## What you don't need to do, ever

- Copy-paste between chats. Obsolete.
- Read any conversation history. The state file is authoritative.
- Learn Claude Code. I operate it.
- Remember which chat had which context. The repo + the DB are the memory.
- Track who owes what. The orchestration table tells me.
- Keep tokens in sync between chats. The project instructions carry them.

---

## When to start a fresh conversation vs. continue

Start a fresh conversation when:

- We've been talking for more than ~2 hours and responses are slowing
- I explicitly say "approaching context limit, recommend new session"
- You're starting a new day / a new topic

Continue when:

- We're in the middle of a specific task
- You want to iterate on something I just said

Don't worry about this — if I sense context drift, I'll tell you.

---

## Troubleshooting

### "I opened the project but I don't see the pinned docs"

Upload them via Step 3. The project will only use knowledge you've explicitly added.

### "Claude doesn't seem to know the current state"

Ask: "Run the start-of-session ritual." I'll re-read the state file, query Supabase, catch up.

### "The Command Center isn't showing a number I expect"

Ask me: "Why is X showing Y on the dashboard?" I'll trace it back to the source query.

### "I want to deprecate the CEO Claude instance and start over"

Create a new project called "Penworth CEO v2". Repeat Steps 1-3. All state is in the repo + DB, not in any chat, so nothing is lost.

---

## One-time: regenerate GitHub PAT if ever compromised

If the GitHub PAT in the project instructions ever leaks:

1. https://github.com/settings/tokens → revoke it
2. Create a new PAT with `repo` + `workflow` scopes
3. Update the project instructions with the new token
4. Tell me in the next conversation — I'll use it from then on

Same pattern for the Supabase Management PAT (https://supabase.com/dashboard/account/tokens).
