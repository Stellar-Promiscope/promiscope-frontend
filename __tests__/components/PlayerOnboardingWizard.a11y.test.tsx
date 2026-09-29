import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import PlayerOnboardingWizard from '@/components/player/PlayerOnboardingWizard';
import { useWallet } from '@/hooks/useWallet';

expect.extend(toHaveNoViolations);

jest.mock('@/lib/stellar', () => ({
  rpc: {
    getAccount: jest.fn(),
    prepareTransaction: jest.fn(),
    simulateTransaction: jest.fn(),
    sendTransaction: jest.fn(),
    getTransaction: jest.fn(),
  },
  NETWORK: 'TESTNET',
  BASE_FEE: '100',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: jest.fn(),
}));

jest.mock('@/hooks/useIsPaused', () => ({
  __esModule: true,
  default: jest.fn().mockReturnValue(false),
}));

jest.mock('@/lib/contract', () => ({
  buildRegisterPlayer: jest.fn(),
}));

jest.mock('@/components/ui/VideoUpload', () => ({
  __esModule: true,
  default: ({
    onUpload,
    error,
  }: {
    onUpload: (cid: string) => void;
    error?: string;
  }) => (
    <div>
      <button type="button" onClick={() => onUpload('QmTestCID1234567890')}>
        Upload video
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  ),
}));

const mockedUseWallet = useWallet as jest.MockedFunction<typeof useWallet>;

function setupWallet() {
  mockedUseWallet.mockReturnValue({
    publicKey: 'GABC123PUBLICKEY',
    isAuthenticated: true,
    isConnecting: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    signAndSubmit: jest.fn().mockResolvedValue({ hash: 'tx-hash-123' }),
  } as any);
}

function renderWizard() {
  setupWallet();
  return render(<PlayerOnboardingWizard onSuccess={jest.fn()} />);
}

