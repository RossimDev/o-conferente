import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadUrl, setToken, getToken } from '../api.js';
import { useApp } from '../App.jsx';

export default function SettingsPage() {
  const { user, notify, setUser } = useApp();
  const [settings, setSettings] = useState({});
  const [users, setUsers] = useState([]);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [newUser, setNewUser] = useState({ username: '', password: '', name: '', role: 'user' });
  const restoreRef = useRef(null);

  const load = () => {
    api('/settings').then((r) => setSettings(r.settings)).catch(() => {});
    api('/auth/users').then((r) => setUsers(r.users)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    try {
      await api('/settings', { method: 'PUT', body: settings });
      notify('Configurações salvas.');
    } catch (e) { notify(e.message, 'err'); }
  };

  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      setPw({ current_password: '', new_password: '' });
      notify('Senha alterada.');
    } catch (e2) { notify(e2.message, 'err'); }
  };

  const createUser = async (e) => {
    e.preventDefault();
    try {
      await api('/auth/register', { method: 'POST', body: newUser });
      setNewUser({ username: '', password: '', name: '', role: 'user' });
      notify('Usuário criado.');
      load();
    } catch (e2) { notify(e2.message, 'err'); }
  };

  const restoreBackup = async (file) => {
    if (!file) return;
    if (!confirm('Restaurar backup substitui os dados atuais. Os dados atuais serão perdidos. Continuar?')) return;
    const fd = new FormData();
    fd.append('backup', file);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Falha na restauração');
      notify('Backup restaurado. Recarregue a página.');
    } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="sub">Conta, segurança, dados e backup.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Conta</h2>
          <p>Conectado como <b>{user?.name || user?.username}</b> ({user?.role})</p>
          <form onSubmit={changePw}>
            <h3 className="mt">Alterar senha</h3>
            <label className="field">Senha atual
              <input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
            </label>
            <label className="field">Nova senha
              <input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={6} />
            </label>
            <button className="btn">Alterar senha</button>
          </form>
        </div>

        <div className="card">
          <h2>Preferências</h2>
          <label className="field">Dias na lixeira antes da exclusão definitiva
            <input type="number" min="0" max="365" value={settings.trash_days || '30'} onChange={(e) => setSettings({ ...settings, trash_days: e.target.value })} />
          </label>
          <label className="field">Limiar de confiança para revisão (0 a 1)
            <input type="number" step="0.05" min="0" max="1" value={settings.review_low_confidence || '0.75'} onChange={(e) => setSettings({ ...settings, review_low_confidence: e.target.value })} />
          </label>
          <button className="btn" onClick={saveSettings}>Salvar preferências</button>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />
          <div className="btn-row">
            <Link className="btn secondary" to="/trash">Gerenciar lixeira</Link>
            <Link className="btn secondary" to="/history">Histórico</Link>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Exportação e backup</h2>
          <p className="muted">Backup completo inclui o banco de dados e todos os documentos originais.</p>
          <div className="btn-row">
            <a className="btn" href={downloadUrl('/backup/download')}>Baixar backup completo (.zip)</a>
            <a className="btn secondary" href={downloadUrl('/export/records', { format: 'xlsx' })}>Exportar Excel</a>
            <a className="btn secondary" href={downloadUrl('/export/records', { format: 'csv' })}>Exportar CSV</a>
            <button className="btn secondary" onClick={() => restoreRef.current?.click()}>Restaurar backup</button>
            <input ref={restoreRef} type="file" accept=".zip" hidden onChange={(e) => restoreBackup(e.target.files[0])} />
          </div>
          <p className="muted mt" style={{ fontSize: '.83rem' }}>
            Depois de restaurar, faça login novamente e aguarde o reprocessamento da fila, se necessário.
          </p>
        </div>

        <div className="card">
          <h2>Usuários</h2>
          {users.map((u) => (
            <div className="list-row" key={u.id}>
              <div className="grow">
                <div className="title">{u.name || u.username}</div>
                <div className="sub">{u.username} · {u.role}</div>
              </div>
            </div>
          ))}
          <form onSubmit={createUser} className="mt">
            <h3>Novo usuário</h3>
            <label className="field">Usuário
              <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} required />
            </label>
            <label className="field">Nome
              <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
            </label>
            <label className="field">Senha
              <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required minLength={6} />
            </label>
            <label className="field">Perfil
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                <option value="user">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <button className="btn secondary">Criar usuário</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2>Serviços externos</h2>
        <p>
          Nenhum serviço pago ou API Key é necessário. Todo o processamento (OCR, extração de PDF, banco de dados)
          funciona localmente no servidor, com tecnologias livres: Tesseract, PDF.js e SQLite.
        </p>
      </div>
    </div>
  );
}
