jest.unmock('next-intl');

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/__tests__/setup-providers-intl';
import '@testing-library/jest-dom';
import BulkPlayerImport from '@/components/academy/BulkPlayerImport';
import { useWallet } from '@/hooks/useWallet';
import { buildRegisterPlayer } from '@/lib/contract';
import {
  getOrCreateSession,
  getSessionRows,
  updateRowStatus,
  deleteSession,
  type BulkImportRowState,
} from '@/lib/bulkImportStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// Stub out IndexedDB-backed session store so the component's file-change
// handler doesn't hang waiting for IDB callbacks that never fire in jsdom.
jest.mock('@/lib/bulkImportStore', () => ({
  hashFileContent: jest.fn().mockResolvedValue('testhash'),
  getOrCreateSession: jest
    .fn()
    .mockResolvedValue({ sessionId: 'sess-1', rows: new Map() }),
  getSessionRows: jest.fn().mockResolvedValue(new Map()),
  updateRowStatus: jest.fn().mockResolvedValue(undefined),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  cleanupExpiredSessions: jest.fn().mockResolvedValue(undefined),
}));

const mockedUseWallet = useWallet as jest.MockedFunction<typeof useWallet>;
const mockedBuildRegisterPlayer = buildRegisterPlayer as jest.MockedFunction<
  typeof buildRegisterPlayer
>;
const mockedUseIsPaused = require('@/hooks/useIsPaused').default as jest.Mock;
const mockedGetSessionRows = getSessionRows as jest.MockedFunction<
  typeof getSessionRows
>;
const mockedGetOrCreateSession = getOrCreateSession as jest.MockedFunction<
  typeof getOrCreateSession
>;
const mockedDeleteSession = deleteSession as jest.MockedFunction<
  typeof deleteSession
>;
const mockedUpdateRowStatus = updateRowStatus as jest.MockedFunction<
  typeof updateRowStatus
>;

const MOCK_PUBLIC_KEY = 'GACADEMYWALLET1234567890';

function setupWallet(overrides: Partial<ReturnType<typeof useWallet>> = {}) {
  mockedUseWallet.mockReturnValue({
    publicKey: MOCK_PUBLIC_KEY,
    isAuthenticated: true,
    isConnecting: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    signAndSubmit: jest.fn().mockResolvedValue({ hash: 'tx-hash-abc' }),
    ...overrides,
  } as any);
}

/** Helper: builds a File the same way a real <input type="file"> change event would. */
function makeFile(content: string, name: string, type = 'text/csv') {
  return new File([content], name, { type });
}

async function uploadFile(content: string, name: string, type?: string) {
  const input = screen.getByLabelText(/player file/i) as HTMLInputElement;
  const file = makeFile(content, name, type);
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input, { target: { files: [file] } });
  // FileReader resolves via a real macrotask in jsdom, not a microtask, so
  // fireEvent's implicit act() wrapper won't wait for it — poll instead.
  await waitFor(() => {
    expect(
      screen.queryByRole('table') || screen.queryByRole('alert'),
    ).toBeTruthy();
  });
}

const VALID_CSV = [
  'name,age,nationality,region,position',
  'John Doe,22,Nigerian,nigeria,ST',
  'Jane Smith,19,Kenyan,kenya,GK',
].join('\n');

const MIXED_CSV = [
  'name,age,nationality,region,position',
  'John Doe,22,Nigerian,nigeria,ST',
  ',22,Nigerian,nigeria,ST',
  'Jane Smith,19,Kenyan,kenya,GK',
].join('\n');

