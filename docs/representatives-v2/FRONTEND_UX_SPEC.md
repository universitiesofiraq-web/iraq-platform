# Development 02-B — Representative frontend specification

## Baseline and reuse

The private `universitiesofiraq-web/iraq-platform` repository contains `iraq-platform/site` and Cloudflare Pages Functions. Its README identifies the existing Google sign-in, roles, upload and announcements architecture backed by D1 and KV. The live baseline is `https://iraq-platform.pages.dev/`.

| Existing surface | Frontend decision |
| --- | --- |
| `index.html`, `platform.html` and `js/nav.js` | Keep the current navigation and study flows. Add a representative entry at the authenticated platform entry point and a role-neutral entry for students to follow their applications. |
| `login.html` and `js/auth.js` | Reuse session cookies and the current sign-in route. Distinguish expired sessions, unauthorized roles, network errors and empty data. |
| `catalog.html`, `dept.html` and `/api/catalog/*` | Use the existing academic hierarchy. Where scope is incomplete, show the available level and leave stage or group unspecified. |
| `contribute.html`, `upload.html` and `admin.html` | Link to the existing upload and content tools only under the capabilities their backend already enforces. Preserve PDF limits, permissions, study routes and existing link uploads. |
| `admin.html` and `announce.html` | Reuse current administration where authorized. Keep advanced assignments, scoped announcements and groups separately capability-gated. |
| `css/iq.css` and `css/style.css` | Use the existing Arabic RTL and navy/gold visual language, theme variables, focus indicator and card patterns. Use scoped CSS and plain HTML and JavaScript. |

## Page and state map

- **Representatives overview.** Context, status, capabilities, lecture indicators, scoped notices and permitted quick actions. Place confirmed data above workflow links.
- **Representative directory and assignment.** Scope and role summary, eligible-student selection, capability review, explicit revocation confirmation and server-confirmed outcomes. Display public names and minimal identity fields.
- **Applications and group membership.** Show personal application status for students and scoped review actions for authorized users. Separate representative applications from group membership.
- **Announcements.** Read existing announcements. Enable advanced audience selection, priority, editing and attachments when the contract provides those operations.
- **Lectures and schedule.** Link to existing tools where scope and capability permit. Use empty states for confirmed empty lists and unavailable states for missing capabilities or data.

## Mobile and accessibility

Use semantic sections, an RTL layout with logical CSS properties, clear headings and labels, keyboard-accessible links and controls, visible focus, and touch targets of at least 44 CSS pixels for primary controls. Stack cards on narrow screens, wrap long names and avoid page-level horizontal scrolling. Use native controls and reduced motion. Announce loading, failures and submit outcomes with live regions. After a dialog closes, return focus to its trigger. Keep role-dependent content hidden until a session and the applicable authorization capability are known.

## API dependencies

`GET /api/auth/me`, legacy representative application status and the public academic catalog already exist. A legacy role does not establish new 02-B permissions. The canonical contract at `feature/rep-v2-backend-claude:docs/representatives-v2/API_CONTRACT.md` is required for assistant permissions, scoped dashboard metrics, assignments, membership and scoped announcement writes. The branch did not appear in the branch picker during W0. Use one service adapter and isolated test fixtures while waiting. Never surface fixture data as live data. Document any backend discrepancy for Claude.

Current audit used repository source and public HTML/CSS/JS for the homepage, catalog, department, login, upload, administration, announcements and academic platform. Signed-in UI and viewport behavior still require implementation testing.
