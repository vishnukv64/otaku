// Listens for the backend "deeplink" event (emitted by tray::restore_and_navigate
// whenever the app is brought forward) and navigates the TanStack router.
//
// Mount once at the router root.

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useNavigate } from '@tanstack/react-router';

export function useDeeplinkListener(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<string>('deeplink', (event) => {
      const route = event.payload;
      if (typeof route === 'string' && route.length > 0) {
        navigate({ to: route as never }).catch((e) => {
          console.warn('[deeplink] navigate failed', route, e);
        });
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((e) => console.error('[deeplink] listen failed', e));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);
}
