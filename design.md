# Kelpie iOS Design Guide

This guide defines the visual and interaction direction for the Kelpie iOS companion app. It is written for an agent building SwiftUI screens for a SOC analyst who may be triaging a real incident from a phone.

The app should feel calm, precise, and operational. It should not feel like a marketing site, a generic admin dashboard, or a playful consumer app.

## Design Principles

1. Prioritise triage speed.
   The first glance should answer: what is critical, what changed, what needs me, and what can wait.

2. Keep incident data legible.
   Case numbers, severities, statuses, task states, observables, and timestamps must be scannable.

3. Make dangerous actions explicit.
   Running response actions, dismissing alerts, closing cases, or changing status must clearly state the consequence.

4. Avoid visual noise.
   Use restrained colour, compact spacing, and clear hierarchy. Decorative graphics do not belong in the operational surfaces.

5. Respect Apple conventions.
   Use native navigation, lists, forms, sheets, confirmation dialogs, menus, search, and pull to refresh.

6. Match Kelpie's product voice.
   Copy should be direct, calm, and specific. Use Australian spelling.

## Product Personality

Kelpie is:

- Focused.
- Trustworthy.
- Quietly technical.
- Built for repeated use.
- Serious about auditability.

Kelpie is not:

- Flashy.
- Cartoonish.
- Overly animated.
- A consumer social app.
- A dark cyberpunk toy.

## Visual Direction

Use a dark-first operational interface, with light mode support through semantic colours. The web product uses a deep navy surface, blue action colour, slate text, and severity accents. The iOS app should echo that direction while still feeling native.

Recommended palette roles:

- App background: near-black navy.
- Primary surface: dark navy/slate.
- Secondary surface: slightly lighter slate.
- Primary action: clear blue.
- Text primary: off-white.
- Text secondary: cool slate.
- Border/divider: muted blue-grey.
- Success: green.
- Warning: amber.
- Danger: red.
- Critical: red.
- High: orange.
- Medium: yellow/amber.
- Low: green.

Use colour as reinforcement, never as the only signal. Pair severity colour with text labels and, where helpful, SF Symbols.

Avoid:

- Purple-blue gradient-heavy UI.
- Beige, sand, brown, or espresso palettes.
- Decorative blobs, orbs, bokeh, or abstract cyber backgrounds.
- Excessive glass effects.
- Large empty hero sections.

## Typography

Use Apple system typography.

- Large navigation titles are acceptable for top-level tabs.
- Use compact, information-dense rows.
- Case detail headings should be strong but not oversized.
- Use monospaced digits for counts, case numbers, IP addresses, hashes, and timestamps where it improves scanning.
- Do not use negative letter spacing.
- Do not scale font sizes manually based on viewport width.

Support Dynamic Type. Long case titles and observable values must wrap or truncate predictably.

Suggested hierarchy:

- Top-level title: `.largeTitle` or `.title`.
- Section heading: `.headline` or `.subheadline.weight(.semibold)`.
- Row title: `.body.weight(.medium)`.
- Metadata: `.caption` or `.footnote`.
- Case number and hashes: `.system(.caption, design: .monospaced)`.

## Layout

Design for one-handed phone use first.

Top-level tabs:

- Cases
- Alerts
- Tasks
- Settings

Preferred top-level structure:

- `TabView` for the main sections.
- `NavigationStack` per tab.
- Searchable case and alert lists.
- Pull to refresh on lists.

Use native list patterns where appropriate, but customise rows enough to expose security-specific metadata.

Avoid:

- Cards inside cards.
- Overly tall cards in list-heavy screens.
- Split hero layouts.
- Dense tables that require horizontal scrolling.
- Tiny controls in rows.

## Core Screens

### Cases

The case list is the primary screen.

Each row should show:

- Case number.
- Title.
- Severity.
- Status.
- Assignee or "Unassigned".
- Last updated/opened time.
- SLA pressure when relevant.

Recommended row layout:

- First line: case number and severity/status badges.
- Second line: title, 1-2 lines max.
- Third line: assignee, classification, relative time.

Prioritise sort order:

