# skills

A collection of AI skills for [Claude Code](https://code.claude.com/docs/en/skills).

## Installation

### Prerequisites

- [Claude Code](https://claude.com/claude-code) installed
- [Node.js](https://nodejs.org/) 18+ (for skills that use scripts)
- For `reddit-skill`: Playwright Chromium — `npx playwright install chromium`

### Install a skill

Copy the skill folder into your Claude Code skills directory:

```bash
# User-level — available in ALL your projects
cp -r reddit-skill ~/.claude/skills/

# OR project-level — available only in the current repo
mkdir -p .claude/skills && cp -r reddit-skill .claude/skills/
```

### Verify it's installed

Restart Claude Code (or run `/skills`) and you should see the skill listed. Then just ask
Claude to do the relevant task (e.g. "research X on Reddit") and the skill triggers
automatically — or invoke it explicitly by name.

> **Note:** skills placed in `~/.claude/skills/` apply to every project; skills in a
> project's `.claude/skills/` apply only to that repo. Project skills win on name clashes.

---

## Skills in this repo

### 🔎 reddit-skill

Fetch **public** Reddit data (posts, comments, search results, subreddit listings) for
research and summarization — reliably, even from environments where normal HTTP requests
to reddit.com are blocked.

**Why it exists:** plain `curl` / server-side fetches from datacenter IPs get served an
HTML block wall instead of Reddit's JSON. This skill drives a **real browser engine**
(Playwright + Chromium) to load reddit.com in a genuine session and read the public
`.json` endpoints, so research tools get accurate data instead of a login wall.

**What it does:**

- Global and per-subreddit **search** (`--search`, `--sub`, `--sort`, `--t`, `--limit`)
- Subreddit **listings** (`top` / `hot` / `new` / `rising`)
- Full **post + comment trees** from any Reddit URL (`.json` auto-appended)
- **Batch mode** (`--batch`) — fetch many post bodies in one browser session
- Auto-resolves Playwright's bundled Chromium on macOS / Linux / Windows, and falls back
  to an installed Chrome/Edge if the bundled engine is absent

**Use the fetcher directly:**

```bash
SK=~/.claude/skills/reddit-skill/scripts/reddit_fetch.mjs

# Search within a subreddit (relevance/top/new/hot; t = hour|day|week|month|year|all)
node "$SK" --search "some topic" --sub AskReddit --sort top --t week --limit 25

# Newest posts in a subreddit
node "$SK" --sub brisbane --listing new --limit 5

# A single post + its comment tree (".json" auto-appended)
node "$SK" "https://www.reddit.com/r/AskReddit/comments/POST_ID/"

# Batch: many posts in one browser session (faster for multi-post reads)
node "$SK" --batch "https://reddit.com/r/x/comments/ID1/" "https://reddit.com/r/x/comments/ID2/"
```

Output is raw Reddit JSON on stdout — pipe through `jq`. See
[`reddit-skill/SKILL.md`](reddit-skill/SKILL.md) for full usage.

---

## ⚠️ Responsible use (reddit-skill)

This skill is for **read-only access to publicly visible Reddit content**, at **human
scale**, for personal research and summarization. Please use it accordingly:

- **Respect Reddit's [User Agreement](https://redditinc.com/policies/user-agreement) and
  [API terms](https://redditinc.com/policies/data-api-terms).** For bulk, commercial, or
  high-volume access, use Reddit's official [Data API](https://www.reddit.com/dev/api).
  Don't use this to evade paid API tiers for commercial workloads.
- **It does not bypass authentication or access private data.** It only reads content any
  logged-out visitor can already see. It stores no credentials and posts nothing.
- **Rate-limit yourself.** Reddit will temporarily block an IP that fetches too fast
  (`rate_limited` error). Space out large runs and prefer one `--batch` call over many
  single calls.
- **Read-only by design** — the skill never posts, comments, votes, or logs in.

You are responsible for how you use it. If in doubt about volume or purpose, use the
official API.

## License

Provided as-is, no warranty. Add a `LICENSE` file (e.g. MIT) if you want to set explicit terms.
