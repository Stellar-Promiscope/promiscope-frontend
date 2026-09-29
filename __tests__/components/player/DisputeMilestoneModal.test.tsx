jest.unmock('next-intl');

import React from 'react';
import { render, screen } from '@/__tests__/setup-providers-intl';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DisputeMilestoneModal from '@/components/player/DisputeMilestoneModal';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: { count: number; max: number }) => {
    if (key === 'character_count' && params) {
      return `${params.count} of ${params.max} characters`;
    }
    return key;
  },
}));

describe('DisputeMilestoneModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <DisputeMilestoneModal
        isOpen={false}
        onClose={jest.fn()}
        milestoneDescription="KYC verified"
        onSubmit={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a validation error and does not submit when the reason is too short', async () => {
    const onSubmit = jest.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <DisputeMilestoneModal
        isOpen
        onClose={jest.fn()}
        milestoneDescription="KYC verified"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText('Reason'), 'too short');
    await user.click(screen.getByRole('button', { name: 'Submit dispute' }));

    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the trimmed reason and closes on success', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <DisputeMilestoneModal
        isOpen
        onClose={onClose}
        milestoneDescription="KYC verified"
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByLabelText('Reason'),
      '  This was rejected without a clear explanation.  ',
    );
    await user.click(screen.getByRole('button', { name: 'Submit dispute' }));

    expect(onSubmit).toHaveBeenCalledWith(
      'This was rejected without a clear explanation.',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error message and keeps the modal open when submission fails', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Network error'));
    const onClose = jest.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <DisputeMilestoneModal
        isOpen
        onClose={onClose}
        milestoneDescription="KYC verified"
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByLabelText('Reason'),
      'This was rejected without a clear explanation.',
    );
    await user.click(screen.getByRole('button', { name: 'Submit dispute' }));

    expect(await screen.findByText('Network error')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking Cancel closes without submitting', async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <DisputeMilestoneModal
        isOpen
        onClose={onClose}
        milestoneDescription="KYC verified"
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('character counter and maxLength', () => {
    it('sets maxLength on the textarea to 2000', () => {
      render(
        <DisputeMilestoneModal
          isOpen
          onClose={jest.fn()}
          milestoneDescription="KYC verified"
          onSubmit={jest.fn()}
        />,
      );

      const textarea = screen.getByLabelText('Reason');
      expect(textarea).toHaveAttribute('maxLength', '2000');
    });

    it('displays character counter showing current length and max', async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <DisputeMilestoneModal
          isOpen
          onClose={jest.fn()}
          milestoneDescription="KYC verified"
          onSubmit={jest.fn()}
        />,
      );

      const textarea = screen.getByLabelText('Reason');
      await user.type(textarea, 'test');

      expect(screen.getByText('5 of 2000 characters')).toBeInTheDocument();
    });

    it('sets aria-live="polite" when within 10% of the limit', async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <DisputeMilestoneModal
          isOpen
          onClose={jest.fn()}
          milestoneDescription="KYC verified"
          onSubmit={jest.fn()}
        />,
      );

      const textarea = screen.getByLabelText('Reason');
      const counter = screen.getByText(/0 of 2000 characters/i);

      // Initially not near limit
      expect(counter).not.toHaveAttribute('aria-live');

      // Type 1800 characters (90% of 2000)
      await user.type(textarea, 'a'.repeat(1800));

      expect(counter).toHaveAttribute('aria-live', 'polite');
    });

    it('prevents typing beyond maxLength', async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <DisputeMilestoneModal
          isOpen
          onClose={jest.fn()}
          milestoneDescription="KYC verified"
          onSubmit={jest.fn()}
        />,
      );

      const textarea = screen.getByLabelText('Reason');
      await user.type(textarea, 'a'.repeat(2500));

      // Textarea should not exceed maxLength due to browser enforcement
      expect(textarea).toHaveValue('a'.repeat(2000));
    });
  });

  it('renders translated copy and a pluralized validation error in French', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DisputeMilestoneModal
        isOpen
        onClose={jest.fn()}
        milestoneDescription="KYC verified"
        onSubmit={jest.fn()}
      />,
      { locale: 'fr' },
    );

    expect(screen.getByText('KYC verified')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Motif'), 'court');
    await user.click(
      screen.getByRole('button', { name: 'Envoyer la contestation' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Veuillez décrire votre contestation en au moins 10 caractères.',
    );
  });
});
