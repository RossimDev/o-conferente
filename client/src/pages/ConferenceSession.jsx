import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, fmtQty, queueOfflineOp } from '../api.js';
import { useApp } from '../App.jsx';

const STATUS_ACTIONS = [
  { v: 'conferido', label: 'Conferido', cls: 'success' },
  { v: 'divergente', label: 'Divergente', cls: 'danger' },
  { v: 'revisar', label: 'Revisar', cls: 'warn' },
  { v: 'pendente', label: 'Desmarcar', cls: 'secondary' }
];

/**
 * Sessão de conferência com fluxo CONTÍNUO:
 * pesquise um código, veja o item, marque o status e avance para o próximo.
 */
export default function ConferenceSession() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [current, setCurrent] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    const r = await api(`/conference/sessions/${id}`);
    setSession(r.session);
    setItems(r.items);
    setCounts(r.counts);
    return r;
  }, [id]);

  useEffect(() => {
    load().catch((e) => notify(e.message, 'err'));
    inputRef.current?.focus();
  }, [load]);

  const search = async (term) => {
    if (!term.trim()) { setResults([]); return; }
    const r = await api('/search', { query: { q: term.trim() } });
    const all = [...(r.exact || []), ...(r.prefix || []), ...(r.text || [])];
    setResults(all.slice(0, 8));
  };

  const mark = async (recordId, status) => {
    try {
      const body = { record_id: recordId, status, session_id: Number(id) };
      if (!navigator.onLine) {
        queueOfflineOp({ type: 'quick', body });
        notify('Sem conexão — marcação salva para sincronizar depois.');
      } else {
        await api('/conference/quick', { method: 'POST', body });
      }
      await load();
      setCurrent(null);
      setQ('');
      setResults([]);
      inputRef.current?.focus();
    } catch (e) { notify(e.message, 'err'); }
  };

  const markItem = async (itemId, status) => {
    await api(`/conference/items/${itemId}/status`, { method: 'POST', body: { status } });
    load();
  };

  const addItem = async (recordId) => {
    await api(`/conference/sessions/${id}/items`, { method: 'POST', body: { record_id: recordId } });
    await load();
    notify('Item adicionado à sessão.');
  };

  const total = items.length;
  const done = counts.find((c) => c.status === 'conferido')?.c || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (!session) return <div className="center" style={{ padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="link-btn" onClick={() => nav('/conference')}>Voltar às sessões</button>
          <h1>{session.name}</h1>
          <p className="sub">{session.type || ''} · {done}/{total} conferidos · {pct}% concluído</p>
        </div>
        <div className="btn-row">
          <button className="btn sm secondary" onClick={async () => {
            await api(`/conference/sessions/${id}`, { method: 'PUT', body: { status: session.status === 'fechada' ? 'aberta' : 'fechada' } });
            load();
          }}>
            {session.status === 'fechada' ? 'Reabrir sessão' : 'Encerrar sessão'}
          </button>
        </div>
      </div>

      <div className="progressbar mb"><div style={{ width: `${pct}%` }} /></div>

      {/* Modo contínuo */}
      <div className="continuous-box">
        <h2 style={{ color: '#fff', marginTop: 0 }}>Conferência contínua</h2>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
          placeholder="Digite ou leia o código do item e pressione para buscar…"
          autoComplete="off"
        />
        <div className="hint">Pesquise o código, confira os dados e marque com um toque. O foco volta ao campo automaticamente.</div>

        {current && (
          <div style={{ background: '#fff', color: 'var(--text)', borderRadius: 12, padding: 16, marginTop: 14 }}>
            <div className="flex between">
              <div>
                {current.code ? <span className="code-chip">{current.code}</span> : <span className="badge gray">s/ código</span>}
                <b style={{ marginLeft: 10, fontSize: '1.12rem' }}>{current.name || current.description || '—'}</b>
              </div>
              <b style={{ fontSize: '1.3rem' }}>{fmtQty(current)}</b>
            </div>
            <p className="muted" style={{ margin: '8px 0' }}>
              {current.document ? `${current.document.original_name} · import. nº ${current.document.seq}` : '—'} ·
              página {current.page ?? '—'} · tabela {current.table_no ?? '—'} · linha {current.row_no ?? '—'} · coluna {current.col_no ?? '—'}
            </p>
            {current.description && current.name && <p>{current.description}</p>}
            <div className="check-btns">
              {STATUS_ACTIONS.map((s) => (
                <button key={s.v} className={`btn ${s.cls}`} onClick={() => mark(current.id, s.v)}>{s.label}</button>
              ))}
              <Link className="btn ghost" to={`/records/${current.id}`}>Ver detalhes</Link>
            </div>
          </div>
        )}

        {results.length > 0 && !current && (
          <div style={{ background: '#fff', color: 'var(--text)', borderRadius: 12, padding: 8, marginTop: 12 }}>
            {results.map((r) => (
              <div
                key={r.id}
                className="list-row"
                style={{ cursor: 'pointer', marginBottom: 6 }}
                onClick={() => {
                  setCurrent(r);
                  setResults([]);
                  addItem(r.id).catch(() => {});
                }}
              >
                <div className="grow">
                  <div className="title">{r.code ? <span className="code-chip">{r.code}</span> : 's/ código'} {r.name || r.description || ''}</div>
                  <div className="sub">{fmtQty(r)} · {r.document ? r.document.original_name : ''} · pág {r.page ?? '—'}</div>
                </div>
                <span className={`badge ${r.status}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-title">
        <h2>Itens da sessão ({items.length})</h2>
        <div className="flex">
          {counts.map((c) => <span key={c.status} className={`badge ${c.status}`}>{c.status}: {c.c}</span>)}
        </div>
      </div>

      {items.length === 0 && (
        <div className="empty">
          <h3>Nenhum item nesta sessão</h3>
          <p>Pesquise um código acima para adicionar e conferir itens.</p>
        </div>
      )}

      {items.map((it) => (
        <div className="list-row" key={it.id}>
          <div className="grow">
            <div className="title">
              {it.code ? <span className="code-chip">{it.code}</span> : 's/ código'} {it.name || it.description || '—'}
            </div>
            <div className="sub">
              {fmtQty(it)} · {it.doc_name || '—'} · pág {it.page ?? '—'} · tab {it.table_no ?? '—'} · lin {it.row_no ?? '—'}
            </div>
          </div>
          <span className={`badge ${it.status}`}>{it.status}</span>
          <div className="check-btns">
            {STATUS_ACTIONS.map((s) => (
              <button key={s.v} className={`btn sm ${s.cls} ${it.status === s.v ? 'active' : 'secondary'}`} onClick={() => markItem(it.id, s.v)}>
                {s.label}
              </button>
            ))}
            <Link className="btn sm ghost" to={`/records/${it.record_id}`}>Detalhes</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
