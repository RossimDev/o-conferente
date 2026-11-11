import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { useApp } from '../App.jsx';
import { loadLocalBackup, restoreFromLocal, clearLocalBackup, getSavedUsername } from '../localBackup.js';
import PasswordField, { ChevronIcon } from '../components/PasswordField.jsx';

export default function Login() {
  const { setUser, needsSetup, setNeedsSetup, notify, health, setHealth } = useApp();
  const nav = useNavigate();

  // Entrar
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Criar nova conta
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [busyLogin, setBusyLogin] = useState(false);
  const [busyRegister, setBusyRegister] = useState(false);
  const [savedAccount, setSavedAccount] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    api('/health').then((h) => {
      setHealth(h);
      setNeedsSetup(!!h.needs_setup);
    }).catch((e) => setHealth({ ok: false, error: e.message }));
    loadLocalBackup().then((s) => setSavedAccount(s)).catch(() => {});
    getSavedUsername().then((u) => { if (u) setUsername(u); }).catch(() => {});
  }, []);

  const restoreSaved = async () => {
    setRestoring(true);
    try {
      await restoreFromLocal();
      const h = await api('/health');
      setHealth(h);
      setNeedsSetup(!!h.needs_setup);
      notify('Conta e dados restaurados. Entre com sua senha.');
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setRestoring(false);
    }
  };

  const startFresh = async () => {
    await clearLocalBackup();
    setSavedAccount(null);
    setNeedsSetup(false);
  };

  const doLogin = async (e) => {
    e.preventDefault();
    setBusyLogin(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password } });
      setToken(r.token);
      setUser(r.user);
      notify(`Bem-vindo, ${r.user.name || r.user.username}.`);
      nav('/');
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusyLogin(false);
    }
  };

  const doRegister = async (e) => {
    e.preventDefault();
    setBusyRegister(true);
    try {
      const r = await api('/auth/register', { method: 'POST', body: { username: newUsername, password: newPassword, name: newName } });
      setToken(r.token);
      setUser(r.user);
      notify('Conta criada com sucesso. Bem-vindo.');
      nav('/');
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusyRegister(false);
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
          <h2 className="center">Banco de dados indisponível</h2>
          <p className="muted">
            O aplicativo está publicado, mas não foi possível acessar o banco de dados no momento.
            Isso costuma ser temporário — aguarde alguns segundos e tente novamente.
          </p>
          <p className="muted hint">
            Se o problema persistir, verifique os registros do serviço ou o armazenamento do servidor.
          </p>
          <button className="btn secondary" style={{ width: '100%' }} onClick={() => location.reload()}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  if (needsSetup && savedAccount) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand">
            <img src="/icon-192.png" alt="" width="46" height="46" />
            <span>O Conferente</span>
          </div>
          <h2 className="center">Encontramos sua conta neste dispositivo</h2>
          <p className="muted center">
            A conta <b>{savedAccount.username || 'salva'}</b> e tudo o que foi feito nela
            {savedAccount.savedAt ? ` (última cópia em ${new Date(savedAccount.savedAt).toLocaleString('pt-BR')})` : ''}
            {' '}estão guardados neste dispositivo.
          </p>
          <button className="btn" style={{ width: '100%' }} onClick={restoreSaved} disabled={restoring}>
            {restoring ? 'Restaurando…' : 'Restaurar conta e dados'}
          </button>
          <button className="btn secondary" style={{ width: '100%', marginTop: 10 }} onClick={startFresh}>
            Não é você? Começar do zero
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-panels">
        <section className="login-card">
          <div className="brand">
            <img src="/icon-192.png" alt="" width="42" height="42" />
            <span>O Conferente</span>
          </div>
          <h2>Entrar</h2>
          <p className="muted">Acesse sua conta para continuar de onde parou.</p>
          <form onSubmit={doLogin}>
            <label className="field" htmlFor="pw-login-user">Usuário</label>
            <div className="pw-wrap" style={{ marginTop: 0, marginBottom: 14 }}>
              <input
                id="pw-login-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                style={{ paddingRight: 12 }}
              />
            </div>
            <PasswordField
              id="pw-login"
              label="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button className="btn" style={{ width: '100%' }} disabled={busyLogin}>
              {busyLogin ? 'Aguarde…' : 'Entrar'}
              {!busyLogin && <ChevronIcon />}
            </button>
          </form>
          {savedAccount && (
            <p className="muted hint center">
              Conta <b>{savedAccount.username || 'salva'}</b> guardada neste dispositivo.
              {' '}<button type="button" className="linklike" onClick={startFresh}>Esquecer este dispositivo</button>
            </p>
          )}
        </section>

        <section className="login-card">
          <h2>Criar nova conta</h2>
          <p className="muted">Cadastre-se para importar documentos e realizar conferências.</p>
          <form onSubmit={doRegister}>
            <label className="field" htmlFor="reg-nome">Nome</label>
            <div className="pw-wrap" style={{ marginTop: 0, marginBottom: 14 }}>
              <input
                id="reg-nome"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Seu nome"
                autoComplete="name"
                style={{ paddingRight: 12 }}
              />
            </div>
            <label className="field" htmlFor="reg-user">Usuário</label>
            <div className="pw-wrap" style={{ marginTop: 0, marginBottom: 14 }}>
              <input
                id="reg-user"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="3 a 32 caracteres"
                style={{ paddingRight: 12 }}
              />
            </div>
            <PasswordField
              id="reg-pw"
              label="Senha"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              placeholder="Mínimo de 6 caracteres"
            />
            <button className="btn" style={{ width: '100%' }} disabled={busyRegister}>
              {busyRegister ? 'Aguarde…' : 'Criar conta'}
              {!busyRegister && <ChevronIcon />}
            </button>
          </form>
          <p className="muted hint center">
            Cada conta mantém seus próprios documentos, registros e conferências.
          </p>
        </section>
      </div>
    </div>
  );
}
