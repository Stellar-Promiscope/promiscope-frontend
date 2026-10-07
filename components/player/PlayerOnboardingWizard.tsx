'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { sanitize } from '@/lib/sanitize';
import { useWallet } from '@/hooks/useWallet';
import { usePlayer } from '@/hooks/usePlayer';
import useIsPaused from '@/hooks/useIsPaused';
import { useOnboardingSync } from '@/hooks/useOnboardingSync';
import { extractContractErrorKey } from '@/lib/contractErrorMessage';
import { buildRegisterPlayer } from '@/lib/contract';
import { submitSignedTransaction, isNetworkError } from '@/lib/sorobanRpc';
import {
  trackUploadedCid,
  matchTrackedUpload,
} from '@/lib/uploadTrackingClient';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import VideoUpload from '@/components/ui/VideoUpload';
import TransactionStatus from '@/components/ui/TransactionStatus';
import { AFRICAN_REGIONS } from '@/lib/regions';
import { FOOTBALL_POSITIONS } from '@/lib/positions';
import type { PlayerVitals } from '@/types';
import type { TxStatus } from '@/components/ui/TransactionStatus';

const STEPS = [
  { id: 1, label: 'Personal Info' },
  { id: 2, label: 'Highlight Reel' },
  { id: 3, label: 'Review & Confirm' },
] as const;

interface WizardData {
  name: string;
  age: string;
  nationality: string;
  region: string;
  position: string;
  bio: string;
  ipfsHash: string;
}

/**
 * Persists wizard progress (issue #1005) across a reload within the same
 * browser tab/session — sessionStorage, not localStorage, since this is
 * scoped to "resume where you left off in this session," not a
 * cross-session draft. Keyed per wallet so switching wallets never leaks
 * one player's in-progress data (including an already-obtained IPFS CID)
 * into another's form.
 */
const WIZARD_STORAGE_PREFIX = 'promiscope_onboarding_wizard_';

function wizardStorageKey(wallet: string): string {
  return `${WIZARD_STORAGE_PREFIX}${wallet}`;
}

interface PersistedWizardState {
  step: number;
  data: WizardData;
}

