# Reader corpus: Readability → Defuddle

Captured 6 November 2026. Offline HTML, SHA-256 checked; network is opt-in. Counts are whitespace-delimited sanitized body words, not library-specific word-count algorithms.

| Source | Words before → after | Headings | Lists | Code blocks | Tables | Author |
|---|---:|---:|---:|---:|---:|---|
| github-pr | 108 → 339 | 1 → 4 | 1 → 2 | 0 → 0 | 1 → 0 | defleur-agents |
| github-issue | 255 → 255 | 3 → 3 | 1 → 1 | 1 → 1 | 0 → 0 | TIMMLOPK |
| github-readme | 1638 → 1638 | 24 → 24 | 6 → 6 | 18 → 18 | 5 → 5 | (not supplied by source) |
| rao | 2803 → 2804 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | Venkatesh Rao |
| wikipedia | 5890 → 4765 | 0 → 11 | 9 → 3 | 0 → 0 | 0 → 0 | Wikipedia |
| hackernews | 4095 → 4557 | 0 → 1 | 0 → 0 | 0 → 0 | 51 → 0 | dhouston |
| news | 745 → 788 | 0 → 1 | 0 → 0 | 0 → 0 | 0 → 0 | Lee Mohon |
| docs | 1797 → 1916 | 12 → 12 | 1 → 1 | 24 → 24 | 0 → 0 | (not supplied by source) |

GitHub PR now contains the description, not Codex review/comment tables; GitHub replies are excluded by the library option. HN retains library-extracted discussion replies. Authors are asserted where supplied; README/docs do not name an author, and no person is invented.

Reddit: public HTML blocked with HTTP 403 from this host. X: captured HTTP 200, but the unauthenticated HTML is not the tweet DOM expected by Defuddle; not claimed as a passing extraction. These are explicit skipped coverage, not synthetic fixtures.

All responses still cross the unchanged DOMPurify allowlist. Footnote markers/text and plain-text math survive; fragment IDs, MathML/SVG and remote math renderers remain intentionally excluded by the original security policy.
