import axios from 'axios';
import {
  ipfsUrl,
  uploadToIPFS,
  uploadToIPFSChunked,
  getChunkedUploadStatus,
  ChunkedUploadError,
  CHUNK_SIZE_BYTES,
  DEFAULT_IPFS_FALLBACKS,
} from '../../lib/ipfs';

jest.mock('axios');

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('lib/ipfs', () => {
  const mockCid = 'QmTest123';
  const mockPrimaryGateway = 'https://gateway.pinata.cloud/ipfs';
  const mockFallback1 = 'https://ipfs.io/ipfs';
  const mockFallback2 = 'https://dweb.link/ipfs';

  beforeEach(() => {
    process.env.NEXT_PUBLIC_IPFS_GATEWAY = mockPrimaryGateway;
    global.fetch = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.NEXT_PUBLIC_IPFS_GATEWAY;
  });

  describe('ipfsUrl', () => {
    it('returns primary gateway URL when primary is successful', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const result = await ipfsUrl(mockCid);

      expect(result).toBe(`${mockPrimaryGateway}/${mockCid}`);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to secondary gateway when primary returns 500', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true });

      const result = await ipfsUrl(mockCid);

      expect(result).toBe(`${mockFallback1}/${mockCid}`);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalled();
    });

    it('tries all gateways and throws error when all are exhausted', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(ipfsUrl(mockCid)).rejects.toThrow(/gateways exhausted/);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('uploadToIPFS', () => {
    it('posts to /api/ipfs/upload and returns the CID', async () => {
      const mockFile = new File(['test content'], 'test.txt', {
        type: 'text/plain',
      });
      const mockCidResponse = { cid: 'QmUpload123' };

      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: mockCidResponse,
      });

      const result = await uploadToIPFS(mockFile);

      expect(result).toBe(mockCidResponse.cid);
      expect(axios.post).toHaveBeenCalledWith(
        '/api/ipfs/upload',
        expect.any(FormData),
      );
    });
  });

  describe('uploadToIPFSChunked', () => {
    it('uploads a single-chunk file via init -> chunk -> complete', async () => {
      const file = makeFile('clip.mp4', 'video/mp4', 1024);
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { sessionId: 'sess-1' } }) // init
        .mockResolvedValueOnce({
          data: { receivedChunks: [0], totalChunks: 1 },
        }) // chunk
        .mockResolvedValueOnce({ data: { cid: 'QmChunked1' } }); // complete

      const onProgress = jest.fn();
      const cid = await uploadToIPFSChunked(file, { onProgress });

      expect(cid).toBe('QmChunked1');
      expect(axios.post).toHaveBeenNthCalledWith(1, '/api/ipfs/upload/init', {
        filename: 'clip.mp4',
        fileType: 'video/mp4',
        fileSize: 1024,
        totalChunks: 1,
      });
      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        '/api/ipfs/upload/chunk',
        expect.any(FormData),
      );
      expect(axios.post).toHaveBeenNthCalledWith(
        3,
        '/api/ipfs/upload/complete',
        {
          sessionId: 'sess-1',
        },
      );
      expect(onProgress).toHaveBeenLastCalledWith(1);
    });

    it('reports the uploading phase up front and the processing phase before /complete', async () => {
      const file = makeFile('clip.mp4', 'video/mp4', 1024);
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { sessionId: 'sess-phase' } }) // init
        .mockResolvedValueOnce({
          data: { receivedChunks: [0], totalChunks: 1 },
        }) // chunk
        .mockResolvedValueOnce({ data: { cid: 'QmPhase' } }); // complete

      const onPhaseChange = jest.fn();
      await uploadToIPFSChunked(file, { onPhaseChange });

      expect(onPhaseChange.mock.calls.map((c) => c[0])).toEqual([
        'uploading',
        'processing',
      ]);
    });

    it('splits a multi-chunk file into CHUNK_SIZE_BYTES pieces and uploads each', async () => {
      const file = makeFile(
        'clip.mp4',
        'video/mp4',
        CHUNK_SIZE_BYTES * 2 + 100,
      );
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { sessionId: 'sess-multi' } })
        .mockResolvedValueOnce({
          data: { receivedChunks: [0], totalChunks: 3 },
        })
        .mockResolvedValueOnce({
          data: { receivedChunks: [0, 1], totalChunks: 3 },
        })
        .mockResolvedValueOnce({
          data: { receivedChunks: [0, 1, 2], totalChunks: 3 },
        })
        .mockResolvedValueOnce({ data: { cid: 'QmMulti' } });

      const onProgress = jest.fn();
      const cid = await uploadToIPFSChunked(file, { onProgress });

      expect(cid).toBe('QmMulti');
      // init + 3 chunks + complete = 5 total POSTs
      expect(axios.post).toHaveBeenCalledTimes(5);
      expect(axios.post).toHaveBeenNthCalledWith(1, '/api/ipfs/upload/init', {
        filename: 'clip.mp4',
        fileType: 'video/mp4',
        fileSize: CHUNK_SIZE_BYTES * 2 + 100,
        totalChunks: 3,
      });
      expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
        0,
        1 / 3,
        2 / 3,
        1,
      ]);
    });

    it('resuming a session skips init and only uploads chunks the server does not have', async () => {
      const file = makeFile('clip.mp4', 'video/mp4', CHUNK_SIZE_BYTES * 2);
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: { receivedChunks: [0], totalChunks: 2 },
      });
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({
          data: { receivedChunks: [0, 1], totalChunks: 2 },
        }) // chunk 1 only
        .mockResolvedValueOnce({ data: { cid: 'QmResumed' } }); // complete

      const cid = await uploadToIPFSChunked(file, {
        resumeSessionId: 'sess-resume',
      });

      expect(cid).toBe('QmResumed');
      expect(axios.get).toHaveBeenCalledWith('/api/ipfs/upload/status', {
        params: { sessionId: 'sess-resume' },
      });
      // Only one chunk POST (index 1) plus complete — no init call, no re-upload of chunk 0.
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('retries a failed chunk before giving up', async () => {
      jest.useFakeTimers();
      const file = makeFile('clip.mp4', 'video/mp4', 1024);
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { sessionId: 'sess-retry' } }) // init
        .mockRejectedValueOnce(new Error('network blip')) // chunk attempt 1
        .mockResolvedValueOnce({
          data: { receivedChunks: [0], totalChunks: 1 },
        }) // chunk attempt 2
        .mockResolvedValueOnce({ data: { cid: 'QmRetried' } }); // complete

      const promise = uploadToIPFSChunked(file);
      await jest.runAllTimersAsync();
      const cid = await promise;

      expect(cid).toBe('QmRetried');
      jest.useRealTimers();
    });

    it('throws a resumable ChunkedUploadError after exhausting chunk retries', async () => {
      jest.useFakeTimers();
      const file = makeFile('clip.mp4', 'video/mp4', 1024);
      (axios.post as jest.Mock)
        .mockResolvedValueOnce({ data: { sessionId: 'sess-fail' } }) // init
        .mockRejectedValue(new Error('persistent network failure')); // every chunk attempt

      const promise = uploadToIPFSChunked(file).catch((err) => err);
      await jest.runAllTimersAsync();
      const err = await promise;

      expect(err).toBeInstanceOf(ChunkedUploadError);
      expect(err.sessionId).toBe('sess-fail');
      expect(err.uploadedChunks).toBe(0);
      expect(err.totalChunks).toBe(1);
      jest.useRealTimers();
    });
  });

  describe('getChunkedUploadStatus', () => {
    it('GETs the status endpoint with the sessionId param', async () => {
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: { receivedChunks: [0, 1], totalChunks: 3 },
      });

      const result = await getChunkedUploadStatus('sess-1');

      expect(axios.get).toHaveBeenCalledWith('/api/ipfs/upload/status', {
        params: { sessionId: 'sess-1' },
      });
      expect(result).toEqual({ receivedChunks: [0, 1], totalChunks: 3 });
    });
  });
});
