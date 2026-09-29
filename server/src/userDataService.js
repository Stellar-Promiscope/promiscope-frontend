const db = require('./db');

/**
 * Wallet-scoped export and deletion for every backend table holding
 * wallet-linked or personal data (issue #1352). Called by the Next app's
 * GET /api/data-export and POST /api/data-deletion/request routes through
 * routes/users.js.
 *
 * Deletion policy — deleted outright unless another record depends on it:
 * - referral_codes owned by the wallet: unredeemed codes are deleted;
 *   redeemed codes keep their row (so the redeemer's history stays
 *   consistent) with `scout_wallet` anonymized.
 * - referral_codes redeemed by the wallet: `used_by` is anonymized so the
 *   referring scout's redemption count is unchanged.
 * - academy_members: the wallet's membership row is deleted; rows it added
 *   for other wallets keep `added_by`, anonymized.
 * - academies owned by the wallet: kept (other members still belong to it),
 *   `owner_wallet` anonymized.
 * - milestone_submissions submitted by the wallet: pending ones are deleted;
 *   decided ones back an on-chain approval, so `submitted_by` is anonymized.
 *   Rows where the wallet is the reviewing validator are anonymized.
 * - sponsorship_waitlist is keyed by email, not wallet — see
 *   deleteWaitlistEmail.
 */
const ANONYMIZED = 'deleted-user';

const q = {
  referralsOwned: db.prepare(
    'SELECT * FROM referral_codes WHERE scout_wallet = ?',
  ),
  referralsRedeemed: db.prepare(
    'SELECT * FROM referral_codes WHERE used_by = ?',
  ),
  academiesOwned: db.prepare('SELECT * FROM academies WHERE owner_wallet = ?'),
  membership: db.prepare('SELECT * FROM academy_members WHERE wallet = ?'),
  membersAdded: db.prepare(
    'SELECT * FROM academy_members WHERE added_by = ? AND wallet != ?',
  ),
  submissionsSubmitted: db.prepare(
    'SELECT * FROM milestone_submissions WHERE submitted_by = ?',
  ),
  submissionsReviewed: db.prepare(
    'SELECT * FROM milestone_submissions WHERE validator_wallet = ?',
  ),

  deleteUnusedReferrals: db.prepare(
    'DELETE FROM referral_codes WHERE scout_wallet = ? AND used_by IS NULL',
  ),
  anonReferralOwner: db.prepare(
    'UPDATE referral_codes SET scout_wallet = ? WHERE scout_wallet = ?',
  ),
  anonReferralRedeemer: db.prepare(
    'UPDATE referral_codes SET used_by = ? WHERE used_by = ?',
  ),
  deleteMembership: db.prepare('DELETE FROM academy_members WHERE wallet = ?'),
  anonMemberAddedBy: db.prepare(
    'UPDATE academy_members SET added_by = ? WHERE added_by = ?',
  ),
  anonAcademyOwner: db.prepare(
    'UPDATE academies SET owner_wallet = ? WHERE owner_wallet = ?',
  ),
  deletePendingSubmissions: db.prepare(
    "DELETE FROM milestone_submissions WHERE submitted_by = ? AND status = 'pending'",
  ),
  anonSubmitter: db.prepare(
    'UPDATE milestone_submissions SET submitted_by = ? WHERE submitted_by = ?',
  ),
  anonValidator: db.prepare(
    'UPDATE milestone_submissions SET validator_wallet = ? WHERE validator_wallet = ?',
  ),
  waitlistByEmail: db.prepare(
    'SELECT id, email, interest_type, created_at FROM sponsorship_waitlist WHERE email = ?',
  ),
  deleteWaitlistEmail: db.prepare(
    'DELETE FROM sponsorship_waitlist WHERE email = ?',
  ),
};

function exportWalletData(wallet) {
  return {
    referralCodes: q.referralsOwned.all(wallet),
    referralRedemptions: q.referralsRedeemed.all(wallet),
    academiesOwned: q.academiesOwned.all(wallet),
    academyMembership: q.membership.get(wallet) ?? null,
    academyMembersAdded: q.membersAdded.all(wallet, wallet),
    milestoneSubmissions: q.submissionsSubmitted.all(wallet),
    milestoneSubmissionsReviewed: q.submissionsReviewed.all(wallet),
  };
}

const deleteWalletData = db.transaction((wallet) => {
  const removed = {
    referralCodes: q.deleteUnusedReferrals.run(wallet).changes,
    academyMembership: q.deleteMembership.run(wallet).changes,
    milestoneSubmissions: q.deletePendingSubmissions.run(wallet).changes,
  };
  const anonymized = {
    referralCodes: q.anonReferralOwner.run(ANONYMIZED, wallet).changes,
    referralRedemptions: q.anonReferralRedeemer.run(ANONYMIZED, wallet).changes,
    academyMembersAdded: q.anonMemberAddedBy.run(ANONYMIZED, wallet).changes,
    academiesOwned: q.anonAcademyOwner.run(ANONYMIZED, wallet).changes,
    milestoneSubmissions: q.anonSubmitter.run(ANONYMIZED, wallet).changes,
    milestoneSubmissionsReviewed: q.anonValidator.run(ANONYMIZED, wallet)
      .changes,
  };
  return { removed, anonymized };
});

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

/**
 * Sponsorship waitlist rows are keyed by email and never linked to a
 * wallet, so they cannot be reached from the wallet-scoped paths above.
 * The caller must have verified ownership of `email` first.
 */
function exportWaitlistEmail(email) {
  return q.waitlistByEmail.get(normalizeEmail(email)) ?? null;
}

function deleteWaitlistEmail(email) {
  return q.deleteWaitlistEmail.run(normalizeEmail(email)).changes;
}

module.exports = {
  ANONYMIZED,
  exportWalletData,
  deleteWalletData,
  exportWaitlistEmail,
  deleteWaitlistEmail,
};