1. Critical/high cases with active SLA pressure.
2. Assigned-to-me cases.
3. Recently updated cases.
4. Remaining open cases.

Use filters for:

- Mine.
- Critical/high.
- SLA risk.
- Status.

### Case Detail

The case detail should be readable during an incident.

Top summary should show:

- Case number.
- Title.
- Severity badge.
- Status badge.
- TLP/PAP badges.
- Assignee.
- SLA summary.

Use sections:

- Summary.
- Tasks.
- Observables.
- Timeline.
- Comments.

For the first mobile build, prefer a compact segmented control or native sections rather than trying to show everything at once.

Primary actions:

- Add comment.
- Mark task done.
- Change status, if permitted.

Dangerous actions:

- Close case.
- Run response action.
- Dismiss alert.

These must use confirmation dialogs with concrete target text.

### Alerts

The alert list should focus on triage.

Each row should show:

- Alert title.
- Severity.
- Source.
- Created time.
- Observable count or key observable.
- Status.

Critical and high alerts should be visually prominent without flooding the screen with red.

Alert actions should be obvious and scope-aware:

- Promote to case.
- Dismiss.
- Open related case if already promoted.

Do not bury critical alert actions in a hidden menu if the action is central to the workflow.

### Tasks

Tasks should help an on-call analyst do one thing quickly.

Each row should show:

- Task title.
- Case number.
- Due state.
- Status.

Use a checkbox-style interaction for marking done, but require confirmation only if the task is compliance-sensitive or if the backend introduces such a flag.

### Comments

Comments are for fast operational notes.

Design requirements:

- Composer should be easy to reach from case detail.
- Support plain text entry first.
- Mention syntax can remain text-based.
- Show author, timestamp, and body clearly.
- Do not make the composer feel like a chat app if comments are audit records.

### Observables

Observable rows should be technical and copy-friendly.

Each row should show:

- Type.
- Value.
- IOC flag.
- TLP.
- TI match status if available.

Use monospaced text for hashes, IPs, hostnames, and registry keys. Provide explicit copy actions with feedback, but avoid automatic clipboard writes.

### Settings

Settings should be minimal in the mobile app.

Include:

- Server URL.
- Signed-in/token state.
- Organisation name if available.
- Notification settings.
- Clear cached data.
- Sign out.
- App version.

Do not include admin configuration screens in the first mobile build.

## Components

### Badges

Use compact badges for severity, status, TLP, and PAP.

Badge rules:

- Keep text labels visible.
- Use consistent shapes and heights.
- Avoid tiny all-caps if Dynamic Type suffers.
- Do not rely on badge colour alone.

Severity badges:

- Critical: red, highest contrast.
- High: orange.
- Medium: amber/yellow.
- Low: green.

Status badges:

- Open: blue/slate.
- In progress: blue.
- Contained: orange or amber.
- Eradicated: purple is acceptable only as an accent.
- Recovered: green.
- Closed: muted slate.

TLP/PAP badges:

- Clear: light slate.
- Green: green.
- Amber: amber.
- Amber strict: amber with explicit "strict" text.
- Red: red.

### Buttons

Use native `Button` styles adapted through custom modifiers.

Primary button:

- Blue fill.
- Used for main safe action, such as "Add comment" or "Promote".

Secondary button:

- Muted filled or bordered.
- Used for navigation-adjacent actions.

Destructive button:

- Red, with native destructive role.
- Always specific: "Dismiss alert", "Close case", "Run block action".

Icon-only buttons:

- Use SF Symbols.
- Provide accessibility labels.
- Keep a 44x44 point tap target.

### Empty States

Empty states should be concise and operational.

Examples:

- "No open cases."
- "No critical alerts."
- "No tasks due."
- "No observables on this case."

Do not add long explanations or decorative illustrations.

### Loading States

Use native progress indicators.

For first load:

- Centered or section-level spinner with short label if needed.

For refresh:

- Use pull-to-refresh.

For mutations:

- Disable the relevant control.
- Keep the rest of the screen usable when safe.

### Error States

Errors should explain cause and next action.

Examples:

- "Kelpie could not be reached. Check the server URL or connection."
- "This token cannot update cases."
- "This case changed elsewhere. Reload before saving."

