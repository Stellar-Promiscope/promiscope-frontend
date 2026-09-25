# Onboarding and pay-to-contact accessibility audit

## Scope

Flows reviewed: `PlayerOnboardingWizard`, `VideoUpload`, the pay-to-contact confirmation, and the shared `Modal`/`ConfirmDialog` primitives.

The container used for this change cannot launch NVDA/Firefox or VoiceOver/Safari, so those assistive-technology combinations were not falsely marked as executed. Keyboard paths and DOM semantics were reviewed against the same interaction states and covered with regression tests. A release pass should still repeat the matrix on Windows/NVDA + Firefox and macOS/VoiceOver + Safari.

## Findings and fixes

| Finding | Fix | WCAG |
| --- | --- | --- |
| Changing wizard steps left focus in an old control and did not announce the new step. | Each step heading is focusable and receives focus after navigation. A polite live region announces `Step N of 3`. | 2.4.3 Focus Order, 4.1.3 Status Messages |
| Validation summaries were visible but their announcement and field relationship depended on browser behavior. | Summaries are assertive live regions; field controls retain `aria-describedby` links to their error text; focus moves to the first invalid field. | 3.3.1 Error Identification, 3.3.3 Error Suggestion, 4.1.3 Status Messages |
| Wallet signing looked like a generic pending submission, and rejection returned no reliable focus target. | The wizard announces waiting for the wallet, submission, success, and actionable failure; failure returns focus to the registration button. | 3.2.2 On Input, 3.3.3 Error Suggestion, 4.1.3 Status Messages |
| Upload progress exposed a progressbar but could produce excessive announcements if every percentage changed. | The progressbar keeps numeric ARIA values while a polite live region announces at ten-percent milestones and processing state. | 4.1.2 Name, Role, Value, 4.1.3 Status Messages |
| The contact confirmation did not explicitly associate its fee message with the dialog, and the primary action was labelled only `Confirm`. | `Modal` supports `aria-describedby`; `ConfirmDialog` associates its message; pay actions include the amount and `XLM` in their accessible labels. | 1.3.1 Info and Relationships, 2.4.6 Headings and Labels |
| Modal Escape and Tab behavior needed to remain reliable while a wallet popup is active. | The existing modal focus trap and Escape close behavior were retained; keyboard regressions cover both. Wallet signing status is announced without removing the modal’s focus containment. | 2.1.1 Keyboard, 2.1.2 No Keyboard Trap |
| Motion could make progress and transitions uncomfortable for reduced-motion users. | New progress transitions use motion-safe variants; existing step transitions remain non-essential and can be disabled by the global reduced-motion preference. | 2.3.3 Animation from Interactions |

## Verification checklist

- [x] First invalid wizard field receives focus.
- [x] Step heading focus and step announcement are implemented.
- [x] Wallet signing and failure states have live announcements.
- [x] Upload progress is a `role="progressbar"` with bounded values.
- [x] Pay-to-contact amount and currency are present in the accessible action label.
- [x] Confirmation text is associated with the dialog.
- [x] Escape closes the confirmation and focus returns to its trigger.
- [x] Modal Tab and Shift+Tab containment remains covered by existing tests.
- [x] Keyboard-only Playwright coverage added for onboarding and pay-to-contact.
- [ ] Repeat the manual NVDA/Firefox and VoiceOver/Safari matrix on physical test systems.
