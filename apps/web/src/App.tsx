import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth';
import { api } from './api';
import { Badge, Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { CasesPage } from './pages/Cases';
import { NewCasePage } from './pages/NewCase';
import { CasePage } from './pages/CasePage';
import { TemplatesPage } from './pages/Templates';
import { AuditPage } from './pages/Audit';

const ROLE_LABEL = { ADMIN: 'Admin', ANALYST: 'Analyst', LAB_DIRECTOR: 'Lab director' } as const;

export function App() {
  const { user, loading, logout, can } = useAuth();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<any>('/meta'), enabled: !!user });
  if (loading) return <div className="empty"><Spinner /></div>;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/favicon.svg" alt="" /> VariantDesk
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>Cases</NavLink>
          {can('ANALYST') && <NavLink to="/cases/new">New case</NavLink>}
          {can() && <NavLink to="/admin/templates">Report templates</NavLink>}
          {can('LAB_DIRECTOR') && <NavLink to="/admin/audit">Audit</NavLink>}
        </nav>
        <div className="grow" />
        {meta.data && (
          <Badge tone={meta.data.ai.enabled ? 'ai' : 'outline'} title={meta.data.ai.enabled ? `Provider: ${meta.data.ai.provider}` : 'Set AI_PROVIDER to enable AI assistance'}>
            AI: {meta.data.ai.enabled ? meta.data.ai.model : 'off'}
          </Badge>
        )}
        <span className="small">
          {user.name} · <span className="muted">{ROLE_LABEL[user.role]}</span>
        </span>
        <button className="small" onClick={logout}>Sign out</button>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<CasesPage />} />
          <Route path="/cases/new" element={can('ANALYST') ? <NewCasePage /> : <Navigate to="/" />} />
          <Route path="/cases/:id" element={<CasePage />} />
          <Route path="/admin/templates" element={can() ? <TemplatesPage /> : <Navigate to="/" />} />
          <Route path="/admin/audit" element={can('LAB_DIRECTOR') ? <AuditPage /> : <Navigate to="/" />} />
          <Route path="/login" element={<Navigate to="/" />} />
          <Route path="*" element={<div className="empty">Page not found</div>} />
        </Routes>
      </main>
    </div>
  );
}
