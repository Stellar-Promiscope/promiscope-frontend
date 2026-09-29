'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/Toast';
import TransactionStatus from '@/components/ui/TransactionStatus';
import type { TxStatus } from '@/components/ui/TransactionStatus';
import TruncatedAddress from '@/components/ui/TruncatedAddress';
import { recordAuditEntry } from '@/lib/adminAuditClient';
import { buildAddValidator, buildRemoveValidator } from '@/lib/contract';
import AdminLoadError from '@/components/admin/AdminLoadError';
import { useAdminConfirm } from '@/components/admin/useAdminConfirm';
import { useAdminContractState } from '@/hooks/useAdminContractState';

const AdminDashboardSkeleton = dynamic(
  () => import('@/components/admin/AdminDashboardSkeleton'),
  { ssr: false },
);

/** /admin/validators — add and remove authorized validators (#571). */
export default function AdminValidatorsPage() {
  const { publicKey, signAndSubmit } = useWallet();
  const { show } = useToast();
  const { validators, setValidators, paused, loading, fetchError, reload } =
    useAdminContractState();
  const { confirm, dialog } = useAdminConfirm();

  const [validatorInput, setValidatorInput] = useState('');

  const [addTxStatus, setAddTxStatus] = useState<TxStatus | null>(null);
  const [addTxHash, setAddTxHash] = useState<string | null>(null);
  const [addTxError, setAddTxError] = useState<string | null>(null);

  const [removeTxStatus, setRemoveTxStatus] = useState<TxStatus | null>(null);
  const [removeTxHash, setRemoveTxHash] = useState<string | null>(null);
  const [removeTxError, setRemoveTxError] = useState<string | null>(null);

  function addValidator() {
    if (!publicKey) return;
    const address = validatorInput;
    confirm({
      label: 'Add Validator',
      message: `Add ${address} as a validator?`,
      run: async () => {
        setAddTxStatus('pending');
        setAddTxHash(null);
        setAddTxError(null);
        const txHash = await signAndSubmit(
          await buildAddValidator(publicKey, address),
        );
        recordAuditEntry({
          actionType: 'validator_add',
          target: address,
          txHash,
          status: 'submitted',
        }).catch(() => {});
        setAddTxHash(txHash);
        setAddTxStatus('success');
        setValidators((v) => [
          ...v,
          { address, addedAt: Date.now() / 1000, addedBy: publicKey },
        ]);
        setValidatorInput('');
        show({ message: 'Validator added.', variant: 'success' });
      },
      onError: (message) => {
        setAddTxStatus('error');
        setAddTxError(message);
      },
    });
  }

  function removeValidator(address: string) {
    if (!publicKey) return;
    confirm({
      label: 'Remove Validator',
      message: `Remove ${address.slice(0, 4)}…${address.slice(-4)} from validators?`,
      run: async () => {
        setRemoveTxStatus('pending');
        setRemoveTxHash(null);
        setRemoveTxError(null);
        const txHash = await signAndSubmit(
          await buildRemoveValidator(publicKey, address),
        );
        recordAuditEntry({
          actionType: 'validator_remove',
          target: address,
          txHash,
          status: 'submitted',
        }).catch(() => {});
        setRemoveTxHash(txHash);
        setRemoveTxStatus('success');
        setValidators((v) => v.filter((val) => val.address !== address));
        show({ message: 'Validator removed.', variant: 'success' });
      },
      onError: (message) => {
        setRemoveTxStatus('error');
        setRemoveTxError(message);
      },
    });
  }

  if (loading) return <AdminDashboardSkeleton />;
  if (fetchError) return <AdminLoadError onRetry={reload} />;

  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <h1 className="text-3xl font-bold text-white">Validators</h1>

      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Manage Validators</h2>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-gray-300">Add Validator</h3>
          <div className="flex gap-3">
            <input
              className="input flex-1"
              placeholder="Stellar public key (G...)"
              value={validatorInput}
              onChange={(e) => setValidatorInput(e.target.value)}
            />
            <button
              disabled={
                !validatorInput.startsWith('G') ||
                validatorInput.length !== 56 ||
                paused
              }
              onClick={addValidator}
              title={paused ? 'Contract is currently paused' : undefined}
              className="px-5 py-2 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <TransactionStatus
            status={addTxStatus}
            txHash={addTxHash}
            error={addTxError}
            onHide={() => {
              setAddTxStatus(null);
              setAddTxHash(null);
            }}
          />
        </div>

        <h3 className="text-sm font-medium text-gray-300">
          Authorized Validators ({validators.length})
        </h3>
        {validators.length === 0 ? (
          <p className="text-sm text-gray-400">No validators authorized.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {validators.map((v) => (
              <li
                key={v.address}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="text-gray-300 font-mono truncate">
                  <TruncatedAddress
                    address={v.address}
                    className="text-gray-300"
                  />
                </span>
                <button
                  disabled={paused}
                  onClick={() => removeValidator(v.address)}
                  title={paused ? 'Contract is currently paused' : undefined}
                  className="text-red-400 hover:text-red-300 transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <TransactionStatus
          status={removeTxStatus}
          txHash={removeTxHash}
          error={removeTxError}
          onHide={() => {
            setRemoveTxStatus(null);
            setRemoveTxHash(null);
          }}
        />
      </section>

      {dialog}
    </div>
  );
}
