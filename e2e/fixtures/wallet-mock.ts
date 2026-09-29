import type { Page } from '@playwright/test';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

export type WalletBehavior = 'approve' | 'reject' | 'uninstalled';

export interface MockWalletOptions {
  /** Stellar secret seed (S...) for the deterministic test keypair this mock signs with. */
  secret: string;
  /** How the mock responds to connection/signing requests until `setBehavior` changes it. */
  behavior?: WalletBehavior;
}

export interface MockWallet {
  publicKey: string;
  /** The keypair the mock is *currently* signing with (see `switchAccount`). */
  readonly keypair: Keypair;
  /** Change how the mock answers *subsequent* connect/sign requests on this page. */
  setBehavior(behavior: WalletBehavior): Promise<void>;
  /**
   * Switches the account this mock extension reports and signs with —
   * i.e. the "switch account" a user performs in Freighter's own popup,
   * which a dApp can neither observe nor trigger. Returns the new public
   * key.
   *
   * Unlike a page-side only toggle this survives navigation: the mock's
   * `REQUEST_PUBLIC_KEY`/`SUBMIT_TRANSACTION` handlers ask Node for the
   * active account on every request, so a reload after switching reports
   * the new address rather than resetting to the initial secret.
   */
  switchAccount(secret: string): Promise<string>;
}

const SIGN_FN = '__e2eFreighterSign';
const ACCOUNT_FN = '__e2eFreighterAccount';
const BEHAVIOR_FLAG = '__e2eFreighterBehavior';

/**
 * Installs a mock of the Freighter browser-extension surface that
 * `lib/walletAdapters.ts` (via `@stellar/freighter-api`) talks to.
 *
 * This replicates the real extension's actual wire protocol rather than
 * stubbing `lib/walletAdapters.ts` itself, so the app code under test is
 * completely unmodified: a `window.freighter` flag for the isConnected()
 * fast path, plus a `window.postMessage` request/response pair
 * (`FREIGHTER_EXTERNAL_MSG_REQUEST` / `_RESPONSE`, `REQUEST_PUBLIC_KEY`,
 * `REQUEST_CONNECTION_STATUS`, `SUBMIT_TRANSACTION`) reverse-engineered from
 * `@stellar/freighter-api`'s bundled build. The `messagedId` (sic) field name
 * below is not a typo — it matches the real package's response-matching code.
 *
 * Signing itself is not faked: the exposed `__e2eFreighterSign` binding runs
 * in Node and signs with a real `Keypair`, so a genuinely valid signature is
 * produced against the deterministic test account for every request.
 */
export async function installMockFreighter(
  page: Page,
  options: MockWalletOptions,
): Promise<MockWallet> {
  const initialBehavior: WalletBehavior = options.behavior ?? 'approve';

  // Mutable so `switchAccount` below can change both what the extension
  // reports and which key it signs with — the two must never disagree, or
  // the mock would hand the app a signature from an account it never
  // authenticated.
  let activeKeypair = Keypair.fromSecret(options.secret);

  await page.exposeFunction(ACCOUNT_FN, () => activeKeypair.publicKey());

  await page.exposeFunction(
    SIGN_FN,
    (transactionXdr: string, networkPassphrase: string) => {
      const tx = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
      tx.sign(activeKeypair);
      return tx.toXDR();
    },
  );

  await page.addInitScript(
    ({
      accountFn,
      behaviorFlag,
      signFn,
      initialBehavior,
    }: {
      accountFn: string;
      behaviorFlag: string;
      signFn: string;
      initialBehavior: WalletBehavior;
    }) => {
      (window as unknown as Record<string, unknown>)[behaviorFlag] =
        initialBehavior;

      Object.defineProperty(window, 'freighter', {
        configurable: true,
        get() {
          return (
            (window as unknown as Record<string, unknown>)[behaviorFlag] !==
            'uninstalled'
          );
        },
      });

      window.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as
          | {
              source?: string;
              messageId?: number;
              type?: string;
              transactionXdr?: string;
              networkPassphrase?: string;
            }
          | undefined;
        if (
          !data ||
          event.source !== window ||
          data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST'
        ) {
          return;
        }

        const behavior = (window as unknown as Record<string, unknown>)[
          behaviorFlag
        ] as WalletBehavior;

        const respond = (payload: Record<string, unknown>) => {
          window.postMessage(
            {
              source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
              messagedId: data.messageId,
              ...payload,
            },
            window.location.origin,
          );
        };

        switch (data.type) {
          case 'REQUEST_CONNECTION_STATUS':
            respond({ isConnected: behavior !== 'uninstalled' });
            return;
          case 'REQUEST_PUBLIC_KEY':
            if (behavior === 'reject') {
              respond({ publicKey: '', error: 'User declined access' });
              return;
            }
            // Ask Node for the *current* account rather than using a value
            // captured at install time, so a `switchAccount()` survives a
            // page reload (the init script re-runs on every navigation).
            (
              (window as unknown as Record<string, unknown>)[
                accountFn
              ] as () => Promise<string>
            )().then(
              (currentPublicKey: string) =>
                respond({ publicKey: currentPublicKey, error: '' }),
              (err: unknown) =>
                respond({
                  publicKey: '',
                  error: err instanceof Error ? err.message : String(err),
                }),
            );
            return;
          case 'SUBMIT_TRANSACTION':
            if (behavior === 'reject') {
              respond({
                signedTransaction: '',
                error: 'User declined access',
              });
              return;
            }
            (
              (window as unknown as Record<string, unknown>)[signFn] as (
                xdr: string,
                passphrase?: string,
              ) => Promise<string>
            )(data.transactionXdr ?? '', data.networkPassphrase).then(
              (signedTransaction: string) =>
                respond({ signedTransaction, error: '' }),
              (err: unknown) =>
                respond({
                  signedTransaction: '',
                  error: err instanceof Error ? err.message : String(err),
                }),
            );
            return;
          default:
            return;
        }
      });
    },
    {
      accountFn: ACCOUNT_FN,
      behaviorFlag: BEHAVIOR_FLAG,
      signFn: SIGN_FN,
      initialBehavior,
    },
  );

  const mock: MockWallet = {
    publicKey: activeKeypair.publicKey(),
    get keypair() {
      return activeKeypair;
    },
    async setBehavior(behavior) {
      await page.evaluate(
        ({ flag, behavior }) => {
          (window as unknown as Record<string, unknown>)[flag] = behavior;
        },
        { flag: BEHAVIOR_FLAG, behavior },
      );
    },
    async switchAccount(secret) {
      activeKeypair = Keypair.fromSecret(secret);
      mock.publicKey = activeKeypair.publicKey();
      return mock.publicKey;
    },
  };

  return mock;
}
