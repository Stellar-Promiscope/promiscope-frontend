jest.unmock('next-intl');

import React from 'react';
import { render, screen } from '@/__tests__/setup-providers-intl';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DisputeMilestoneModal from '@/components/player/DisputeMilestoneModal';

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
