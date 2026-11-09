# Development 02-B — Work progress

- Branch: `feature/rep-v2-frontend-work`
- Target: frontend only for the Iraqi Universities Platform.
- W0: audited live entry points, API conventions, academic catalog, uploads, admin, announcements, theme and navigation. See `FRONTEND_UX_SPEC.md`.
- W1: dashboard, session and scoped overview, read-only announcements, and platform navigation implemented and pushed. Six fixture-driven tests passed. Verified navigation checkpoint: `1bdd24dd5a18e99f0f0a6c8ad6eca9ea931ef719`.
- W2–W6: in progress or pending.
- Draft PR: https://github.com/universitiesofiraq-web/iraq-platform/pull/1
- Backend dependency: the Claude backend branch and canonical contract were not visible during W0. Existing endpoints may be used within their verified behavior.
- Verification: fetched the nine public HTML entry points, inspected existing CSS and authentication/navigation scripts, and checked repository README and branch picker. No write requests sent to production APIs.
- Verified W0 specification commit: `2817e77639afedf670b63cf59f39b76f417c51ba`.
- Checkpoint verification: use the GitHub branch history for the SHA of this commit. A commit cannot contain its own SHA. Record verified prior checkpoint SHAs at the next update.
- Next action: complete representative directory and application interfaces. Verify the canonical backend contract before enabling advanced actions.
