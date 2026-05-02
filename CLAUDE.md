# Miseiri 見整理 — Project Memory

Standalone NZBN spreadsheet cleanser. Browser-first, no DB, single-shot. Full overview lives in `README.md` and `PRD.md`.

## Matcher sync rule (Miseiri ↔ Mihari)

`src/lib/match/` is the **source of truth** for the NZBN name-matching engine. Mihari vendors a copy at `mihari/src/lib/match/` (mirror) and uses it for bulk-upload row matching.

**When you edit any file in `src/lib/match/` here:**

1. Make and commit the change in Miseiri as normal.
2. From the Mihari repo root (`C:\Users\break\Downloads\Mihari`), run:
   ```
   node scripts/sync-matcher.mjs           # preview the diff
   node scripts/sync-matcher.mjs --apply   # write the copy
   ```
3. Review `git diff src/lib/match/` in Mihari.
4. Commit and push the Mihari side too.

**Direction is one-way: Miseiri → Mihari.** Never edit `mihari/src/lib/match/` directly — those edits will be overwritten the next time someone syncs. If Mihari needs a matcher tweak, the change goes here first, then sync back.

The `match/` files have zero external dependencies and are pure TypeScript, so the copy is a verbatim file copy — no transformation needed.
