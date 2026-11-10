import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { useApp } from '../App.jsx';

export default function Login() {
  const { setUser, needsSetup, setNeedsSetup, notify, health, setHealth } = useApp();
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/health').then((h) => {
      setHealth(h);
      setNeedsSetup(!!h.needs_setup);
    }).catch((e) => setHealth({ ok: false, error: e.message }));
  }, []);

  useEffect(() => {
    if (needsSetup) setMode('setup');
  }, [needsSetup]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const path = mode === 'setup' ? '/auth/setup' : '/auth/login';
      const body = mode === 'setup' ? { username, password, name } : { username, password };
      const r = await api(path, { method: 'POST', body });
      setToken(r.token);
      setUser(r.user);
      notify(mode === 'setup' ? 'Administrador criado. Bem-vindo!' : `Bem-vindo, ${r.user.name || r.user.username}!`);
      nav('/');
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  if (health && health.ok === false) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand">
            <img src="/icon-192.png" alt="" width="46" height="46" />
            <span>O Conferente</span>
          </div>
          <h2 style={{ textAlign: 'center' }}>Banco de dados indisponível</h2>
          <p className="muted">
            O aplicativo está publicado, mas não foi possível acessar o banco de dados no momento.
            Isso costuma ser temporário — aguarde alguns segundos e tente novamente.
          </p>
          <p className="muted" style={{ fontSize: '.85rem' }}>
            Se o problema persistir, verifique os registros do serviço (logs) ou o armazenamento do servidor.
          </p>
          <button className="btn secondary" style={{ width: '100%' }} onClick={() => location.reload()}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <img src="/icon-192.png" alt="" width="46" height="46" />
          <span>O Conferente</span>
        </div>
        <p className="center muted" style={{ marginTop: -8, marginBottom: 20 }}>
          {mode === 'setup'
            ? 'Configuração inicial — crie a conta do administrador'
            : 'Entre para acessar seus documentos e conferências'}
        </p>
        <form onSubmit={submit}>
          {mode === 'setup' && (
            <label className="field">Nome
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
            </label>
          )}
          <label className="field">Usuário
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" />
          </label>
          <label className="field">Senha
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'setup' ? 6 : 1} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} />
          </label>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Aguarde…' : mode === 'setup' ? 'Criar administrador e começar' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