describe('PlayerOnboardingWizard – accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('axe-core violations', () => {
    it('step 1 has no axe violations in its initial state', async () => {
      const { container } = renderWizard();
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('step 1 has no axe violations after a failed validation attempt', async () => {
      const { container } = renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('step 2 has no axe violations after a failed validation attempt', async () => {
      const { container } = renderWizard();
      await act(async () => {
        const nameInput = screen.getByLabelText(/name \*/i);
        fireEvent.change(nameInput, {
          target: { name: 'name', value: 'Alice' },
        });
        const ageInput = screen.getByLabelText(/age \*/i);
        fireEvent.change(ageInput, { target: { name: 'age', value: '22' } });
        const natInput = screen.getByLabelText(/nationality \*/i);
        fireEvent.change(natInput, {
          target: { name: 'nationality', value: 'Kenyan' },
        });
        const [regionSelect, positionSelect] = screen.getAllByRole('combobox');
        fireEvent.change(regionSelect, {
          target: { name: 'region', value: 'nigeria' },
        });
        fireEvent.change(positionSelect, {
          target: { name: 'position', value: 'ST' },
        });
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      });
      // Now on step 2 – try to advance without uploading
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('field-level error ARIA linkage', () => {
    it('moves focus to the first invalid field after validation', async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByRole('button', { name: /continue/i }));

      expect(screen.getByLabelText(/name \*/i)).toHaveFocus();
    });

    it('sets aria-invalid on name input when name is missing', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByLabelText(/name \*/i)).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });

    it('sets aria-invalid on age input when age is missing', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByLabelText(/age \*/i)).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });

    it('sets aria-invalid on nationality input when nationality is missing', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByLabelText(/nationality \*/i)).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });

    it('sets aria-invalid on region select when region is missing', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const regionSelect = screen.getByLabelText(/region \*/i);
      expect(regionSelect).toHaveAttribute('aria-invalid', 'true');
    });

    it('sets aria-invalid on position select when position is missing', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const positionSelect = screen.getByLabelText(/position \*/i);
      expect(positionSelect).toHaveAttribute('aria-invalid', 'true');
    });

    it('links the name error via aria-describedby to the error element', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const nameInput = screen.getByLabelText(/name \*/i);
      const describedById = nameInput.getAttribute('aria-describedby');
      expect(describedById).toBeTruthy();
      const errorEl = document.getElementById(describedById!);
      expect(errorEl).toBeTruthy();
      expect(errorEl).toHaveTextContent('Name is required');
    });

    it('links the age error via aria-describedby to the error element', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const ageInput = screen.getByLabelText(/age \*/i);
      const describedById = ageInput.getAttribute('aria-describedby');
      expect(describedById).toBeTruthy();
      const errorEl = document.getElementById(describedById!);
      expect(errorEl).toBeTruthy();
      expect(errorEl).toHaveTextContent('Age is required');
    });

    it('does not set aria-invalid on valid inputs', () => {
      renderWizard();
      const nameInput = screen.getByLabelText(/name \*/i);
      expect(nameInput).not.toHaveAttribute('aria-invalid');
    });

    it('clears aria-invalid after the user corrects a field', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(screen.getByLabelText(/name \*/i)).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      fireEvent.change(screen.getByLabelText(/name \*/i), {
        target: { name: 'name', value: 'Alice' },
      });
      expect(screen.getByLabelText(/name \*/i)).not.toHaveAttribute(
        'aria-invalid',
      );
    });
  });

  it('moves focus to the new step heading and announces the step number', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByLabelText(/name \*/i), 'Alice');
    await user.type(screen.getByLabelText(/age \*/i), '22');
    await user.type(screen.getByLabelText(/nationality \*/i), 'Kenyan');
    const [regionSelect, positionSelect] = screen.getAllByRole('combobox');
    await user.selectOptions(regionSelect, 'nigeria');
    await user.selectOptions(positionSelect, 'ST');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(
      screen.getByRole('heading', { name: /highlight reel/i }),
    ).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Step 2 of 3');
  });

  describe('form-level validation summary', () => {
    it('shows a role="alert" summary after a failed step 1 validation', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const summary = screen.getByRole('alert', {
        name: /form validation summary/i,
      });
      expect(summary).toBeInTheDocument();
    });

    it('validation summary mentions the number of errors', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const summary = screen.getByRole('alert', {
        name: /form validation summary/i,
      });
      expect(summary).toHaveTextContent('5 errors');
    });

    it('hides the summary once all step 1 errors are corrected', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      // Fix all fields
      fireEvent.change(screen.getByLabelText(/name \*/i), {
        target: { name: 'name', value: 'Alice' },
      });
      fireEvent.change(screen.getByLabelText(/age \*/i), {
        target: { name: 'age', value: '22' },
      });
      fireEvent.change(screen.getByLabelText(/nationality \*/i), {
        target: { name: 'nationality', value: 'Kenyan' },
      });
      const [regionSelect, positionSelect] = screen.getAllByRole('combobox');
      fireEvent.change(regionSelect, {
        target: { name: 'region', value: 'nigeria' },
      });
      fireEvent.change(positionSelect, {
        target: { name: 'position', value: 'ST' },
      });
      expect(
        screen.queryByRole('alert', { name: /form validation summary/i }),
      ).toBeNull();
    });

    it('shows a step 2 summary after failing to upload before continuing', async () => {
      renderWizard();
      await act(async () => {
        const nameInput = screen.getByLabelText(/name \*/i);
        fireEvent.change(nameInput, {
          target: { name: 'name', value: 'Alice' },
        });
        fireEvent.change(screen.getByLabelText(/age \*/i), {
          target: { name: 'age', value: '22' },
        });
        fireEvent.change(screen.getByLabelText(/nationality \*/i), {
          target: { name: 'nationality', value: 'Kenyan' },
        });
        const [regionSelect, positionSelect] = screen.getAllByRole('combobox');
        fireEvent.change(regionSelect, {
          target: { name: 'region', value: 'nigeria' },
        });
        fireEvent.change(positionSelect, {
          target: { name: 'position', value: 'ST' },
        });
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(
        screen.getByRole('alert', { name: /form validation summary/i }),
      ).toBeInTheDocument();
    });
  });

  describe('focus management', () => {
    it('moves focus to the name input (first invalid field) after step 1 fails', () => {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(document.activeElement).toBe(screen.getByLabelText(/name \*/i));
    });

    it('moves focus to the age input when name is valid but age is invalid', () => {
      renderWizard();
      fireEvent.change(screen.getByLabelText(/name \*/i), {
        target: { name: 'name', value: 'Alice' },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(document.activeElement).toBe(screen.getByLabelText(/age \*/i));
    });

    it('moves focus to nationality input when name and age are valid', () => {
      renderWizard();
      fireEvent.change(screen.getByLabelText(/name \*/i), {
        target: { name: 'name', value: 'Alice' },
      });
      fireEvent.change(screen.getByLabelText(/age \*/i), {
        target: { name: 'age', value: '22' },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(document.activeElement).toBe(
        screen.getByLabelText(/nationality \*/i),
      );
    });

    it('moves focus to region select when name, age, and nationality are valid', () => {
      renderWizard();
      fireEvent.change(screen.getByLabelText(/name \*/i), {
        target: { name: 'name', value: 'Alice' },
      });
      fireEvent.change(screen.getByLabelText(/age \*/i), {
        target: { name: 'age', value: '22' },
      });
      fireEvent.change(screen.getByLabelText(/nationality \*/i), {
        target: { name: 'nationality', value: 'Kenyan' },
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      expect(document.activeElement).toBe(screen.getByLabelText(/region \*/i));
    });

    it('moves focus to step 2 summary when no video is uploaded', async () => {
      renderWizard();
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/name \*/i), {
          target: { name: 'name', value: 'Alice' },
        });
        fireEvent.change(screen.getByLabelText(/age \*/i), {
          target: { name: 'age', value: '22' },
        });
        fireEvent.change(screen.getByLabelText(/nationality \*/i), {
          target: { name: 'nationality', value: 'Kenyan' },
        });
        const [regionSelect, positionSelect] = screen.getAllByRole('combobox');
        fireEvent.change(regionSelect, {
          target: { name: 'region', value: 'nigeria' },
        });
        fireEvent.change(positionSelect, {
          target: { name: 'position', value: 'ST' },
        });
        fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      });
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      const summary = screen.getByRole('alert', {
        name: /form validation summary/i,
      });
      expect(document.activeElement).toBe(summary);
    });
  });
});
