import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, downloadUrl } from '../api.js';
import { useApp } from '../App.jsx';
import { StatusBadge } from './ImportPage.jsx';

export default function DocumentsPage() {
  const nav = useNavigate();
  const { notify } = useApp();
  const [docs, setDocs] = useState([]);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState(null);

  const load = () => api('/documents', { query: { q, include_archived: showArchived ? '0' : '0' } }).then((r) => setDocs(r.documents)).catch(() => {});
  useEffect(() => { load(); }, [q, showArchived]);

  const act = async (fn, msg) => {
    try { await fn(); notify(msg); load(); } catch (e) { notify(e.message, 'err'); }
  };

  const doDelete = async (mode) => {
    await act(() => api(`/documents/${deleteDoc.id}`, { method: 'DELETE', query: { mode } }),
      mode === 'with_records' ? 'Documento e registros enviados à lixeira.' : 'Arquivo excluído — registros mantidos.');
    setDeleteDoc(null);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Documentos</h1>
          <p className="sub">Todos os arquivos importados são preservados em sua versão original.</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to="/import">＋ Importar</Link>
          <Link className="btn sm secondary" to="/trash">Lixeira</Link>
        </div>
      </div>

      <div className="card">
        <div className="filters">
          <label className="field" style={{ maxWidth: 340 }}>Pesquisar documento
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome do arquivo…" />
          </label>
          <button className={`pill-btn ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Ocultando arquivados' : 'Mostrar arquivados'}
          </button>
        </div>
      </div>

      {docs.length === 0 && <div className="empty"><h3>Nenhum documento</h3><p>Importe PDFs ou imagens para começar.</p><Link className="btn" to="/import">Importar</Link></div>}

      {docs.map((d) => (
        <div className="list-row" key={d.id}>
          <div className="grow">
            <div className="title">
              {d.original_name} {d.archived ? <span className="badge gray">arquivado</span> : null}
            </div>
            <div className="sub">
              {d.type === 'pdf' ? 'PDF' : 'Imagem'} · importação nº {d.seq} · {fmtDate(d.created_at)} ·{' '}
              {d.record_count} registro(s) · {d.page_count} página(s) · {(d.size / 1024).toFixed(0)} KB
            </div>
          </div>
          <StatusBadge status={d.status} low={d.low_confidence_count} />
          <div className="btn-row">
            <button className="btn sm" onClick={() => nav(`/documents/${d.id}`)}>Abrir</button>
            <a className="btn sm secondary" href={downloadUrl(`/documents/${d.id}/file`, { download: 1 })}>Baixar</a>
            <button className="btn sm secondary" onClick={() => {
              const name = prompt('Novo nome do documento:', d.original_name);
              if (name) act(() => api(`/documents/${d.id}`, { method: 'PUT', body: { original_name: name } }), 'Renomeado.');
            }}>Renomear</button>
            <button className="btn sm secondary" onClick={() =>
              act(() => api(`/documents/${d.id}/${d.archived ? 'restore-archive' : 'archive'}`, { method: 'POST' }), d.archived ? 'Restaurado.' : 'Arquivado.')
            }>{d.archived ? 'Restaurar' : 'Arquivar'}</button>
            <button className="btn sm secondary" onClick={() =>
              act(() => api(`/documents/${d.id}/reprocess`, { method: 'POST' }), 'Reprocessamento iniciado.')
            }>Reprocessar</button>
            <button className="btn sm danger" onClick={() => setDeleteDoc(d)}>Excluir</button>
          </div>
        </div>
      ))}

      {deleteDoc && (
        <div className="modal-backdrop" onClick={() => setDeleteDoc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir documento</h2>
            <p>Como deseja excluir <b>{deleteDoc.original_name}</b>?</p>
            <div className="grid mt">
              <button className="btn danger" onClick={() => doDelete('with_records')}>
                Excluir documento e seus {deleteDoc.record_count} registro(s)
              </button>
              <button className="btn warn" onClick={() => doDelete('keep_records')}>
                Excluir somente o arquivo, mantendo os registros
              </button>
              <button className="btn secondary" onClick={() => setDeleteDoc(null)}>Cancelar</button>
            </div>
            <p className="muted mt" style={{ fontSize: '.83rem' }}>
              A exclusão envia os itens para a lixeira por {30} dias (configurável em Ajustes), permitindo recuperação.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
