import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import QRModal from './QRModal';

const meta: Meta<typeof QRModal> = {
  title: 'UI/QRModal',
  component: QRModal,
  tags: ['autodocs'],
  args: { onClose: fn() },
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof QRModal>;

// Obviously-fake sample URL — not a real profile link.
const SAMPLE_URL = 'https://scout-off.example/player/DEMO-PLAYER-0001';

export const Open: Story = {
  args: {
    isOpen: true,
    url: SAMPLE_URL,
  },
};

export const WithCustomTitle: Story = {
  args: {
    isOpen: true,
    url: SAMPLE_URL,
    title: 'Share This Profile',
  },
};

export const Closed: Story = {
  args: {
    isOpen: false,
    url: SAMPLE_URL,
  },
};

/** Interaction test (issue #1322): the QR code renders and Escape closes the dialog. */
export const ClosePlay: Story = {
  name: 'Renders and closes (play)',
  args: { isOpen: true, url: SAMPLE_URL },
  play: async ({ args, canvasElement }) => {
    const dialog = await within(canvasElement).findByRole('dialog');
    await expect(dialog.querySelector('canvas, img, svg')).not.toBeNull();
    await expect(dialog).toHaveTextContent(SAMPLE_URL);

    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
