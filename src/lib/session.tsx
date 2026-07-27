/** App-wide session/account context. Wraps the active backend. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Backend } from './backend';
import { getBackend } from './getBackend';
import { getPushToken } from './push';
import type { Account } from './types';

interface SessionValue {
  backend: Backend;
  account: Account | null;
  loading: boolean;
  isLive: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => getBackend(), []);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const acc = await backend.getAccount();
    setAccount(acc);
  }, [backend]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const acc = await backend.getAccount();
        if (active) setAccount(acc);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [backend]);

  // Register this device for offer pushes once we know who's signed in.
  const userId = account?.session.userId;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const token = await getPushToken();
      if (!active || !token) return;
      try {
        await backend.registerPushToken(token);
      } catch {
        // Push is a nicety; never block the session on it.
      }
    })();
    return () => {
      active = false;
    };
  }, [backend, userId]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await backend.signIn(email, password);
      await refresh();
    },
    [backend, refresh],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      await backend.signUp(email, password);
      await refresh();
    },
    [backend, refresh],
  );

  const signOut = useCallback(async () => {
    await backend.signOut();
    setAccount(null);
  }, [backend]);

  const value = useMemo<SessionValue>(
    () => ({ backend, account, loading, isLive: backend.isLive, refresh, signIn, signUp, signOut }),
    [backend, account, loading, refresh, signIn, signUp, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
