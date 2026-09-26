import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from '@storybook/test';
import VideoUpload from './VideoUpload';
import Spinner from './Spinner';

const meta: Meta<typeof VideoUpload> = {
  title: 'UI/VideoUpload',
  component: VideoUpload,
  tags: ['autodocs'],
  args: { onUpload: fn() },
};

export default meta;
type Story = StoryObj<typeof VideoUpload>;

export const Default: Story = {
  name: 'Idle (no file selected)',
  args: {},
};

export const WithError: Story = {
  name: 'With Validation Error',
  args: {
    error: 'File size exceeds 100 MB. Please upload a smaller video.',
  },
};

export const UploadingState: Story = {
  name: 'Uploading (visual mock)',
  render: () => (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-300">
        Highlight Reel
      </label>
      <div className="relative">
        <input
          type="file"
          accept="video/*"
          disabled
          className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 opacity-50"
        />
        <div className="absolute inset-0 bg-gray-900/80 flex items-center justify-center rounded-lg">
          <div className="flex items-center gap-2 text-brand-green">
            <Spinner size="sm" />
            <span className="text-sm">Uploading...</span>
          </div>
        </div>
      </div>
    </div>
  ),
};

/**
 * Interaction test (issue #1322): client-side validation rejects an
 * unsupported type and an oversized file before any upload starts.
 */
export const ValidationPlay: Story = {
  name: 'Rejects invalid files (play)',
  args: {},
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Highlight Reel') as HTMLInputElement;
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(
      input,
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    );
    await expect(
      await canvas.findByText(/File type "text\/plain" is not supported/),
    ).toBeInTheDocument();
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    const big = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    await user.upload(input, big);
    await expect(
      await canvas.findByText(/File is too large/),
    ).toBeInTheDocument();

    await expect(args.onUpload).not.toHaveBeenCalled();
  },
};
