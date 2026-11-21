# Approved decisions and boundaries

Approved in chat after grill-me rounds 1–4, 2026-11-22. Frontier empty; user explicitly approved coding, planning, per-phase commits and Draft MR; **not** merge, deployment or runner/mirror/visibility changes.

| ID | Approved choice |
| --- | --- |
| Q1 | Entire Discord bot backend migrates to Rust; TypeScript/Three.js Activity UI preserved |
| Q2 | New review branch from GitLab `main`, not from unmerged MRs !5/!6/!8 |
| Q3 | Cutover only after feature equivalence and verification |
| Q4 | Existing SQLite schema, records, and guild files remain compatible |
| Q5 | Linux ARM64 first; AMD64 may follow later |
| Q6 | Safety and performance improvements are within scope |
| Q7 | One Rust backend process (Discord, HTTP, workers, data) |
| Q8 | Operational config and deployment settings can be redesigned |
| Q9 | Planned brief downtime acceptable for a future authorized cutover |
| Q10 | Automated test verification sufficient for this development task; live Discord integration unverified |
| Q11 | Replace old env naming fully with new Rust config; provide mapping, no old-variable alias requirement |
| Q12 | User-visible improvements permitted but documented with tests; maintain capabilities and security |
| Q13 | Preserve legacy TypeScript backend temporarily to allow rollback |

**User authorization:** plan, code/test commits and Draft MR only. The branch is NOT the production bot. Do not merge, deploy, write to `main`, change runner config, create mirrors, make repository public, or ingest production secrets/data.

**Accepted process choice:** Existing library/framework versions are selected by engineering evidence and recorded in phase docs. Rust bot does not log into production Discord while phases incomplete.

**Current base:** `main` commit `8f17c21059a807fcfe34e08040bab0a3272a95ed`. Existing Draft MRs are separate and not a base or merge target.
