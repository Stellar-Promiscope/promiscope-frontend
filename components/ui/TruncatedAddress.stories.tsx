import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from '@storybook/test';
import TruncatedAddress from './TruncatedAddress';

// Obviously-fake sample address: correct Stellar public key format
// (G + 55 base32 chars) but not a real, funded account.
const SAMPLE_ADDRESS =
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';

const meta: Meta<typeof TruncatedAddress> = {
  title: 'UI/TruncatedAddress',
  component: TruncatedAddress,
  tags: ['autodocs'],
  args: {
    address: SAMPLE_ADDRESS,
  },
  argTypes: {
    address: { control: 'text' },
    className: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof TruncatedAddress>;

export const Default: Story = {
  name: 'Truncated Display',
};

export const WithCustomClassName: Story = {
  name: 'Custom Trigger Styling',
  args: {
    className: 'text-brand-green text-lg',
  },
};

export const TooltipOnHover: Story = {
  name: 'Tooltip on Hover (full address + copy button)',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The address renders truncated as a single copy-to-clipboard button.
    const trigger = canvas.getByRole('button', {
      name: new RegExp(
        `^${SAMPLE_ADDRESS.slice(0, 4)}.+${SAMPLE_ADDRESS.slice(-4)}$`,
      ),
    });
    await expect(trigger).toHaveAttribute('title', 'Click to copy address');
    await expect(trigger).not.toHaveTextContent(SAMPLE_ADDRESS);
  },
};
