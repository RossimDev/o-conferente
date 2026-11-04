import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, fmtDate, fmtQty, downloadUrl } from '../api.js';
import { useApp } from '../App.jsx';

const STATUS_LABEL = { pendente: 'Pendente', conferido: 'Conferido', divergente: 'Divergente', revisar: 'Revisar' };

export default function DatabasePage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [data, setData] = useState({ records: [], total: 0, pages: 0 });
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('table');

  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const document_id = params.get('document_id') || '';
  const favorite = params.get('favorite') || '';
  const needs_review = params.get('needs_review') || '';
  const page = Number(params.get('page') || 1);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api('/records', { query: { q, status, document_id, favorite, needs_review, page, limit: 50 } });
      setData(r);
    } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); }
  }, [q, status, document_id, favorite, needs_review, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/documents').then((r) => setDocs(r.documents)).catch(() => {}); }, []);

  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  const act = async (fn, msg) => {
    try { await fn(); notify(msg); load(); } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Banco de dados</h1>
          <p className="sub">{data.total} registro(s) · todos os dados extraídos dos documentos importados</p>
        </div>
        <div className="btn-row">
          <button className={`btn sm ${view === 'table' ? '' : 'secondary'}`} onClick={() => setView('table')}>Tabela</button>
          <button className={`btn sm ${view === 'cards' ? '' : 'secondary'}`} onClick={() => setView('cards')}>Cartões</button>
          <a className="btn sm secondary" href={downloadUrl('/export/records', { format: 'xlsx', status, document_id })}>Exportar Excel</a>
          <a className="btn sm secondary" href={downloadUrl('/export/records', { format: 'csv', status, document_id })}>Exportar CSV</a>
        </div>
      </div>

      <div className="card">
        <div className="filters">
          <label className="field">Busca
            <input defaultValue={q} placeholder="código, nome, descrição…" onKeyDown={(e) => e.key === 'Enter' && setFilter('q', e.target.value)} onBlur={(e) => e.target.value !== q && setFilter('q', e.target.value)} />
          </label>
          <label className="field">Status
            <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">Documento
            <select value={document_id} onChange={(e) => setFilter('document_id', e.target.value)}>
              <option value="">Todos</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.seq} — {d.original_name}</option>)}
            </select>
          </label>
          <button className={`pill-btn ${favorite === '1' ? 'active' : ''}`} onClick={() => setFilter('favorite', favorite === '1' ? '' : '1')}>⭐ Favoritos</button>
          <button className={`pill-btn ${needs_review === '1' ? 'active' : ''}`} onClick={() => setFilter('needs_review', needs_review === '1' ? '' : '1')}>⚠ Revisar</button>
          <button className="pill-btn" onClick={() => setParams({})}>Limpar</button>
        </div>
      </div>

      {busy && <div className="center" style={{ padding: 24 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}

      {!busy && data.records.length === 0 && (
        <div className="empty">
          <h3>Nenhum registro encontrado</h3>
          <p>Importe documentos para popular o banco de dados.</p>
          <Link className="btn" to="/import">Importar documento</Link>
        </div>
      )}

      {!busy && view === 'table' && data.records.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th><th>Nome / Descrição</th><th>Quantidade</th><th>Origem</th><th>Localização</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id} className={`clickable ${r.needs_review ? 'low-confidence' : ''}`} onClick={() => nav(`/records/${r.id}`)}>
                  <td>{r.code ? <span className="code-chip">{r.code}</span> : <span className="badge gray">s/ código</span>}</td>
                  <td>
                    <b>{r.name || '—'}</b>
                    {r.description && <div className="muted" style={{ fontSize: '.83rem' }}>{r.description}</div>}
                    {r.reference && <div className="muted" style={{ fontSize: '.8rem' }}>Ref: {r.reference}</div>}
                  </td>
                  <td>{fmtQty(r)}</td>
                  <td style={{ fontSize: '.83rem' }}>{r.document ? `#${r.document.seq} ${r.document.original_name}` : '—'}</td>
                  <td style={{ fontSize: '.83rem' }}>
                    Pág {r.page ?? '—'} · Tab {r.table_no ?? '—'} · Lin {r.row_no ?? '—'} · Col {r.col_no ?? '—'}
                  </td>
                  <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="btn-row">
                      <button className="btn sm secondary" title="Favoritar" onClick={() => act(() => api(`/records/${r.id}/favorite`, { method: 'POST' }), 'Favoritos atualizados')}>{r.favorite ? '⭐' : '☆'}</button>
                      <button className="btn sm secondary" title="Marcar conferido" onClick={() => act(() => api(`/records/${r.id}/status`, { method: 'POST', body: { status: 'conferido' } }), 'Conferido!')}>✓</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!busy && view === 'cards' && (
        <div className="grid cols-2">
          {data.records.map((r) => (
            <div className="card" key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/records/${r.id}`)}>
              <div className="flex between">
                {r.code ? <span className="code-chip">{r.code}</span> : <span className="badge gray">s/ código</span>}
                <span className={`badge ${r.status}`}>{r.status}</span>
              </div>
              <h3 className="mt">{r.name || r.description || '—'}</h3>
              <p className="muted">{r.description && r.name ? r.description : ''}</p>
              <div className="flex between mt">
                <b>{fmtQty(r)}</b>
                <span className="origin">{r.document ? `${r.document.original_name} · pág ${r.page ?? '—'} · lin ${r.row_no ?? '—'}` : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.pages > 1 && (
        <div className="flex" style={{ justifyContent: 'center', marginTop: 18 }}>
          <button className="btn sm secondary" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))}>← Anterior</button>
          <span className="muted">Página {page} de {data.pages}</span>
          <button className="btn sm secondary" disabled={page >= data.pages} onClick={() => setFilter('page', String(page + 1))}>Próxima →</button>
        </div>
      )}
    </div>
  );
}
