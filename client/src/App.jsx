import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { api, getToken, setToken, flushOfflineQueue, pendingOfflineOps } from './api.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import SearchPage from './pages/SearchPage.jsx';
import RecordDetail from './pages/RecordDetail.jsx';
import ImportPage from './pages/ImportPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import DatabasePage from './pages/DatabasePage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import DocumentView from './pages/DocumentView.jsx';
import ConferencePage from './pages/ConferencePage.jsx';
import ConferenceSession from './pages/ConferenceSession.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import TrashPage from './pages/TrashPage.jsx';

export const Ctx = React.createContext(null);

export function useApp() {
  return React.useContext(Ctx);
}

export function navigateSearch(nav, q) {
  nav(`/search?q=${encodeURIComponent(q)}`);
}

export function TopSearch({ defaultValue = '' }) {
  const nav = useNavigate();
  const [q, setQ] = useState(defaultValue);
  useEffect(() => setQ(defaultValue), [defaultValue]);
  return (
    <form className="top-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Pesquisar código, nome ou referência…"
        aria-label="Pesquisar"
      />
      <button type="submit" aria-label="Buscar">Buscar</button>
    </form>
  );
}

const NAV = [
  { to: '/', label: 'Início', icon: 'home' },
  { to: '/search', label: 'Buscar', icon: 'search' },
  { to: '/conference', label: 'Conferir', icon: 'check' },
  { to: '/documents', label: 'Docs', icon: 'doc' },
  { to: '/database', label: 'Dados', icon: 'db' },
  { to: '/settings', label: 'Ajustes', icon: 'gear' }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [health, setHealth] = useState(null);
  const [toast, setToast] = useState(null);
  const [offlinePending, setOfflinePending] = useState(0);
  const nav = useNavigate();
  const loc = useLocation();

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3800);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const h = await api('/health');
        setHealth(h);
        setNeedsSetup(!!h.needs_setup);
        if (getToken()) {
          const me = await api('/auth/me');
          setUser(me.user);
        }
      } catch (e) {
        setHealth({ ok: false, error: e.message });
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    setOfflinePending(pendingOfflineOps().length);
    const iv = setInterval(() => setOfflinePending(pendingOfflineOps().length), 5000);
    return () => clearInterval(iv);
  }, [loc.pathname]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ok */ }
    setToken(null);
    setUser(null);
    nav('/login');
  };

  const ctx = { user, setUser, notify, needsSetup, setNeedsSetup, health, setHealth, refreshUser: async () => {
    try { const me = await api('/auth/me'); setUser(me.user); } catch { /* ok */ }
  } };

  if (!ready) {
    return <div className="boot"><div className="spinner" /><p>Carregando O Conferente…</p></div>;
  }

  if (!user) {
    return (
      <Ctx.Provider value={ctx}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Login />} />
        </Routes>
        {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      </Ctx.Provider>
    );
  }

  return (
    <Ctx.Provider value={ctx}>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/icon-192.png" alt="" width="34" height="34" />
          <span>O Conferente</span>
        </NavLink>
        <TopSearch />
        <nav className="topnav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {n.label}
            </NavLink>
          ))}
          <button className="link-btn" onClick={logout}>Sair</button>
        </nav>
      </header>

      {offlinePending > 0 && (
        <div className="offline-banner">
          {offlinePending} alteração(ões) offline aguardando sincronização…
          <button onClick={async () => { const n = await flushOfflineQueue(); notify(`${n} sincronizada(s)`); setOfflinePending(pendingOfflineOps().length); }}>Sincronizar</button>
        </div>
      )}

      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Navigate to="/" />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/records/:id" element={<RecordDetail />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/import/:docId/review" element={<ReviewPage />} />
          <Route path="/database" element={<DatabasePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<DocumentView />} />
          <Route path="/conference" element={<ConferencePage />} />
          <Route path="/conference/:id" element={<ConferenceSession />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>

      <nav className="bottomnav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <NavIcon name={n.icon} />
            <small>{n.label}</small>
          </NavLink>
        ))}
      </nav>

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </Ctx.Provider>
  );
}

function NavIcon({ name }) {
  const p = {
    home: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
    search: 'M10 3a7 7 0 105.3 11.6l4.2 4.2 1.4-1.4-4.2-4.2A7 7 0 0010 3zm0 2a5 5 0 110 10 5 5 0 010-10z',
    check: 'M9 16.2l-3.5-3.5L4 14.2 9 19l11-11-1.5-1.4z',
    doc: 'M6 2h8l4 4v16H6zM14 2v5h4M9 12h6M9 16h6',
    db: 'M4 6c0-1.7 2.7-3 6-3s6 1.3 6 3-2.7 3-6 3-6-1.3-6-3zm0 0v12c0 1.7 2.7 3 6 3s6-1.3 6-3V6M4 12c0 1.7 2.7 3 6 3s6-1.3 6-3',
    gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zm9 4l-2-1.2.3-2.3-2.2-.9-1-2.1-2.3.4L12 3l-1.8 1.9-2.3-.4-1 2.1-2.2.9.3 2.3L3 12l2 1.2-.3 2.3 2.2.9 1 2.1 2.3-.4L12 21l1.8-1.9 2.3.4 1-2.1 2.2-.9-.3-2.3z'
  }[name];
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={p} />
    </svg>
  );
}
