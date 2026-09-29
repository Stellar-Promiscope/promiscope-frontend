import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';
import { ToastProvider, useToast } from './Toast';
import Button from './Button';

const meta: Meta = {
  title: 'UI/Toast',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj;

function ToastTrigger({
  variant,
  message,
}: {
  variant: 'success' | 'error' | 'info' | 'warning';
  message: string;
}) {
  const { show } = useToast();
  return (
    <Button onClick={() => show({ message, variant })}>
      Show {variant} toast
    </Button>
  );
}

export const Success: Story = {
  render: () => (
    <ToastTrigger variant="success" message="Player registered successfully." />
  ),
};

export const Error: Story = {
  render: () => (
    <ToastTrigger
      variant="error"
      message="Transaction failed. Please try again."
    />
  ),
};

export const Info: Story = {
  render: () => (
    <ToastTrigger
      variant="info"
      message="Your subscription expires in 3 days."
    />
  ),
};

export const Warning: Story = {
  render: () => (
    <ToastTrigger
      variant="warning"
      message="Insufficient XLM balance for this action."
    />
  ),
};

export const WithUndoAction: Story = {
  render: () => {
    function Demo() {
      const { show } = useToast();
      return (
        <Button
          onClick={() =>
            show({
              message: 'Removed from watchlist.',
              variant: 'info',
              duration: 5000,
              action: { label: 'Undo', onClick: () => alert('Undone!') },
            })
          }
        >
          Show toast with Undo
        </Button>
      );
    }
    return <Demo />;
  },
};

export const AllVariants: Story = {
  name: 'All Variants (trigger all)',
  render: () => {
    function Demo() {
      const { show } = useToast();
      return (
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() =>
              show({ message: 'Player registered.', variant: 'success' })
            }
          >
            Success
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              show({ message: 'Transaction failed.', variant: 'error' })
            }
          >
            Error
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              show({ message: 'Subscription expires soon.', variant: 'info' })
            }
          >
            Info
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              show({ message: 'Low XLM balance.', variant: 'warning' })
            }
          >
            Warning
          </Button>
        </div>
      );
    }
    return <Demo />;
  },
};

/**
 * Interaction test (issue #1322, regression for #624): three toasts stack
 * without overlapping, then auto-dismiss after their default 4 s duration.
 */
export const StackAndDismissPlay: Story = {
  name: 'Stack and auto-dismiss (play)',
  render: AllVariants.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole('button', { name: 'Success' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Error' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Info' }));

    const toasts = await waitFor(() => {
      const found = page.getAllByLabelText(/ notification: /);
      expect(found).toHaveLength(3);
      return found;
    });

    const rects = toasts
      .map((t) => t.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    for (let i = 1; i < rects.length; i++) {
      await expect(rects[i].top).toBeGreaterThanOrEqual(rects[i - 1].bottom);
    }

    await waitFor(
      () => expect(page.queryAllByLabelText(/ notification: /)).toHaveLength(0),
      { timeout: 6000 },
    );
  },
};
