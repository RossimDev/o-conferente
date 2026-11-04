import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtQty } from '../api.js';

export default function Home() {
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    api('/stats').then((r) => setStats(r.totals)).catch(() => {});
    api('/search/recent').then((r) => setRecent(r.recent)).catch(() => {});
  }, []);

  const pct = stats && stats.registros > 0 ? Math.round(((stats.conferidos || 0) / stats.registros) * 100) : 0;

  return (
    <div>
      <section className="hero">
        <h1>O Conferente</h1>
        <p>Importe documentos, pesquise qualquer item e localize-o exatamente onde ele está.</p>
        <form className="hero-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Digite um código, nome ou referência… (ex.: 20001 ou 2000)"
            aria-label="Pesquisar"
          />
          <button type="submit">Pesquisar</button>
        </form>
        <div className="hero-actions">
          <Link to="/import">＋ Importar documento</Link>
          <Link to="/database">🗄 Banco de dados</Link>
          <Link to="/conference">✓ Iniciar conferência</Link>
          <Link to="/documents">📄 Gerenciar documentos</Link>
        </div>
      </section>

      <div className="grid cols-4">
        <div className="stat"><div className="n">{stats ? stats.registros : '…'}</div><div className="l">Registros cadastrados</div></div>
        <div className="stat ok"><div className="n">{stats ? stats.conferidos : '…'}</div><div className="l">Itens conferidos</div></div>
        <div className="stat warn"><div className="n">{stats ? stats.pendentes : '…'}</div><div className="l">Itens pendentes</div></div>
        <div className="stat bad"><div className="n">{stats ? (stats.divergentes + stats.revisar) : '…'}</div><div className="l">Divergentes / revisar</div></div>
      </div>

      <div className="card mt">
        <div className="flex between">
          <h2 style={{ margin: 0 }}>Progresso geral</h2>
          <span className="badge neutral">{pct}% conferido</span>
        </div>
        <div className="progressbar mt"><div style={{ width: `${pct}%` }} /></div>
        {stats && stats.revisao_dados > 0 && (
          <p className="mt" style={{ color: 'var(--warn)', fontWeight: 600 }}>
            ⚠ {stats.revisao_dados} registro(s) com baixa confiança aguardando revisão.{' '}
            <Link to="/database?needs_review=1">Revisar agora →</Link>
          </p>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Últimas pesquisas</h2>
          {recent.length === 0 && <p className="muted">Nenhuma pesquisa realizada ainda.</p>}
          {recent.map((r, i) => (
            <div className="list-row" key={i} style={{ cursor: 'pointer' }} onClick={() => nav(`/search?q=${encodeURIComponent(r.query)}`)}>
              <div className="grow">
                <div className="title mono">{r.query}</div>
                <div className="sub">{r.results} resultado(s)</div>
              </div>
              <span className="muted">→</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Atalhos</h2>
          <div className="grid">
            <Link className="btn secondary" to="/import">＋ Importar PDF ou imagem</Link>
            <Link className="btn secondary" to="/conference">✓ Conferência rápida</Link>
            <Link className="btn secondary" to="/database?favorite=1">⭐ Favoritos</Link>
            <Link className="btn secondary" to="/history">🕑 Histórico de alterações</Link>
            <Link className="btn secondary" to="/trash">🗑 Lixeira</Link>
          </div>
          {stats && (
            <p className="muted mt" style={{ fontSize: '.85rem' }}>
              {stats.documentos} documento(s) no acervo · {stats.documentos_processando} em processamento · {stats.favoritos} favorito(s)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
