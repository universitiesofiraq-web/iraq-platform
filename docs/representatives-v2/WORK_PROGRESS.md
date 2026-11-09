# Development 02-B — Work progress

- Branch: `feature/rep-v2-frontend-work`
- Target: frontend only for the Iraqi Universities Platform.
- W0: audited live entry points, API conventions, academic catalog, uploads, admin, announcements, theme and navigation. See `FRONTEND_UX_SPEC.md`.
- W1–W6: pending at W0 checkpoint.
- Backend dependency: the Claude backend branch and canonical contract were not visible during W0. Existing endpoints may be used within their verified behavior.
- Verification: fetched the nine public HTML entry points, inspected existing CSS and authentication/navigation scripts, and checked repository README and branch picker. No write requests sent to production APIs.
- Verified W0 specification commit: `2817e77639afedf670b63cf59f39b76f417c51ba`.
- Checkpoint verification: use the GitHub branch history for the SHA of this commit. A commit cannot contain its own SHA. Record verified prior checkpoint SHAs at the next update.
- Next action: implement the role-aware overview, shared API adapter and navigation entry, then test and push W1.
