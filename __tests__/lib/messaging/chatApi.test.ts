jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

import api from '@/lib/api';
import chatApi, {
  fetchThreadMessages,
  markThreadRead,
  sendThreadMessage,
} from '@/lib/messaging/chatApi';

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;

describe('chatApi', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reuses the shared axios instance from lib/api', () => {
    expect(chatApi).toBe(api);
  });

  it('fetchThreadMessages calls GET /threads/:id/messages and returns data', async () => {
    const messages = [{ id: 'msg-1', body: 'Hello' }];
    mockGet.mockResolvedValueOnce({ data: messages });

    await expect(fetchThreadMessages('thread-1')).resolves.toEqual(messages);
    expect(mockGet).toHaveBeenCalledWith('/threads/thread-1/messages', {
      signal: undefined,
    });
  });

  it('sendThreadMessage posts only the body, never a sender identity', async () => {
    const message = { id: 'msg-2', body: 'Hi there' };
    mockPost.mockResolvedValueOnce({ data: message });

    await expect(sendThreadMessage('thread-1', 'Hi there')).resolves.toEqual(
      message,
    );
    expect(mockPost).toHaveBeenCalledWith('/threads/thread-1/messages', {
      body: 'Hi there',
    });
    const payload = mockPost.mock.calls[0][1];
    expect(payload).not.toHaveProperty('sender');
    expect(payload).not.toHaveProperty('senderId');
  });

  it('surfaces a 401 error from sendThreadMessage', async () => {
    mockPost.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 401'), {
        response: { status: 401 },
      }),
    );

    await expect(sendThreadMessage('thread-1', 'Hi')).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('markThreadRead calls POST /threads/:id/read', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });

    await markThreadRead('thread-1');
    expect(mockPost).toHaveBeenCalledWith('/threads/thread-1/read');
  });
});
