# Cirque design system

Cirque is a quiet incident-operations workspace. An analyst should see what needs attention, identify its owner and project, inspect evidence, and leave a useful note without reading decorative copy.

## Foundations

- **Color:** ink `#17223A`, muted ink `#536078`, canvas `#F5F7FC`, surface `#FFFFFF`, line `#DDE3EF`, brand reference `#5465FF`, action `#4657DB`, action hover `#3546C1`, focus `#273BA8`. The supplied `#788BFF`, `#9BB1FF`, `#BFD7FF`, and `#E2FDFF` appear only as low-emphasis accents or surfaces. Never put normal white text on the reference blue; use the darker action token.
- **Type:** Inter/system sans, 15/22 px body, 13/18 px secondary, 28/36 px page headings, and 18/26 px card titles. Numeric incident IDs and dates use tabular numerals. Headings describe tasks, not marketing.
- **Space:** 4/8/12/16/24/32 px scale. Workspace content max-width 1120 px and stays left-aligned. Cards use 24 px padding. Tables and timelines use rules and whitespace, not a grid of identical cards.
- **Shape:** 8 px controls, 12 px panels. No ambient shadows except the authentication panel. One-pixel borders carry hierarchy.

## Layout and components

- Desktop workspace: 56 px persistent header, 248 px sticky navigation rail, and an independently scrolling content region. The right side of the header holds the local environment and account menu. Below 900 px, navigation becomes a drawer; detail and forms collapse to one column. The account control stays fixed across routes and content scroll.
- The logo is a fractured triangular aperture with no external assets. Use `static/cirque-mark.svg` with the wordmark in navigation and alone as the favicon; use the single-ink `static/cirque-mark-mono.svg` for print or one-color contexts. Do not add effects or substitute the older starburst.
- Links identify destinations; buttons perform actions. No dead controls. Status appears as text as well as color. Incident rows show severity, owner, project, and last update.
- Authentication screens use the same wordmark and a short operational promise. QR enrollment includes a manual setup key; recovery codes are shown only after factor confirmation.
- Forms show clear labels, required state, inline errors, and a visible completion state. Empty lists explain what was searched; loading uses native navigation progress rather than decorative skeletons.
- Incident state, severity, and project health use separate text-and-shape treatments; each status foreground/background pair meets at least 4.5:1 contrast. The incident list defaults to open items, with client-side Open, Resolved, All, and Mine views.
- Account menu supports Escape, arrow keys, and outside-click dismissal. Interactive elements use a 2 px focus ring with 2 px offset. Reduced-motion users receive no decorative transitions.
- Profile stacks identity, password-set status, and authenticator controls in that order. The setup explanation uses a collapsed native disclosure next to enrollment; no actual key appears in help copy. Disable and replacement use separate proof and confirmation states; after replacement ends the session, a standalone one-time recovery-code card replaces the workspace shell. Password reset uses the compact auth card with distinct request, entry, success, and unavailable states. Signed-in password change remains described, not shown as a dead control.
- Keyboard focus uses a visible 3 px outline with offset. Minimum target height 40 px. Avoid color-only status and respect reduced-motion settings.

## Examples

- Good: “INC-104 · Delayed webhook delivery” with a status, linked project, owner, and timeline.
- Good: “Add note” persists an attributed update visible on refresh.
- Avoid: decorative metrics without a database query, duplicate cards, flags, challenge hints, or real secrets in seed content.

## Responsive review

Inspect login, enrollment, overview, and incident detail at 375, 768, 1280, and 1920 px. Check wrapping, focus, contrast, and horizontal overflow before approval.
