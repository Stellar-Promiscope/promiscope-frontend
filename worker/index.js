/**
 * Custom service worker source for next-pwa's "custom worker" build
 * (https://github.com/shadowwalker/next-pwa#custom-worker). When a file
 * exists at `worker/index.js` (this file), next-pwa compiles it with
 * webpack (target: webworker) into its own chunk and automatically
 * `importScripts`s it into the generated `public/sw.js`, ahead of
 * Workbox's own precaching/routing setup — no next.config.js changes are
 * needed beyond having next-pwa configured, which this project already
 * does (see next.config.js's `withPWA`).
 *
 * This is the always-loaded home for:
 *  - the player-onboarding-wizard background sync (issue #1181): finishing
 *    a *signed* registration transaction's broadcast to Soroban RPC even
 *    after the tab — or the whole installed PWA — has been closed, and
 *  - the pre-existing generic offline-queue sync relay, wired in here via
 *    importScripts since public/sw-offline-queue.js was previously never
 *    reachable by the generated service worker at all (see that file's
 *    header comment, updated alongside this change).
 *
 * Note on why a *signed* transaction is what gets queued, not the raw form
 * data: registration is a Soroban smart-contract call, and signing it
 * happens locally via the player's wallet extension (Freighter, etc.) —
 * that step needs no network and cannot happen without the private key, so
 * it cannot run from a service worker. What *does* fail on a flaky mobile
 * connection is the network round-trip that follows signing: broadcasting
 * the already-signed envelope to the RPC node. That's the part a signed,
 * base64 XDR string is sufficient to retry — no key material required —
 * which is exactly what background sync is good for.
 */

import {
  getSyncableSubmissions,
  updateOnboardingSubmission,
} from '../lib/onboardingSyncStore';
import { submitSignedTransaction, isNetworkError } from '../lib/sorobanRpc';

// Wires in the generic offline-queue-sync relay (see that file for details).
self.importScripts('/sw-offline-queue.js');

var ONBOARDING_SYNC_TAG = 'onboarding-sync';

/** Tells every open tab about an onboarding-sync outcome. */
async function notifyClients(message) {
  var clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(function (client) {
    client.postMessage(message);
  });
}

/**
 * Best-effort native notification. This app has no push-subscription
 * infrastructure and never calls `Notification.requestPermission()`
 * anywhere (hooks/useNotifications.ts only derives in-app notifications
 * from indexer events) — so `Notification.permission` will almost always
 * be 'default' here, and this intentionally no-ops in that case rather
 * than prompting for permission itself. If some future change in this app
 * does start requesting notification permission, completed background
 * syncs pick it up automatically. Either way, the IndexedDB `status:
 * 'complete'` write in processOnboardingSync is the real notification —
 * the wizard checks it on next open and shows the player their registered
 * profile instead of a stale "still pending" state.
 */
async function notifyCompletion(submission) {
  try {
    if (
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    ) {
      return;
    }
    var name =
      submission.vitals && submission.vitals.name
        ? submission.vitals.name
        : 'Your';
    await self.registration.showNotification('Registration complete', {
      body: name + '’s player profile is now live on-chain.',
      tag: 'onboarding-sync-' + submission.wallet,
      icon: '/icons/icon-192x192.png',
    });
  } catch {
    // Notifications are a nice-to-have here — never let a failure here
    // affect the sync result itself.
  }
}

/**
 * Broadcasts every syncable queued onboarding submission on this device.
 *
 * A submission that fails for a network-shaped reason is put back to
 * 'pending' (so the next sync attempt picks it up again) and this function
 * throws once at the end — rejecting the promise handed to
 * `event.waitUntil()` is what tells the browser to reschedule another
 * `sync` event for this tag later, per the Background Sync spec, rather
 * than this code re-implementing its own retry/backoff loop.
 *
 * A submission rejected by the network itself (a genuine contract-level
 * rejection, not a connectivity problem) is marked 'failed' and is not
 * retried — resubmitting the same signed XDR would never succeed.
 */
async function processOnboardingSync() {
  var submissions = await getSyncableSubmissions();
  if (submissions.length === 0) return;

  var hadNetworkFailure = false;

  for (var i = 0; i < submissions.length; i++) {
    var submission = submissions[i];
    await updateOnboardingSubmission(submission.wallet, {
      status: 'syncing',
      retryCount: submission.retryCount + 1,
    });

    try {
      var result = await submitSignedTransaction(submission.signedXdr);
      await updateOnboardingSubmission(submission.wallet, {
        status: 'complete',
        txHash: result.hash,
      });
      await notifyClients({
        type: 'ONBOARDING_SYNC_COMPLETE',
        wallet: submission.wallet,
        txHash: result.hash,
      });
      await notifyCompletion(submission);
    } catch (err) {
      var message = err && err.message ? err.message : String(err);
      if (isNetworkError(err)) {
        hadNetworkFailure = true;
        await updateOnboardingSubmission(submission.wallet, {
          status: 'pending',
          lastError: message,
        });
      } else {
        await updateOnboardingSubmission(submission.wallet, {
          status: 'failed',
          lastError: message,
        });
        await notifyClients({
          type: 'ONBOARDING_SYNC_FAILED',
          wallet: submission.wallet,
          error: message,
        });
      }
    }
  }

  if (hadNetworkFailure) {
    throw new Error(
      'One or more onboarding submissions could not be broadcast — will retry',
    );
  }
}

self.addEventListener('sync', function (event) {
  if (event.tag === ONBOARDING_SYNC_TAG) {
    event.waitUntil(processOnboardingSync());
  }
});

// In-tab fallback for browsers without the Background Sync API (Safari, at
// time of writing): hooks/useOnboardingSync.ts posts this message instead
// of calling `registration.sync.register()` when `'sync' in registration`
// is false, so the SW still does the actual broadcast — the only
// difference is *when* it runs (only while a tab is open and 'online'
// fires) rather than truly in the background.
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'TRY_ONBOARDING_SYNC') {
    event.waitUntil(processOnboardingSync().catch(function () {}));
  }
});

// ── Milestone-approval Web Push (issue #558) ───────────────────────────────
// The backend sends a VAPID-signed push with a JSON payload shaped like
// `{ type: 'milestone_approved', playerId, milestone, validatorName? }` to
// subscriptions registered via components/PushNotificationToggle.tsx.
// Permission is only ever requested from that explicit opt-in button.
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  var milestone = data.milestone || data.milestoneDescription || '';
  var approver = data.validatorName ? ' by ' + data.validatorName : '';
  var title = data.title || 'Milestone approved';
  var body =
    data.body ||
    (milestone
      ? '“' + milestone + '” was approved' + approver + '.'
      : 'One of your milestones was approved' + approver + '.');
  var url = data.url || (data.playerId ? '/player/' + data.playerId : '/');

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: 'milestone-' + (data.milestoneId || data.playerId || 'approved'),
      icon: '/icons/icon-192x192.png',
      data: { url: url },
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;

  event.waitUntil(
    (async function () {
      var clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (var i = 0; i < clients.length; i++) {
        var client = clients[i];
        if (client.url === target && 'focus' in client) return client.focus();
      }
      for (var j = 0; j < clients.length; j++) {
        if ('navigate' in clients[j]) {
          await clients[j].navigate(target);
          return clients[j].focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