Always provide retry for network loads.

## Interaction Rules

### Destructive Actions

Use `confirmationDialog` or `alert` with the target named.

Good:

- "Dismiss alert 'Suspicious login from new geo'?"
- "Close case KP-2026-0042?"
- "Block 203.0.113.4 on Cloudflare?"

Bad:

- "Are you sure?"
- "Confirm action?"

### Response Actions

Response actions are high-risk.

Before running an action, show:

- Action name.
- Target observable.
- Provider.
- Expected effect.
- Audit note that the run will be recorded.

The final button should be specific and destructive if appropriate:

- "Block IP"
- "Disable user"
- "Isolate host"

Never run a response action directly from a push notification.

### Notifications

Notification copy must be safe for a locked screen.

Good:

- "Critical alert in Kelpie"
- "SLA risk on KP-2026-0042"
- "You were mentioned on KP-2026-0042"

Avoid:

- Full phishing lure details.
- Customer names.
- Credentials.
- Full observable values.
- Sensitive incident summaries.

## Accessibility

Accessibility requirements:

- Dynamic Type support on every screen.
- VoiceOver labels on all controls and badges.
- Do not communicate severity by colour alone.
- Hit targets should be at least 44x44 points.
- Use `.accessibilityLabel`, `.accessibilityValue`, and `.accessibilityHint` where they improve clarity.
- Respect Reduce Motion.
- Use system materials and semantic colours where possible.
- Test dark mode and light mode.

Badge accessibility examples:

- Visual: `HIGH`
- VoiceOver: "Severity, high"

- Visual: `TLP:AMBER`
- VoiceOver: "Traffic light protocol, amber"

## Motion

Use motion sparingly.

Appropriate:

- Native navigation transitions.
- Subtle row insertion/removal.
- Small loading progress.
- Pull-to-refresh.

Avoid:

- Animated backgrounds.
- Pulsing critical alerts.
- Excessive badge animation.
- Motion required to understand state.

Respect Reduce Motion.

## Copywriting

Use short, direct copy.

Use Australian spelling.

Prefer:

- "Unauthorised access"
- "Acknowledged"
- "Configured"
- "Organisation"

Avoid:

- Casual jokes.
- Alarmist language.
- Marketing slogans inside the app.
- Long instructional text.

Tone examples:

- "No active SLA breaches."
- "This token does not allow case updates."
- "Reload before saving. This case changed elsewhere."
- "Comment added."

## Data Density

The app should be information-dense but not cramped.

On iPhone:

- Lists should show enough metadata to triage without opening every row.
- Detail screens should use sections and progressive disclosure.
- Avoid multi-column layouts.

On iPad:

- Use split view when implemented.
- Keep the case list visible beside detail.
- Do not simply stretch phone cards across the screen.

## Theming Implementation

Create a small design system in SwiftUI rather than scattering colours and spacing.

Suggested files:

```text
Core/Design/KelpieColors.swift
Core/Design/KelpieTypography.swift
Core/Design/KelpieBadges.swift
Core/Design/KelpieButtonStyles.swift
Core/Design/KelpieSpacing.swift
```

Use semantic names:

- `KelpieColor.background`
- `KelpieColor.surface`
- `KelpieColor.surfaceRaised`
- `KelpieColor.textPrimary`
- `KelpieColor.textSecondary`
- `KelpieColor.action`
- `KelpieColor.danger`
- `KelpieColor.severityCritical`

Do not name colours after implementation details unless they are brand colours.

## Screen Acceptance Checklist

Before a screen is considered complete:

- It has loading, empty, error, and loaded states.
- It works in dark mode and light mode.
- It supports Dynamic Type.
- VoiceOver can identify primary content and actions.
- Primary actions are visible without hunting.
- Destructive actions are confirmed.
- Long titles and observable values do not break layout.
- It handles permission/scope failures.
- It matches Kelpie terminology.
- It avoids decorative content that slows triage.

## Design Summary

Build Kelpie for iOS as a calm operational cockpit for incident response. Make critical work visible, make dangerous work deliberate, and keep the interface native enough that an analyst can use it under pressure without learning a new visual language.
