import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api, fmtDate, fmtQty, downloadUrl, authHeaders } from '../api.js';
import { useApp } from '../App.jsx';
import { StatusBadge } from './ImportPage.jsx';

/**
 * Visualização do documento original com abertura na página exata
 * e destaque visual da região onde o item foi identificado.
 */
export default function DocumentView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [doc, setDoc] = useState(null);
  const [records, setRecords] = useState([]);
  const [imgUrl, setImgUrl] = useState(null);
  const [loadingImg, setLoadingImg] = useState(false);
  const [isPdf, setIsPdf] = useState(true);

  const page = Number(params.get('page') || 1);
  const recordId = params.get('record') || '';

  useEffect(() => {
    Promise.all([api(`/documents/${id}`), api(`/documents/${id}/records`)])
      .then(([d, r]) => {
        setDoc(d.document);
        setRecords(r.records);
        setIsPdf(d.document.type === 'pdf');
      })
      .catch((e) => notify(e.message, 'err'));
  }, [id]);

  useEffect(() => {
    if (!doc || !doc.file_available) { setImgUrl(null); return; }
    let revoked = false;
    setLoadingImg(true);
    const url = `/api/documents/${id}/pages/${page}/render?scale=2${recordId ? `&record=${recordId}` : ''}&token=${encodeURIComponent(authHeaders().Authorization?.slice(7) || '')}`;
    fetch(url).then((res) => {
      if (!res.ok) throw new Error('Não foi possível renderizar a página.');
      return res.blob();
    }).then((blob) => {
      if (revoked) return;
      const u = URL.createObjectURL(blob);
      setImgUrl(u);
    }).catch((e) => notify(e.message, 'err'))
      .finally(() => !revoked && setLoadingImg(false));
    return () => {
      revoked = true;
      setImgUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    };
  }, [id, page, recordId, doc?.file_available]);

  if (!doc) return <div className="center" style={{ padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  const rec = records.find((r) => r.id === recordId);
  const recOnPage = records.filter((r) => r.page === page);

  const goPage = (p, rec2 = recordId) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    if (rec2) next.set('record', rec2); else next.delete('record');
    setParams(next);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="link-btn" onClick={() => nav('/documents')}>Documentos</button>
          <h1>{doc.original_name}</h1>
          <p className="sub">
            Importação nº {doc.seq} · {doc.type === 'pdf' ? 'PDF' : 'Imagem'} · {fmtDate(doc.created_at)} ·{' '}
            {doc.record_count} registro(s) · {doc.page_count} página(s) · <StatusBadge status={doc.status} low={doc.low_confidence_count} />
          </p>
        </div>
        <div className="btn-row">
          <a className="btn secondary" href={downloadUrl(`/documents/${id}/file`)} target="_blank" rel="noreferrer">Abrir arquivo original</a>
          <a className="btn" href={downloadUrl(`/documents/${id}/file`, { download: 1 })}>Baixar original</a>
        </div>
      </div>

      {!doc.file_available ? (
        <div className="empty">
          <h3>Arquivo original indisponível</h3>
          <p>O arquivo deste documento não está mais disponível, mas os registros extraídos foram preservados.</p>
          <Link className="btn" to={`/database?document_id=${id}`}>Ver registros deste documento</Link>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
          <div>
            <div className="flex between mb">
              <div className="btn-row">
                <button className="btn sm secondary" disabled={page <= 1} onClick={() => goPage(page - 1)}>Página anterior</button>
                <span style={{ fontWeight: 700 }}>Página {page}{doc.page_count ? ` de ${doc.page_count}` : ''}</span>
                <button className="btn sm secondary" disabled={doc.page_count && page >= doc.page_count} onClick={() => goPage(page + 1)}>Próxima página</button>
              </div>
              {rec && (
                <span className="badge neutral">
                  Destacando: {rec.code || rec.name} — pág {rec.page}, tab {rec.table_no ?? '—'}, lin {rec.row_no ?? '—'}, col {rec.col_no ?? '—'}
                </span>
              )}
            </div>

            <div className="img-viewer">
              {loadingImg && <div className="spinner" style={{ margin: '60px auto' }} />}
              {imgUrl && <img src={imgUrl} alt={`Página ${page} do documento`} style={{ display: loadingImg ? 'none' : 'inline' }} onLoad={() => setLoadingImg(false)} />}
            </div>
            <p className="muted center" style={{ fontSize: '.83rem' }}>
              Página renderizada a partir do arquivo original preservado. O retângulo vermelho marca a região aproximada do item selecionado.
            </p>
          </div>

          <div>
            <div className="card">
              <h3>Registros desta página ({recOnPage.length})</h3>
              {recOnPage.length === 0 && <p className="muted">Nenhum registro extraído nesta página.</p>}
              {recOnPage.map((r) => (
                <div
                  key={r.id}
                  className="list-row"
                  style={{ cursor: 'pointer', borderColor: r.id === recordId ? 'var(--primary)' : undefined, borderWidth: r.id === recordId ? 2 : 1 }}
                  onClick={() => goPage(r.page || 1, r.id)}
                >
                  <div className="grow">
                    <div className="title">{r.code ? <span className="code-chip">{r.code}</span> : 's/ código'} {r.name || r.description || ''}</div>
                    <div className="sub">{fmtQty(r)} · tab {r.table_no ?? '—'} · lin {r.row_no ?? '—'} · col {r.col_no ?? '—'}</div>
                  </div>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <h3>Todos os registros ({records.length})</h3>
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {records.map((r) => (
                  <div key={r.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => goPage(r.page || 1, r.id)}>
                    <div className="grow">
                      <div className="title">{r.code || 's/ código'} — {r.name || r.description || '—'}</div>
                      <div className="sub">pág {r.page ?? '—'} · lin {r.row_no ?? '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