function loadPersistedWizardState(wallet: string): PersistedWizardState | null {
  try {
    const raw = sessionStorage.getItem(wizardStorageKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWizardState>;
    if (!parsed.data || typeof parsed.step !== 'number') return null;
    return parsed as PersistedWizardState;
  } catch {
    return null; // Corrupt or unavailable storage — start fresh silently.
  }
}

function savePersistedWizardState(
  wallet: string,
  state: PersistedWizardState,
): void {
  try {
    sessionStorage.setItem(wizardStorageKey(wallet), JSON.stringify(state));
  } catch {
    // Storage unavailable (e.g. private browsing) — resume-on-reload just
    // won't work this session; the wizard itself still works normally.
  }
}

function clearPersistedWizardState(wallet: string): void {
  try {
    sessionStorage.removeItem(wizardStorageKey(wallet));
  } catch {
    // Nothing to clean up if storage was never usable.
  }
}

export interface PlayerOnboardingWizardProps {
  onSuccess: (result: {
    playerId: string;
    vitals: PlayerVitals;
    ipfsHash: string;
  }) => void;
}

// ── Progress Stepper ──────────────────────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Registration progress">
      <ol className="flex items-center w-full">
        {STEPS.map((step, index) => {
          const isCompleted = currentStep > step.id;
          const isCurrent = currentStep === step.id;
          return (
            <li
              key={step.id}
              className={`flex items-center ${index < STEPS.length - 1 ? 'flex-1' : ''}`}
            >
              <div className="flex flex-col items-center flex-shrink-0">
                <div
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${step.id} of ${STEPS.length}: ${step.label}`}
                  className={[
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold motion-safe:transition-colors',
                    isCompleted
                      ? 'bg-brand-green text-black'
                      : isCurrent
                        ? 'border-2 border-brand-green text-brand-green'
                        : 'border-2 border-gray-600 text-gray-400',
                  ].join(' ')}
                >
                  {isCompleted ? '✓' : step.id}
                </div>
                <span
                  className={`text-xs mt-1 whitespace-nowrap ${
                    isCurrent ? 'text-white font-medium' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className={`flex-1 h-px mx-3 mb-4 motion-safe:transition-colors ${
                    isCompleted ? 'bg-brand-green' : 'bg-gray-700'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PlayerOnboardingWizard({
  onSuccess,
}: PlayerOnboardingWizardProps) {
  const { publicKey, signOnly } = useWallet();
  const { player, loading: playerLoading } = usePlayer(publicKey);
  const isPaused = useIsPaused();
  const tErrors = useTranslations('contractErrors');
  const tContractStatus = useTranslations('contract_status');

  // Background sync for the final submit step (issue #1181): if signing
  // succeeds but broadcasting the transaction fails for a network reason,
  // the signed submission is queued here instead of being lost — see
  // hooks/useOnboardingSync.ts for how it gets resubmitted automatically.
  const onboardingSync = useOnboardingSync(publicKey);

  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  // Whether a highlight-reel upload is currently in flight (see #1184) —
  // used to keep "Continue"/"Register" disabled for the full duration of an
  // upload, not just until the CID field happens to be re-populated.
  const [isUploadInProgress, setIsUploadInProgress] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const nationalityRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLSelectElement>(null);
  const positionRef = useRef<HTMLSelectElement>(null);
  const step2SummaryRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);
  const [step2FocusTrigger, setStep2FocusTrigger] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  // Focus the step 2 summary after it mounts (element is conditionally rendered)
  useEffect(() => {
    if (step2FocusTrigger > 0) {
      step2SummaryRef.current?.focus();
    }
  }, [step2FocusTrigger]);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    stepHeadingRef.current?.focus();
    setAnnouncement(
      `Step ${step} of ${STEPS.length}: ${STEPS[step - 1]?.label ?? ''}`,
    );
  }, [step]);

  const [data, setData] = useState<WizardData>({
    name: '',
    age: '',
    nationality: '',
    region: '',
    position: '',
    bio: '',
    ipfsHash: '',
  });
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);

  // Restore wizard progress (including an already-uploaded CID) once the
  // wallet is known. Runs once per wallet — a reload at any step, including
  // after step 2's upload completes, picks up where it left off instead of
  // forcing a re-upload.
  useEffect(() => {
    if (!publicKey) return;
    const saved = loadPersistedWizardState(publicKey);
    if (saved) {
      setData(saved.data);
      if (saved.step >= 1 && saved.step <= STEPS.length) {
        setStep(saved.step);
      }
    }
    setHydratedFromStorage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  // Persist on every change, but only after the restore effect above has
  // run — otherwise the initial blank state would overwrite (and lose)
  // whatever was already saved before restore gets a chance to read it.
  useEffect(() => {
    if (!publicKey || !hydratedFromStorage) return;
    savePersistedWizardState(publicKey, { step, data });
  }, [publicKey, hydratedFromStorage, step, data]);

  // A background sync (issue #1181) may have completed while this tab — or
  // the whole app — was closed. On mount/wallet-change, if IndexedDB says
  // this wallet's queued submission finished, treat it exactly like a
  // just-finished in-tab submission: hand it to onSuccess (so the parent
  // shows the registered profile instead of a stale pending state) and
  // clear the record so this doesn't fire again on a later remount.
  const onboardingSyncSubmission = onboardingSync.submission;
  useEffect(() => {
    if (!onboardingSync.loaded || !onboardingSyncSubmission) return;
    if (onboardingSyncSubmission.status === 'complete') {
      onSuccess({
        playerId: onboardingSyncSubmission.wallet,
        vitals: onboardingSyncSubmission.vitals,
        ipfsHash: onboardingSyncSubmission.ipfsHash,
      });
      onboardingSync.discard();
    } else if (!playerLoading && player) {
      // A profile already exists (e.g. this wallet registered through some
      // other path) but a stale queued/failed record is still sitting in
      // IndexedDB — nothing left for it to do.
      onboardingSync.discard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingSync.loaded, onboardingSyncSubmission, playerLoading, player]);

  const updateField = (field: keyof WizardData, value: string) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    updateField(e.target.name as keyof WizardData, e.target.value);
  };

  // ── Per-step validation ───────────────────────────────────────────────────

  // ── Single-field validation ───────────────────────────────────────────────

  const validateField = (
    field: keyof WizardData,
    value: string,
  ): string | undefined => {
    switch (field) {
      case 'name': {
        const trimmed = value.trim();
        if (!trimmed) return 'Name is required';
        if (trimmed.length < 2) return 'Name must be at least 2 characters';
        if (trimmed.length > 50) return 'Name must be 50 characters or fewer';
        return undefined;
      }
      case 'age': {
        if (!value) return 'Age is required';
        const n = parseInt(value);
        if (isNaN(n) || n < 14 || n > 45)
          return 'Age must be between 14 and 45';
        return undefined;
      }
      case 'nationality':
        return value.trim() ? undefined : 'Nationality is required';
      case 'region':
        return value ? undefined : 'Region is required';
      case 'position':
        return value ? undefined : 'Position is required';
      default:
        return undefined;
    }
  };

  const validateStep1 = (): boolean => {
    const fields = [
      'name',
      'age',
      'nationality',
      'region',
      'position',
    ] as const;
    const errs: Record<string, string> = {};
    for (const field of fields) {
      const msg = validateField(field, data[field]);
      if (msg) errs[field] = msg;
    }
    setErrors(errs);

    if (Object.keys(errs).length > 0) {
      setValidationAttempted(true);
      if (errs.name) nameRef.current?.focus();
      else if (errs.age) ageRef.current?.focus();
      else if (errs.nationality) nationalityRef.current?.focus();
      else if (errs.region) regionRef.current?.focus();
      else if (errs.position) positionRef.current?.focus();
    }

    return Object.keys(errs).length === 0;
  };

  // Validate a single field on blur and surface the error immediately.
  const handleBlur = (
    e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    const field = e.target.name as keyof WizardData;
    const msg = validateField(field, e.target.value);
    setErrors((prev) => {
      if (!msg) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return { ...prev, [field]: msg };
    });
  };

  // Derived: is step 1 free of errors and all required fields touched/filled?
  const isStep1Valid =
    !validateField('name', data.name) &&
    !validateField('age', data.age) &&
    !validateField('nationality', data.nationality) &&
    !validateField('region', data.region) &&
    !validateField('position', data.position);

  // Called when VideoUpload's upload completes. Superseding a previous CID
  // (re-uploading at step 2) is handled naturally here — `data.ipfsHash` is
  // overwritten, not appended, so only the latest CID is ever submitted
  // with registration. The superseded CID's backend tracking record (see
  // trackUploadedCid below) is left as-is: it's now genuinely orphaned —
  // this wizard will never reference it again — so leaving it unmatched is
  // exactly what makes it a correct cleanup candidate later, not a bug.
  const handleVideoUpload = (cid: string) => {
    updateField('ipfsHash', cid);
    trackUploadedCid({
      cid,
      wallet: publicKey ?? null,
      context: 'player_onboarding_highlight_reel',
    });
  };

  // Fires the instant a new (re-)upload begins — including replacing an
  // already-uploaded, already-verified CID from an earlier attempt at step
  // 2. Clearing `ipfsHash` immediately (rather than waiting for the new
  // upload to finish) is what closes the race in issue #1184: for as long
  // as a replacement upload is in flight, `data.ipfsHash` is empty, so
  // `validateStep2` — and therefore "Continue" — cannot be satisfied by the
  // stale CID from the previous upload. Only the new upload's own
  // `handleVideoUpload` call can repopulate it.
  const handleVideoUploadStart = () => {
    updateField('ipfsHash', '');
  };

  const validateStep2 = (): boolean => {
    if (isUploadInProgress) {
      setErrors({
        ipfsHash: 'Please wait for the highlight reel upload to finish',
      });
      setValidationAttempted(true);
      setStep2FocusTrigger((t) => t + 1);
      return false;
    }
    if (!data.ipfsHash) {
      setErrors({
        ipfsHash: 'Please upload your highlight reel before continuing',
      });
      setValidationAttempted(true);
      setStep2FocusTrigger((t) => t + 1);
      return false;
    }
    return true;
  };

  // ── Navigation ────────────────────────────────────────────────────────────

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setErrors({});
    setValidationAttempted(false);
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    setErrors({});
    setValidationAttempted(false);
    setStep((s) => s - 1);
  };

  // ── Contract submission ───────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!publicKey) {
      setErrors({ form: 'Wallet not connected' });
      return;
    }
    if (isPaused) {
      setErrors({ form: 'Transactions are currently disabled' });
      return;
    }
    // Belt-and-suspenders guard mirroring validateStep2: step 3 can only be
    // reached through a successful validateStep2 call, but this closes the
    // gap defensively in case that ever changes, rather than trusting that
    // step 3 is unreachable any other way (see issue #1184).
    if (isUploadInProgress || !data.ipfsHash) {
      setErrors({
        form: 'Please finish uploading your highlight reel before submitting',
      });
      setStep(2);
      return;
    }

    setIsLoading(true);
    setErrors({});
    setTxStatus('pending');
    setTxHash(null);
    setAnnouncement('Waiting for signature in your wallet…');

    try {
      const vitals: PlayerVitals = {
        name: data.name,
        age: parseInt(data.age),
        position: data.position,
        region: data.region,
        nationality: data.nationality,
      };

      const xdr = await buildRegisterPlayer(publicKey, vitals, data.ipfsHash);

      // Signing happens locally via the wallet extension and needs no
      // network — only the broadcast below can fail due to connectivity.
      // Splitting the two (rather than one combined sign-and-submit call)
      // is what makes it possible to queue the *signed* transaction for
      // background sync when broadcasting is what actually drops.
      const signedXdr = await signOnly(xdr);
      setAnnouncement('Signature received. Submitting your registration…');

      let hash: string;
      try {
        const result = await submitSignedTransaction(signedXdr);
        hash = result.hash;
      } catch (broadcastError) {
        if (isNetworkError(broadcastError)) {
          // Connectivity dropped between signing and broadcasting — the
          // signed transaction is durable now (IndexedDB), and a
          // background sync (or the in-tab fallback) will finish
          // submitting it automatically. Nothing more to do here.
          await onboardingSync.queueSubmission({
            vitals,
            ipfsHash: data.ipfsHash,
            signedXdr,
          });
          setTxStatus(null);
          clearPersistedWizardState(publicKey);
          return;
        }
        throw broadcastError;
      }

      setTxHash(hash);
      setTxStatus('success');
      setAnnouncement('Registration submitted successfully.');

      matchTrackedUpload({ cid: data.ipfsHash, txHash: hash });
      clearPersistedWizardState(publicKey);

      onSuccess({ playerId: publicKey, vitals, ipfsHash: data.ipfsHash });
    } catch (error) {
      setTxStatus('error');
      const rawMessage = error instanceof Error ? error.message : null;
      const contractKey = rawMessage
        ? extractContractErrorKey(rawMessage)
        : null;
      setErrors({
        form: contractKey
          ? tErrors(contractKey)
          : (rawMessage ?? 'Registration failed'),
      });
      setAnnouncement(
        contractKey
          ? tErrors(contractKey)
          : (rawMessage ?? 'Registration failed. Please try again.'),
      );
      window.requestAnimationFrame(() => {
        document.getElementById('wizard-register-button')?.focus();
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Display labels for review ─────────────────────────────────────────────

  const positionLabel =
    FOOTBALL_POSITIONS.find((p) => p.value === data.position)?.label ??
    data.position;
  const regionLabel =
    AFRICAN_REGIONS.find((r) => r.value === data.region)?.label ?? data.region;
  const shortCid = data.ipfsHash
    ? `${data.ipfsHash.slice(0, 8)}…${data.ipfsHash.slice(-6)}`
    : '';

  if (!playerLoading && player) {
    return (
      <div
        role="alert"
        className="rounded-md border border-yellow-500 bg-yellow-950/30 p-4 text-center"
      >
        <p className="text-sm text-yellow-400 font-medium">
          A profile already exists for this wallet. You cannot register again.
        </p>
      </div>
    );
  }

  // A signed submission is queued for background sync — the multi-step
  // form no longer applies (there's nothing left to edit; it's already
  // signed) so show its status instead. 'complete' isn't handled here: the
  // effect above hands it to onSuccess and clears the record on the same
  // render pass it appears, so this component typically never paints it.
  if (
    onboardingSyncSubmission &&
    (onboardingSyncSubmission.status === 'pending' ||
      onboardingSyncSubmission.status === 'syncing')
  ) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 space-y-3 text-center"
      >
        <p className="text-sm text-yellow-300 font-medium">
          Your registration is signed and queued for submission.
        </p>
        <p className="text-sm text-gray-400">
          It will finish automatically once you&apos;re back online — even if
          you close this tab or the app.
        </p>
        <div className="flex gap-3 justify-center">
          <Button
            type="button"
            variant="secondary"
            onClick={onboardingSync.retryNow}
            disabled={onboardingSyncSubmission.status === 'syncing'}
          >
            Try now
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onboardingSync.discard}
          >
            Discard and start over
          </Button>
        </div>
      </div>
    );
  }

  if (onboardingSyncSubmission?.status === 'failed') {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-500 bg-red-950/30 p-4 space-y-3 text-center"
      >
        <p className="text-sm text-red-400 font-medium">
          Registration could not be completed
          {onboardingSyncSubmission.lastError
            ? `: ${onboardingSyncSubmission.lastError}`
            : '.'}
        </p>
        <div className="flex gap-3 justify-center">
          <Button type="button" onClick={onboardingSync.retryNow}>
            Retry
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onboardingSync.discard}
          >
            Discard and start over
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <StepIndicator currentStep={step} />

      {/* ── Step 1: Personal Info ─────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-white outline-none"
            >
              Personal Information
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Basic details used to create your on-chain profile.
            </p>
          </div>

          {validationAttempted && Object.keys(errors).length > 0 && (
            <div
              role="alert"
              aria-live="assertive"
              aria-label="Form validation summary"
              className="rounded-md border border-red-500 bg-red-950/30 p-3"
            >
              <p className="text-sm text-red-400 font-medium">
                Please correct the {Object.keys(errors).length} error
                {Object.keys(errors).length !== 1 ? 's' : ''} below before
                continuing.
              </p>
            </div>
          )}

          <Input
            ref={nameRef}
            id="wizard-name"
            label="Name *"
            type="text"
            name="name"
            value={data.name}
            onChange={handleChange}
            onBlur={handleBlur}
            error={errors.name}
            placeholder="Enter your full name"
            autoComplete="name"
          />

          <Input
            ref={ageRef}
            id="wizard-age"
            label="Age *"
            type="number"
            name="age"
            value={data.age}
            onChange={handleChange}
            onBlur={handleBlur}
            error={errors.age}
            placeholder="Enter your age (14–45)"
            min="14"
            max="45"
            autoComplete="off"
          />

          <Input
            ref={nationalityRef}
            id="wizard-nationality"
            label="Nationality *"
            type="text"
            name="nationality"
            value={data.nationality}
            onChange={handleChange}
            onBlur={handleBlur}
            error={errors.nationality}
            placeholder="Enter your nationality"
            autoComplete="country-name"
          />

          <Select
            ref={regionRef}
            id="wizard-region"
            label="Region *"
            name="region"
            value={data.region}
            onChange={handleChange}
            onBlur={handleBlur}
            error={errors.region}
            autoComplete="address-level1"
          >
            <option value="">Select region</option>
            {AFRICAN_REGIONS.map(({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          <Select
            ref={positionRef}
            id="wizard-position"
            label="Position *"
            name="position"
            value={data.position}
            onChange={handleChange}
            onBlur={handleBlur}
            error={errors.position}
            autoComplete="off"
          >
            <option value="">Select position</option>
            {FOOTBALL_POSITIONS.map((pos) => (
              <option key={pos.value} value={pos.value}>
                {pos.label}
              </option>
            ))}
          </Select>

          <div className="space-y-1">
            <label
              htmlFor="wizard-bio"
              className="block text-sm font-medium text-gray-300"
            >
              Bio
            </label>
            <textarea
              id="wizard-bio"
              name="bio"
              value={data.bio}
              onChange={handleChange}
              className="input resize-none"
              rows={3}
              placeholder="Tell us about yourself (optional)"
              autoComplete="off"
            />
          </div>

          <Button
            type="button"
            onClick={handleNext}
            className="w-full"
            disabled={validationAttempted && !isStep1Valid}
          >
            Continue
          </Button>
        </div>
      )}

      {/* ── Step 2: Highlight Reel ────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-white outline-none"
            >
              Highlight Reel
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Upload a video showcasing your skills. The upload must complete
              before you can continue.
            </p>
          </div>

          {validationAttempted && errors.ipfsHash && (
            <div
              ref={step2SummaryRef}
              role="alert"
              aria-live="assertive"
              aria-label="Form validation summary"
              tabIndex={-1}
              className="rounded-md border border-red-500 bg-red-950/30 p-3 outline-none"
            >
              <p className="text-sm text-red-400 font-medium">
                Please correct the error below before continuing.
              </p>
            </div>
          )}

          {data.ipfsHash && (
            <div className="rounded-md border border-brand-green/40 bg-brand-green/10 p-3 text-sm text-brand-green">
              ✓ Highlight reel already uploaded ({shortCid}). Uploading a new
              file below will replace it.
            </div>
          )}

          <VideoUpload
            onUpload={handleVideoUpload}
            onUploadStart={handleVideoUploadStart}
            onUploadingChange={setIsUploadInProgress}
            error={errors.ipfsHash}
          />

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={handleBack}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleNext}
              disabled={isUploadInProgress}
              title={
                isUploadInProgress
                  ? 'Please wait for the highlight reel upload to finish'
                  : undefined
              }
              className="flex-1"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Review & Confirm ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-white outline-none"
            >
              Review &amp; Confirm
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Check your details before submitting to the Stellar blockchain.
            </p>
          </div>

          <dl className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800">
            {(
              [
                ['Name', data.name],
                ['Age', data.age],
                ['Nationality', data.nationality],
                ['Region', regionLabel],
                ['Position', positionLabel],
                ...(data.bio.trim()
                  ? [['Bio', sanitize(data.bio)] as [string, string]]
                  : []),
                ['Highlight Reel (IPFS)', shortCid],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between px-4 py-3 gap-4">
                <dt className="text-sm text-gray-400 shrink-0">{label}</dt>
                <dd className="text-sm text-white text-right break-all">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {txStatus && (
            <TransactionStatus
              status={txStatus}
              txHash={txHash}
              error={errors.form}
            />
          )}

          {!txStatus && errors.form && (
            <p role="alert" className="text-sm text-red-500 text-center">
              {errors.form}
            </p>
          )}

          <div className="flex gap-3">
            <Button
              id="wizard-register-button"
              type="button"
              variant="secondary"
              onClick={handleBack}
              disabled={isLoading}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              isLoading={isLoading}
              disabled={isLoading}
              disabledReason={isPaused ? tContractStatus('paused_hint') : undefined}
              className="flex-1"
            >
              {isLoading ? 'Registering...' : 'Register as Player'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
