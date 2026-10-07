/**
 * Every localStorage / sessionStorage key the app uses, in one place, so
 * wallet-scoping audits, the disconnect cleanup and the privacy docs have a
 * single list to check.
 *
 * Scope legend:
 *   device      — localStorage, shared by every wallet on this browser
 *   per-wallet  — localStorage, tied to the connected wallet/session
 *   session     — sessionStorage, cleared when the tab closes
 *
 * Existing values are intentionally left as-is (renaming would reset user
 * preferences). New keys should use the `promiscope:` prefix.
 */

// device
export const THEME_STORAGE_KEY = 'promiscope_theme_preference';
// device
export const CURRENCY_PREFERENCE_KEY = 'promiscope_currency_preference';
// device
export const COOKIE_CONSENT_KEY = 'promiscope:cookie-consent';
// device
export const READ_RECEIPTS_ENABLED_KEY = 'read_receipts_enabled';
// device
export const REMEMBERED_ADDRESSES_KEY = 'promiscope:remembered_addresses';

// per-wallet
export const WALLET_SESSION_KEY = 'wallet_session';
// per-wallet
export const SESSION_EXPIRY_KEY = 'promiscope:session_expiry';
// per-wallet
export const SESSION_INVALIDATED_KEY = 'promiscope:session-invalidated';
// per-wallet
export const RECENTLY_VIEWED_KEY = 'promiscope_recently_viewed';
// per-wallet
export const BLOCKED_USERS_KEY = 'promiscope_blocked_users';
// per-wallet
export const UPLOAD_RESUME_KEY = 'promiscope:upload-resume';

// session
export const CONTRACT_PAUSED_DISMISSED_KEY = 'promiscope:contractPausedDismissed';
// session
export const CONFIG_WARNING_DISMISSED_KEY = 'promiscope:configWarningDismissed';