describe('BulkPlayerImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseIsPaused.mockReturnValue(false);
    setupWallet();
  });

  // ── Upload + parsing ─────────────────────────────────────────────────────

  it('renders the file upload control initially with no preview table', () => {
    render(<BulkPlayerImport />);
    expect(screen.getByLabelText(/player file/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a staged preview table after uploading a valid CSV, before any wallet interaction', async () => {
    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(
      screen.getByText(/2 valid · 0 invalid · 2 total/i),
    ).toBeInTheDocument();
    // No signing has happened yet
    expect(mockedBuildRegisterPlayer).not.toHaveBeenCalled();
  });

  it('distinguishes valid and invalid rows in the preview, with per-row error reasons', async () => {
    render(<BulkPlayerImport />);
    await uploadFile(MIXED_CSV, 'players.csv');

    expect(
      screen.getByText(/2 valid · 1 invalid · 3 total/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Valid').length).toBe(2);
    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText(/name: Name is required/i)).toBeInTheDocument();
  });

  it('shows a file-level error and no table for a malformed JSON file', async () => {
    render(<BulkPlayerImport />);
    await uploadFile('{not json', 'players.json', 'application/json');

    expect(screen.getByRole('alert')).toHaveTextContent(/not valid json/i);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('translates coded row errors and counts in the French locale', async () => {
    render(<BulkPlayerImport />, { locale: 'fr' });
    const input = screen.getByLabelText(
      'Fichier des joueurs (CSV ou JSON)',
    ) as HTMLInputElement;
    const file = makeFile(MIXED_CSV, 'players.csv');
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(
      screen.getByText('2 valides · 1 invalides · 3 au total'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nom: Nom est obligatoire/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Importer 2 joueurs valides' }),
    ).toBeInTheDocument();
  });

  it('lets the admin choose another file to reset the preview', async () => {
    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');
    expect(screen.getByRole('table')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /choose another file/i }),
      );
    });
    expect(screen.queryByRole('table')).toBeNull();
  });

  // ── Sequential submission ────────────────────────────────────────────────

  it('submits one buildRegisterPlayer + signAndSubmit call per valid row, sequentially', async () => {
    mockedBuildRegisterPlayer.mockResolvedValue('mock-xdr');
    const signAndSubmit = jest.fn().mockResolvedValue({ hash: 'tx-hash-1' });
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /import 2 valid players/i }),
      );
    });

    await waitFor(() => {
      expect(mockedBuildRegisterPlayer).toHaveBeenCalledTimes(2);
    });
    expect(signAndSubmit).toHaveBeenCalledTimes(2);

    expect(mockedBuildRegisterPlayer).toHaveBeenNthCalledWith(
      1,
      MOCK_PUBLIC_KEY,
      {
        name: 'John Doe',
        age: 22,
        position: 'ST',
        region: 'nigeria',
        nationality: 'Nigerian',
      },
      '',
    );
    expect(mockedBuildRegisterPlayer).toHaveBeenNthCalledWith(
      2,
      MOCK_PUBLIC_KEY,
      {
        name: 'Jane Smith',
        age: 19,
        position: 'GK',
        region: 'kenya',
        nationality: 'Kenyan',
      },
      '',
    );

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/2 registered, 0 failed, 0 skipped/i),
    ).toBeInTheDocument();
  });

  it('continues the batch after one row fails or is rejected, and summarizes results', async () => {
    mockedBuildRegisterPlayer.mockResolvedValue('mock-xdr');
    const signAndSubmit = jest
      .fn()
      .mockResolvedValueOnce({ hash: 'tx-hash-1' })
      .mockRejectedValueOnce(new Error('User declined access'));
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /import 2 valid players/i }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });

    // Batch continued to the second row despite the first... wait, order: row1 succeeds, row2 fails.
    expect(signAndSubmit).toHaveBeenCalledTimes(2);
    expect(mockedBuildRegisterPlayer).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(/1 registered, 1 failed, 0 skipped/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Registered').length).toBe(1);
    expect(screen.getAllByText('Failed').length).toBe(1);
  });

  it('skips invalid rows during submission and only signs for valid ones', async () => {
    mockedBuildRegisterPlayer.mockResolvedValue('mock-xdr');
    const signAndSubmit = jest.fn().mockResolvedValue({ hash: 'tx-hash-1' });
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(MIXED_CSV, 'players.csv');

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /import 2 valid players/i }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });

    expect(mockedBuildRegisterPlayer).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(/2 registered, 0 failed, 1 skipped/i),
    ).toBeInTheDocument();
  });

  it('does not start signing when no wallet is connected', async () => {
    setupWallet({ publicKey: null, signAndSubmit: jest.fn() });
    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    const importButton = screen.getByRole('button', {
      name: /import 2 valid players/i,
    });
    expect(importButton).toBeDisabled();
  });

  it('disables import while the contract is paused', async () => {
    mockedUseIsPaused.mockReturnValue(true);
    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    expect(
      screen.getByRole('button', { name: /import 2 valid players/i }),
    ).toBeDisabled();
  });

  it('disables the import and reset controls once submission is in progress', async () => {
    mockedBuildRegisterPlayer.mockResolvedValue('mock-xdr');
    let resolveSign: (val: unknown) => void;
    const signAndSubmit = jest.fn().mockImplementation(
      () =>
        new Promise((res) => {
          resolveSign = res;
        }),
    );
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    fireEvent.click(
      screen.getByRole('button', { name: /import 2 valid players/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /importing/i })).toBeDisabled();
    });
    expect(
      screen.getByRole('button', { name: /choose another file/i }),
    ).toBeDisabled();

    await act(async () => {
      resolveSign!({ hash: 'tx-hash-1' });
    });
  });

  // ── Pause / cancel ──────────────────────────────────────────────────────

  it('shows a Pause button during submission and pauses the loop', async () => {
    mockedBuildRegisterPlayer.mockResolvedValue('mock-xdr');
    let resolveFirstSign: (val: unknown) => void;
    let resolveSecondSign: (val: unknown) => void;
    let callCount = 0;
    const signAndSubmit = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise((res) => {
          resolveFirstSign = res;
        });
      }
      return new Promise((res) => {
        resolveSecondSign = res;
      });
    });
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    // Start import
    fireEvent.click(
      screen.getByRole('button', { name: /import 2 valid players/i }),
    );

    // Wait for first signature to be in-flight
    await waitFor(() => {
      expect(signAndSubmit).toHaveBeenCalledTimes(1);
    });

    // Click Pause
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    });

    // Finish the in-flight signature
    await act(async () => {
      resolveFirstSign!({ hash: 'tx-hash-1' });
    });

    // The second row should NOT have been submitted yet — loop is paused
    // Give a tick for the polling interval
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(mockedBuildRegisterPlayer).toHaveBeenCalledTimes(1);

    // Click Resume
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    });

    // Now the second row should proceed
    await waitFor(() => {
      expect(mockedBuildRegisterPlayer).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecondSign!({ hash: 'tx-hash-2' });
    });

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });
  });

  it('cancel stops the batch and shows a cancel message', async () => {
    // Row 1 builds immediately; row 2's XDR build is held open so the admin
    // can hit Cancel while row 2 is still being prepared (before its wallet
    // prompt).
    let resolveSecondBuild: (val: unknown) => void = () => {};
    mockedBuildRegisterPlayer
      .mockResolvedValueOnce('mock-xdr-1')
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveSecondBuild = res;
          }),
      );
    let resolveFirstSign: (val: unknown) => void = () => {};
    const signAndSubmit = jest.fn().mockImplementation(
      () =>
        new Promise((res) => {
          resolveFirstSign = res;
        }),
    );
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    // Start import
    fireEvent.click(
      screen.getByRole('button', { name: /import 2 valid players/i }),
    );

    // Wait for first signature to be in-flight
    await waitFor(() => {
      expect(signAndSubmit).toHaveBeenCalledTimes(1);
    });

    // Finish the in-flight signature; the loop advances to row 2 and blocks
    // on its (still-pending) buildRegisterPlayer.
    await act(async () => {
      resolveFirstSign({ hash: 'tx-hash-1' });
    });

    // Wait for row 1 to complete
    await waitFor(() => {
      expect(screen.getAllByText('Registered').length).toBe(1);
    });

    // Click Cancel, then let row 2's build settle — the loop should see the
    // cancellation and break before prompting the wallet for row 2.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });
    await act(async () => {
      resolveSecondBuild('mock-xdr-2');
    });

    // Should return to preview with cancel message, not "Import complete"
    await waitFor(() => {
      expect(screen.queryByText(/import complete/i)).toBeNull();
    });
    expect(screen.getByText(/batch cancelled/i)).toBeInTheDocument();

    // Row 2 was never signed for.
    expect(signAndSubmit).toHaveBeenCalledTimes(1);
    // updateRowStatus should have been called for the cancelled rows
    expect(mockedUpdateRowStatus).toHaveBeenCalled();
  });

  it('preserves already-succeeded rows when cancelling mid-batch', async () => {
    let resolveSecondBuild: (val: unknown) => void = () => {};
    mockedBuildRegisterPlayer
      .mockResolvedValueOnce('mock-xdr-1')
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveSecondBuild = res;
          }),
      );
    let resolveFirstSign: (val: unknown) => void = () => {};
    const signAndSubmit = jest.fn().mockImplementation(
      () =>
        new Promise((res) => {
          resolveFirstSign = res;
        }),
    );
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    // Start import
    fireEvent.click(
      screen.getByRole('button', { name: /import 2 valid players/i }),
    );

    // Wait for first signature to be in-flight
    await waitFor(() => {
      expect(signAndSubmit).toHaveBeenCalledTimes(1);
    });

    // Finish the in-flight signature with success
    await act(async () => {
      resolveFirstSign({ hash: 'tx-hash-1' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('Registered').length).toBe(1);
    });

    // Cancel the batch, then release row 2's pending build.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });
    await act(async () => {
      resolveSecondBuild('mock-xdr-2');
    });

    await waitFor(() => {
      expect(screen.getByText(/batch cancelled/i)).toBeInTheDocument();
    });

    // Row 1's success was persisted to the session (so a resume skips it)…
    const row1Success = mockedUpdateRowStatus.mock.calls.find(
      (c) => c[2] === 'success' && c[3] === 'tx-hash-1',
    );
    expect(row1Success).toBeTruthy();
    // …and it was never rolled back to pending.
    expect(
      mockedUpdateRowStatus.mock.calls.some(
        (c) => c[1] === row1Success![1] && c[2] === 'pending',
      ),
    ).toBe(false);

    // The second row was never signed for — its success is not persisted, so
    // a resume re-attempts it rather than treating it as done.
    expect(signAndSubmit).toHaveBeenCalledTimes(1);
    expect(
      mockedUpdateRowStatus.mock.calls.some((c) => c[3] === 'tx-hash-2'),
    ).toBe(false);
  });

  // ── Resume / idempotency ────────────────────────────────────────────────

  it('shows a resume banner when re-uploading a file with an existing session that has completed rows', async () => {
    // Mock an existing session with row 1 succeeded
    const existingRows = new Map<number, BulkImportRowState>([
      [
        1,
        {
          rowNumber: 1,
          fileHash: 'testhash',
          status: 'success',
          txHash: 'old-tx-hash',
          updatedAt: Date.now(),
        },
      ],
    ]);
    mockedGetSessionRows.mockResolvedValueOnce(existingRows);

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    // Should show resume banner
    await waitFor(() => {
      expect(screen.getByText(/incomplete batch found/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 of 2 rows/i)).toBeInTheDocument();
  });

  it('does not show resume banner when session has no completed rows', async () => {
    // Empty session (no rows completed)
    mockedGetSessionRows.mockResolvedValueOnce(new Map());

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    expect(screen.queryByText(/incomplete batch found/i)).toBeNull();
  });

  it('skips already-succeeded rows when re-importing the same file', async () => {
    // Mock session: row 1 succeeded, row 2 is pending
    const existingRows = new Map<number, BulkImportRowState>([
      [
        1,
        {
          rowNumber: 1,
          fileHash: 'testhash',
          status: 'success',
          txHash: 'old-tx-hash',
          updatedAt: Date.now(),
        },
      ],
    ]);
    mockedGetSessionRows.mockResolvedValueOnce(existingRows);

    mockedBuildRegisterPlayer.mockResolvedValue('mock-xdr');
    const signAndSubmit = jest.fn().mockResolvedValue({ hash: 'tx-hash-new' });
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    // Wait for resume banner
    await waitFor(() => {
      expect(screen.getByText(/incomplete batch found/i)).toBeInTheDocument();
    });

    // Start import (resume)
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /import 2 valid players/i }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });

    // Only 1 row was signed (row 2), row 1 was skipped
    expect(signAndSubmit).toHaveBeenCalledTimes(1);
    expect(mockedBuildRegisterPlayer).toHaveBeenCalledTimes(1);
    // The signed row should be Jane Smith (row 2)
    expect(mockedBuildRegisterPlayer).toHaveBeenCalledWith(
      MOCK_PUBLIC_KEY,
      {
        name: 'Jane Smith',
        age: 19,
        position: 'GK',
        region: 'kenya',
        nationality: 'Kenyan',
      },
      '',
    );
  });

  it('deletes session when clicking "Import another batch" after completion', async () => {
    mockedBuildRegisterPlayer.mockResolvedValue('mock-xdr');
    const signAndSubmit = jest.fn().mockResolvedValue({ hash: 'tx-hash-1' });
    setupWallet({ signAndSubmit });

    render(<BulkPlayerImport />);
    await uploadFile(VALID_CSV, 'players.csv');

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /import 2 valid players/i }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });

    mockedDeleteSession.mockClear();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /import another batch/i }),
      );
    });

    expect(mockedDeleteSession).toHaveBeenCalledWith('sess-1');
    expect(screen.queryByRole('table')).toBeNull();
  });
});
