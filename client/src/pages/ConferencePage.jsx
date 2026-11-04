import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useApp } from '../App.jsx';

export default function ConferencePage() {
  const nav = useNavigate();
  const { notify } = useApp();
  const [sessions, setSessions] = useState([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('Estoque');

  const load = () => api('/conference/sessions').then((r) => setSessions(r.sessions)).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await api('/conference/sessions', { method: 'POST', body: { name: name.trim(), type } });
      setName('');
      notify('Sessão criada.');
      nav(`/conference/${r.id}`);
    } catch (e2) { notify(e2.message, 'err'); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Conferência</h1>
          <p className="sub">Sessões independentes com progresso próprio: Estoque, Recebimento, Separação…</p>
        </div>
      </div>

      <div className="card">
        <h2>Nova sessão de conferência</h2>
        <form className="filters" onSubmit={create}>
          <label className="field" style={{ maxWidth: 320 }}>Nome da sessão
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Conferência 01 — Estoque" required />
          </label>
          <label className="field" style={{ maxWidth: 220 }}>Tipo
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {['Estoque', 'Recebimento', 'Separação', 'Auditoria', 'Outro'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <button className="btn">Criar sessão</button>
        </form>
      </div>

      {sessions.length === 0 && (
        <div className="empty">
          <h3>Nenhuma sessão de conferência</h3>
          <p>Crie uma sessão para conferir itens com progresso independente.</p>
        </div>
      )}

      {sessions.map((s) => {
        const total = s.total_items || 0;
        const done = (s.conferidos || 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <div className="list-row" key={s.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/conference/${s.id}`)}>
            <div className="grow">
              <div className="title">{s.name} {s.status === 'fechada' ? <span className="badge gray">encerrada</span> : <span className="badge conferido">aberta</span>}</div>
              <div className="sub">
                {s.type || 'Sem tipo'} · criada em {fmtDate(s.created_at)} ·{' '}
                {done}/{total} conferidos · {s.divergentes || 0} divergente(s) · {s.revisar || 0} a revisar
              </div>
              <div className="progressbar" style={{ marginTop: 8, maxWidth: 420 }}>
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
            <span className="badge neutral">{pct}%</span>
            <button className="btn sm secondary" onClick={(e) => { e.stopPropagation(); if (confirm('Excluir esta sessão?')) api(`/conference/sessions/${s.id}`, { method: 'DELETE' }).then(load); }}>Excluir</button>
          </div>
        );
      })}
    </div>
  );
}
