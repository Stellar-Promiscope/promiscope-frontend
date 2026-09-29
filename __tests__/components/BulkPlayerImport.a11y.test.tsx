jest.unmock('next-intl');

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/__tests__/setup-providers-intl';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import BulkPlayerImport from '@/components/academy/BulkPlayerImport';
import { useWallet } from '@/hooks/useWallet';

expect.extend(toHaveNoViolations);

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

function renderImport() {
  setupWallet();
  return render(<BulkPlayerImport />);
}

const VALID_CSV = [
  'name,age,nationality,region,position',
  'John Doe,22,Nigerian,nigeria,ST',
].join('\n');

const MIXED_CSV = [
  'name,age,nationality,region,position',
  'John Doe,22,Nigerian,nigeria,ST',
  ',22,Nigerian,nigeria,ST',
].join('\n');

async function uploadFile(
  container: HTMLElement,
  content: string,
  name: string,
) {
  const input = screen.getByLabelText(/player file/i) as HTMLInputElement;
  const file = new File([content], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(
      screen.queryByRole('table') || screen.queryByRole('alert'),
    ).toBeTruthy();
  });
}

describe('BulkPlayerImport – accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has no axe violations in its initial upload-only state', async () => {
    const { container } = renderImport();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the staged preview with only valid rows', async () => {
    const { container } = renderImport();
    await uploadFile(container, VALID_CSV, 'players.csv');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the staged preview with a mix of valid and invalid rows', async () => {
    const { container } = renderImport();
    await uploadFile(container, MIXED_CSV, 'players.csv');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('sets aria-invalid and an aria-describedby link on the file input after a parse error', async () => {
    const { container } = renderImport();
    await uploadFile(container, '{not valid json', 'players.json');

    const input = screen.getByLabelText(/player file/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).toContain('bulk-import-file-error');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
