import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, fmtQty, fmtDate } from '../api.js';

export function ResultCard({ r, exact, onStatusChange }) {
  const nav = useNavigate();
  return (
    <div className={`result-card ${exact ? 'exact' : ''}`} onClick={() => nav(`/records/${r.id}`)}>
      <div className="main">
        <div className="flex">
          {r.code
            ? <span className="code-chip">{r.code}</span>
            : <span className="badge gray">sem código</span>}
          <span className="name">{r.name || r.description || '(sem descrição)'}</span>
          {r.needs_review ? <span className="badge revisar" title="Baixa confiança — revise">Revisar dados</span> : null}
        </div>
        {r.description && r.name && <div className="desc">{r.description}</div>}
        <div className="meta">
          <span className="origin">{r.document ? `${r.document.original_name} (import. nº ${r.document.seq})` : 'Documento indisponível'}</span>
          {r.page != null && <span className="origin">Página {r.page}</span>}
          {r.table_no != null && <span className="origin">Tabela {r.table_no}</span>}
          {r.row_no != null && <span className="origin">Linha {r.row_no}</span>}
          {r.col_no != null && <span className="origin">Coluna {r.col_no}</span>}
          {r.reference && <span className="origin">Ref: {r.reference}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 110 }}>
        <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{fmtQty(r)}</div>
        <span className={`badge ${r.status}`} style={{ marginTop: 6 }}>{r.status}</span>
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const q0 = params.get('q') || '';
  const nav = useNavigate();
  const [q, setQ] = useState(q0);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (term) => {
    if (!term.trim()) { setData(null); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api('/search', { query: { q: term.trim() } });
      setData(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { setQ(q0); run(q0); }, [q0, run]);

  const groups = data ? [
    { key: 'exact', title: 'Resultado exato', items: data.exact, cls: 'exact' },
    { key: 'prefix', title: `Códigos iniciados por "${data.query}"`, items: data.prefix },
    { key: 'code_partial', title: 'Outras correspondências de código', items: data.code_partial },
    { key: 'similar', title: 'Códigos semelhantes (confira se não é o que procura)', items: data.similar },
    { key: 'text', title: 'Nome, descrição e referência', items: data.text }
  ].filter((g) => g.items && g.items.length > 0) : [];

  const total = data ? (data.totals.exact + data.totals.prefix + data.totals.code_partial + (data.totals.similar || 0) + data.totals.text) : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Pesquisa</h1>
          <p className="sub">Resultados exatos aparecem sempre primeiro, separados dos parciais.</p>
        </div>
      </div>

      <form className="hero-search" style={{ maxWidth: '100%', marginBottom: 18 }} onSubmit={(e) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q.trim())}`); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código completo, prefixo, nome ou referência…" autoFocus />
        <button type="submit" style={{ background: 'var(--primary)', color: '#fff' }}>Buscar</button>
      </form>

      {busy && <div className="center" style={{ padding: 30 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
      {error && <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div>}

      {data && !busy && (
        <>
          <p className="muted">{total} resultado(s) para <b className="mono">{data.query}</b></p>
          {total === 0 && (
            <div className="empty">
              <h3>Nenhum registro encontrado</h3>
              <p>Verifique o código digitado ou importe documentos que contenham esse item.</p>
              <Link className="btn" to="/import">Importar documento</Link>
            </div>
          )}
          {groups.map((g) => (
            <section className="result-group" key={g.key}>
              <h3>{g.title} <span className="badge gray">{g.items.length}</span></h3>
              {g.items.map((r) => <ResultCard key={r.id} r={r} exact={g.cls === 'exact'} />)}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
