import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getToken, Role, setToken, User } from './api';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): void;
  can(...roles: Role[]): boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api.get<User>('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const value: AuthCtx = {
    user,
    loading,
    async login(email, password) {
      const r = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
      setToken(r.token);
      setUser(r.user);
    },
    logout() {
      setToken(null);
      setUser(null);
    },
    /** ADMIN has every privilege. */
    can: (...roles) => !!user && (user.role === 'ADMIN' || roles.includes(user.role)),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Whether the server has an AI provider configured (hides AI-only actions otherwise). */
export function useAiEnabled() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['meta'], queryFn: () => api.get<any>('/meta'), enabled: !!user, staleTime: 60_000 });
  return !!q.data?.ai?.enabled;
}
