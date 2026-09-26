import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockLogTrialOffer = jest.fn();
const mockUseTrialOffer = jest.fn();

jest.mock('next-intl', () => {
  const en = jest.requireActual('@/messages/en.json');
  return {
    useTranslations: (ns: string) => (key: string) => en[ns]?.[key] ?? key,
  };
});

jest.mock('@/hooks/useTrialOffer', () => ({
  useTrialOffer: () => mockUseTrialOffer(),
}));

import TrialOfferForm from '@/components/scout/TrialOfferForm';

const PLAYER_ID = 'player-123';

function setHook(
  overrides: Partial<ReturnType<typeof mockUseTrialOffer>> = {},
) {
  mockUseTrialOffer.mockReturnValue({
    logTrialOffer: mockLogTrialOffer,
    loading: false,
    error: null,
    txHash: null,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setHook();
});

describe('TrialOfferForm', () => {
  it('renders club name, offer type, and message fields', () => {
    render(<TrialOfferForm playerId={PLAYER_ID} />);

    expect(screen.getByLabelText(/Club Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Offer Type/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Message/)).toBeInTheDocument();

    const select = screen.getByLabelText(/Offer Type/) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(['Trial', 'Loan', 'Transfer']);

    expect(
      screen.getByRole('button', { name: 'Submit Trial Offer' }),
    ).toBeInTheDocument();
  });

  it('shows a validation error and does not submit when club name is blank', async () => {
    const user = userEvent.setup();
    render(<TrialOfferForm playerId={PLAYER_ID} />);

    await user.click(
      screen.getByRole('button', { name: 'Submit Trial Offer' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Club name is required',
    );
    expect(mockLogTrialOffer).not.toHaveBeenCalled();
  });

  it('clears the club-name field error once the user starts typing again', async () => {
    const user = userEvent.setup();
    render(<TrialOfferForm playerId={PLAYER_ID} />);

    await user.click(
      screen.getByRole('button', { name: 'Submit Trial Offer' }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Club Name/), 'F');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('submits trimmed values, resets the form, and calls onSuccess', async () => {
    mockLogTrialOffer.mockResolvedValue(undefined);
    const onSuccess = jest.fn();
    const user = userEvent.setup();

    render(<TrialOfferForm playerId={PLAYER_ID} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/Club Name/), '  FC Barcelona  ');
    await user.selectOptions(screen.getByLabelText(/Offer Type/), 'loan');
    await user.type(screen.getByLabelText(/Message/), '  Great prospect  ');

    await user.click(
      screen.getByRole('button', { name: 'Submit Trial Offer' }),
    );

    await waitFor(() => expect(mockLogTrialOffer).toHaveBeenCalledTimes(1));
    expect(mockLogTrialOffer).toHaveBeenCalledWith(PLAYER_ID, {
      clubName: 'FC Barcelona',
      offerType: 'loan',
      message: 'Great prospect',
    });

    // Success status is shown and fields are reset.
    expect(
      await screen.findByText('Transaction confirmed.'),
    ).toBeInTheDocument();
    expect((screen.getByLabelText(/Club Name/) as HTMLInputElement).value).toBe(
      '',
    );
    expect(
      (screen.getByLabelText(/Offer Type/) as HTMLSelectElement).value,
    ).toBe('trial');
    expect(
      (screen.getByLabelText(/Message/) as HTMLTextAreaElement).value,
    ).toBe('');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('omits the message field when left blank', async () => {
    mockLogTrialOffer.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TrialOfferForm playerId={PLAYER_ID} />);

    await user.type(screen.getByLabelText(/Club Name/), 'Ajax');
    await user.click(
      screen.getByRole('button', { name: 'Submit Trial Offer' }),
    );

    await waitFor(() =>
      expect(mockLogTrialOffer).toHaveBeenCalledWith(PLAYER_ID, {
        clubName: 'Ajax',
        offerType: 'trial',
        message: undefined,
      }),
    );
  });

  it('shows an error status when the transaction fails', async () => {
    mockLogTrialOffer.mockRejectedValue(new Error('boom'));
    setHook({ error: 'Transaction failed' });
    const user = userEvent.setup();

    render(<TrialOfferForm playerId={PLAYER_ID} />);

    await user.type(screen.getByLabelText(/Club Name/), 'Ajax');
    await user.click(
      screen.getByRole('button', { name: 'Submit Trial Offer' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Transaction failed',
    );
  });

  it('disables inputs and shows the submitting label while loading', () => {
    setHook({ loading: true });
    render(<TrialOfferForm playerId={PLAYER_ID} />);

    expect(screen.getByLabelText(/Club Name/)).toBeDisabled();
    expect(screen.getByLabelText(/Offer Type/)).toBeDisabled();
    expect(screen.getByLabelText(/Message/)).toBeDisabled();
    expect(screen.getByRole('button', { name: /submitting…/i })).toBeDisabled();
  });
});
