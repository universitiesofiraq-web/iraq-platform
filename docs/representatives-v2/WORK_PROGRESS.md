# Development 02-B — Frontend progress and handoff

## Repository

- Frontend branch: `feature/rep-v2-frontend-work`
- Draft PR: https://github.com/universitiesofiraq-web/iraq-platform/pull/1
- Cloudflare branch preview: https://feature-rep-v2-frontend-work.iraq-platform.pages.dev/representatives.html
- Backend contract: `feature/rep-v2-backend-claude:iraq-platform/docs/representatives-v2/API_CONTRACT.md`. The available C0 contract confirms legacy workflows and describes the advanced roles as planned.
- Verified implementation checkpoint: `4e8044f0ba59c606507a91bdd9b2110510315eaa`. GitHub history records the SHA for this documentation commit.

## Milestones

| Stage | Outcome | Verified checkpoint |
| --- | --- | --- |
| W0 | Audited the current platform, source, session conventions and RTL patterns. Published the UX specification and initial progress notes. | `2817e77639afedf670b63cf59f39b76f417c51ba` |
| W1 | Added the representative overview, confirmed scope and lecture indicators, role-dependent controls, public announcements, and a role-neutral link in the academic platform. | `1bdd24dd5a18e99f0f0a6c8ad6eca9ea931ef719` |
| W2 | Added a searchable directory of representatives returned by the current API. The UI omits emails. Advanced assignment, capability editing and revocation await C2. Existing team management remains available where authorized. | `2b1a151ea756e7e505b4d403882f046584037cb1` |
| W3 | Integrated existing application submission, personal status and admin pending-request review with server-confirmed feedback. Existing lecture tools and global announcements are reused. Group membership, cancellation and scoped announcements await backend support. | `6a028a247ecff21c9ae88ff711c7808445ad2ddb` |
| W4 | Added responsive navigation, mobile targets, RTL, a keyboard skip link, visible focus and reduced-motion styling. Verified the preview's unauthenticated/error view on six viewport sizes. Signed-in visual QA and English translation are pending. | `4e8044f0ba59c606507a91bdd9b2110510315eaa` |
| W5 | Eleven fixture-driven functional checks passed. Nine read-only HTTP smoke checks against the current platform passed. Authenticated preview integration and C2 roles remain pending. | `afa4a13098273273e60a9458fc377821cada8fb5` |
| W6 | Reviewed the frontend-only scope, source checks, preview and draft handoff. The PR remains a draft for integration review. | See this file's GitHub commit. |

## What changed

- `iraq-platform/site/representatives.html`, `css/representatives.css`, `js/representatives.js`: Arabic RTL interface, centralized same-origin service calls, session and scope states, scoped public lecture indicators, representative directory, applications and review.
- `iraq-platform/site/platform.html`: one link in the existing hero navigation.
- `tests/representatives-v2.test.cjs`: isolated fixtures for roles, scopes, directory privacy, representative requests, unauthorized and expired-session behavior.
- `docs/representatives-v2/FRONTEND_UX_SPEC.md` and this checkpoint.

Existing sign-in, upload limits, PDF reader, study flows, academic catalog and legacy administration continue to use their original routes and implementations. This branch contains frontend, tests and documentation only.

## Verification and API coverage

- `node --check iraq-platform/site/js/representatives.js` and `node --test tests/representatives-v2.test.cjs` passed. Eleven tests use fixtures. No real application or representative decision was submitted during testing.
- Chrome branch preview tested at 320×640, 390×844, 430×932, 768×1024, 1440×900 and 844×390. The guest/error shell stayed RTL without horizontal overflow. Header navigation measured at least 44 CSS pixels. The keyboard skip link focused `main`. The session retry remained available. No JavaScript console errors were observed in the inspected log.
- Live read-only smoke verified `GET /api/catalog/universities`, `colleges`, `departments`, `department`, `subjects`, `GET /api/uploads` and `GET /api/announcements` return 200. `GET /api/auth/me` and `GET /api/auth/rep-requests` return 401 without a session.
- The frontend uses the C0 `GET /api/auth/scopes`, `POST /api/auth/rep-request` and `POST /api/auth/rep-request/decide` contracts. Tests for authenticated results and writes use fixtures. The branch preview returned `503 not_configured` from `/api/auth/me`, so signed-in Chrome flows remain unverified there.
- No database migration, backend authorization implementation, credential, or production configuration was added.

## Exact resume steps

1. Check out `feature/rep-v2-frontend-work` and open draft PR #1. Run the Node checks listed above.
2. Read Claude's latest canonical contract at the repository path listed above. Confirm implemented capabilities and payloads for university admins, assistants, assignment, revocation, memberships and scoped announcements before enabling the related controls.
3. Bind a non-production test database/session service to the preview. Use test accounts for student, representative, assistant and university admin. Verify keyboard and responsive behavior on the signed-in screens, including RTL, and cover the English version before release.
4. Update the same draft PR with verified integration results. Obtain explicit approval before any merge or production deployment.
