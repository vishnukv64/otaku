import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeeplinkListener } from './useDeeplinkListener';

const navigate = vi.fn().mockResolvedValue(undefined);
let registeredHandler: ((event: { payload: string }) => void) | undefined;
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_eventName: string, handler: (e: { payload: string }) => void) => {
    registeredHandler = handler;
    return Promise.resolve(unlisten);
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockReset();
  navigate.mockResolvedValue(undefined);
  unlisten.mockReset();
  registeredHandler = undefined;
});

describe('useDeeplinkListener', () => {
  it('navigates when a string deeplink payload is received', async () => {
    renderHook(() => useDeeplinkListener());
    await Promise.resolve();

    registeredHandler?.({ payload: '/anime/123' });
    expect(navigate).toHaveBeenCalledWith({ to: '/anime/123' });
  });

  it('ignores empty payloads', async () => {
    renderHook(() => useDeeplinkListener());
    await Promise.resolve();

    registeredHandler?.({ payload: '' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useDeeplinkListener());
    await Promise.resolve();

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
