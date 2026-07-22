# STR Development Rules

**Status:** Mandatory for every future STR engineering session. Read this before doing any work.
**Scope:** Syria-first STR launch only.

---

# 1. Mission

Prepare STR for the Syria-first public launch.

# 2. Single source of truth

The official roadmap is:

`docs/product/STR_LAUNCH_ROADMAP_v1.1.md`

No engineering task may bypass it. The roadmap is frozen; priorities and business rules do not change
without the owner's explicit approval.

# 3. Working rules

- Work on one roadmap item only.
- Never expand scope.
- Never mix STR with:
  - SIR
  - SYBNB Ride
  - Quebec Edition
  - BNHub
  - LECIPM
- No speculative development.
- No feature creep.

# 4. Engineering workflow

For every roadmap item:

1. Read-only audit.
2. Root cause.
3. Explain why it blocks launch.
4. Failing tests first.
5. Smallest safe implementation.
6. TypeScript.
7. Unit tests.
8. API tests.
9. Security tests.
10. Production build.
11. Stop.
12. Wait for approval.
13. Local checkpoint commit.

Never push.
Never merge.
Never deploy.

# 5. Product principles

- Trust before growth.
- Simplicity before features.
- Production quality before speed.
- Honest UI.
- No fake data.
- No fake trust.
- No hidden fees.
- No misleading UX.

# 6. Documentation rule

Every completed roadmap item must update:

- architecture docs
- product docs
- security docs
- launch checklist

before the checkpoint commit.

# 7. Completion rule

STR is considered launch-ready only when every P0 and P1 roadmap item is completed and approved.
