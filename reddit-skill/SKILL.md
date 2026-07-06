---
name: reddit-skill
description: >
  Fetch real, up-to-date Reddit data (posts, comments, search results, subreddit
  listings, sentiment) that survives Reddit's datacenter 403 block. Reddit hard-blocks
  curl, WebFetch, and WebSearch from this environment — they return a "Welcome to Reddit"
  HTML wall, not data. This skill drives the user's installed Playwright Chromium (a real
  browser engine) to fetch Reddit's JSON API through a genuine session. ALWAYS use this
  skill when: (1) the user says "my-reddit-agent", "reddit-skill", "my reddit skill", or
  asks to research Reddit; OR (2) any other attempt to reach reddit.com fails or returns a
  403 / block wall / non-JSON. Do NOT keep retrying curl/WebFetch against Reddit — switch
  to this skill immediately.
context: fork
model: sonnet
---

# Reddit Skill

Fetches accurate Reddit data via **Playwright + real Chromium** — the only method that
works here, because Reddit blocks all plain-HTTP fetches from datacenter IPs.

## When to use this skill (triggers)

Use it, without asking, whenever ANY of these are true:

- The user says **"my-reddit-agent"**, **"reddit-skill"**, **"my reddit skill"**, or
  otherwise asks to research/search Reddit.
- You are researching a topic, need Reddit data, and a normal fetch **returns a 403,
  a block/"Welcome to Reddit" wall, or non-JSON HTML**. Don't loop on curl/WebFetch —
  fall back to this skill on the first failure.
- You need verifiable Reddit posts/comments with scores and permalinks.

## How to run it

The fetcher is `scripts/reddit_fetch.mjs`. It auto-resolves the installed
playwright-core and the newest full Chromium (no hardcoded paths), prints raw Reddit
JSON to stdout, and exits non-zero with a `BLOCKED*`/`ERROR` message on failure.

```bash
SK=~/.claude/skills/reddit-skill/scripts/reddit_fetch.mjs

# Global search (relevance/top/new/hot; t = hour|day|week|month|year|all)
node "$SK" --search "some topic" --sort top --t week --limit 25

# Search within a subreddit
node "$SK" --search "some topic" --sub ClaudeAI --sort relevance --limit 25

# Subreddit listing (top/hot/new/rising)
node "$SK" --sub ClaudeAI --listing top --t week --limit 25

# Any Reddit URL directly — ".json" is auto-appended if missing
node "$SK" "https://www.reddit.com/r/ClaudeAI/comments/POST_ID/"   # post + comment tree

# BATCH — fetch many post bodies/comment trees in ONE browser session (much faster).
# Use this whenever you need to read the bodies of 2+ posts (e.g. sentiment/difficulty
# analysis). Pays the ~2-5s browser startup ONCE instead of per URL.
node "$SK" --batch \
  "https://reddit.com/r/SUB/comments/ID1/" \
  "https://reddit.com/r/SUB/comments/ID2/" \
  "https://reddit.com/r/SUB/comments/ID3/"
```

**Speed note:** a single search/listing is ~2-3s. Reading N post bodies one-by-one costs
~2-5s *each* (fresh browser per call). Use `--batch` for multi-post reads — 8 posts drop
from ~60s to ~10-15s. Accuracy is identical; it just reuses one warmed session.

Batch output is a JSON array: `[{ "url", "ok": true, "data": <reddit json> }, ...]`
(failed URLs get `"ok": false, "error": ...`). Parse per element:

```bash
node "$SK" --batch URL1 URL2 URL3 \
 | jq -r '.[] | select(.ok) | .data[0].data.children[0].data
     | "### " + .title + "\n" + (.selftext|gsub("\n";" "))'
```

Then parse with `jq`. Useful fields: `score`, `num_comments`, `upvote_ratio`,
`created_utc` (epoch → date), `title`, `selftext`, `author`, `subreddit`, `permalink`.

```bash
node "$SK" --search "QUERY" --sub SUB --limit 25 \
 | jq -r '.data.children[].data
     | [ (.score|tostring), (.num_comments|tostring), .subreddit,
         (.created_utc|strftime("%Y-%m-%d")), .title,
         ("https://reddit.com"+.permalink) ] | @tsv'
```

For a post's comment tree, the response is a 2-element array: `[0]` is the post,
`[1].data.children[].data.body` are top-level comments (recurse `.replies`).

## Getting relevant results (learned the hard way)

Reddit's relevance search matches loose keywords, so a raw `sort=top` query drags in
unrelated high-score posts. To get on-topic data:

- Quote exact phrases: `--search '"Claude Certified Architect"'`.
- Prefer the most relevant subreddit via `--sub`.
- Filter titles/bodies with `jq`/`awk` for the terms that actually matter, then rank.
- Dedupe by permalink (the same post is often cross-posted).

## Output format

Report a short synthesis, then a ranked list of posts — each with title, subreddit,
score, comment count, date, and full `https://reddit.com/...` permalink. State the
recency window searched. **Always tell the user the data was fetched live from Reddit's
JSON API via Playwright + real Chromium.** Never fabricate scores, dates, or quotes.

## If it fails

- `RATE_LIMITED` (exit 5) / batch `error: "rate_limited"` → Reddit is temporarily
  IP-blocking ("You've been blocked by network security"), usually from too many fetches
  in quick succession. **Wait 2–5 minutes and retry** — don't hammer it, that extends the
  block. Space out large research runs; prefer one `--batch` call over many single calls.
- `BLOCKED_SETUP` → no Chromium engine: run `npx playwright install chromium`. (The
  fetcher auto-finds Playwright's bundled Chromium on macOS/Linux/Windows; if that's
  absent it falls back to an installed Chrome or Edge. Safari is never usable — Playwright
  drives WebKit, not Safari. Consumer Chrome/Edge/Safari being installed is otherwise
  irrelevant; the dependency is Playwright + a Chromium engine, not any desktop browser.)
- `BLOCKED` (HTML wall despite the browser) → rare; retry once, then report honestly.
- batch `error: "timeout"` → that one URL exceeded the per-URL cap; the rest still return.
- Read-only: never post, comment, vote, or log in on the user's behalf.
