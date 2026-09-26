import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import Button from './Button';

const meta: Meta<typeof ConfirmDialog> = {
  title: 'UI/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  args: { onConfirm: fn(), onCancel: fn() },
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialog>;

/**
 * Default confirmation dialog — non-destructive, used for neutral confirmations
 * such as pausing a contract or confirming a settings change.
 */
export const Default: Story = {
  args: {
    isOpen: true,
    title: 'Remove Validator',
    message:
      'Are you sure you want to remove this validator? This action cannot be undone.',
  },
};

/**
 * Destructive action dialog — confirm button signals danger.
 * The component always renders its confirm button with `variant="danger"`,
 * so this story documents that the default appearance is already destructive.
 * Pass a `confirmLabel` that reinforces the irreversible nature of the action.
 */
export const Destructive: Story = {
  name: 'Destructive action',
  args: {
    isOpen: true,
    title: 'Archive Player Profile',
    message:
      'Archiving this profile will hide it from scouts and remove it from search results. This cannot be reversed without contacting support.',
    confirmLabel: 'Archive Profile',
    cancelLabel: 'Keep Profile',
  },
};

/**
 * Loading / pending state — the confirm button shows a spinner and is disabled
 * while an async operation (e.g. an on-chain transaction) is in progress.
 */
export const Loading: Story = {
  args: {
    isOpen: true,
    title: 'Confirm Withdrawal',
    message: 'Withdraw all accumulated platform fees to the admin wallet?',
    loading: true,
  },
};

export const LongDescription: Story = {
  name: 'Long description (scroll test)',
  args: {
    isOpen: true,
    title: 'Revoke All Validator Privileges',
    message:
      'You are about to revoke validator privileges for this wallet. This means they will no longer be able to approve milestones, manage player profiles, or access the validator dashboard. All pending milestones assigned to this validator will be reassigned to the next available validator. This action is permanent and cannot be reversed without re-adding the validator manually through the admin dashboard. Please double-check the wallet address before proceeding.',
    confirmLabel: 'Yes, Revoke',
    cancelLabel: 'Cancel',
  },
};

export const Interactive: Story = {
  name: 'Interactive (open/close)',
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      const [loading, setLoading] = useState(false);

      const handleConfirm = async () => {
        setLoading(true);
        await new Promise((r) => setTimeout(r, 1500));
        setLoading(false);
        setOpen(false);
      };

      return (
        <div className="p-8">
          <Button variant="danger" onClick={() => setOpen(true)}>
            Remove Validator
          </Button>
          <ConfirmDialog
            isOpen={open}
            onConfirm={handleConfirm}
            onCancel={() => setOpen(false)}
            title="Remove Validator"
            message="This will permanently revoke this wallet's validator privileges on-chain."
            confirmLabel="Remove"
            loading={loading}
          />
        </div>
      );
    }
    return <Demo />;
  },
};

/** Interaction test (issue #1322): Cancel, Escape and Confirm call the right handlers. */
export const ConfirmCancelPlay: Story = {
  name: 'Confirm / cancel (play)',
  args: {
    isOpen: true,
    title: 'Remove Validator',
    message: 'Remove this validator?',
    confirmLabel: 'Remove',
    cancelLabel: 'Keep',
  },
  play: async ({ args, canvasElement }) => {
    const dialog = within(await within(canvasElement).findByRole('dialog'));

    await userEvent.click(dialog.getByRole('button', { name: 'Keep' }));
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await expect(args.onConfirm).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    await expect(args.onCancel).toHaveBeenCalledTimes(2);

    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
  },
};

/** Interaction test: while loading, neither button can fire. */
export const LoadingBlocksPlay: Story = {
  name: 'Loading blocks actions (play)',
  args: {
    isOpen: true,
    title: 'Confirm Withdrawal',
    message: 'Withdraw all fees?',
    loading: true,
  },
  play: async ({ args, canvasElement }) => {
    const dialog = within(await within(canvasElement).findByRole('dialog'));
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: /Confirm/ }),
    ).toBeDisabled();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }), {
      pointerEventsCheck: 0,
    });
    await expect(args.onCancel).not.toHaveBeenCalled();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};
