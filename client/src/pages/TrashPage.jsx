import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtQty } from '../api.js';
import { useApp } from '../App.jsx';

export default function TrashPage() {
  const { notify } = useApp();
  const [data, setData] = useState({ records: [], documents: [], retention_days: 30 });

  const load = () => api('/trash').then(setData).catch((e) => notify(e.message, 'err'));
  useEffect(() => { load(); }, []);

  const act = async (fn, msg) => {
    try { await fn(); notify(msg); load(); } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Lixeira</h1>
          <p className="sub">
            Itens excluídos ficam aqui por {data.retention_days} dias antes da exclusão definitiva (configurável em Ajustes).
          </p>
        </div>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Esvaziar a lixeira? Esta ação é definitiva e remove todos os itens excluídos.')) {
              act(() => api('/trash/purge', { method: 'POST' }), 'Lixeira esvaziada.');
            }
          }}
        >
          Esvaziar lixeira
        </button>
      </div>

      <div className="section-title"><h2>Registros excluídos ({data.records.length})</h2></div>
      {data.records.length === 0 && <div className="empty"><p>Nenhum registro na lixeira.</p></div>}
      {data.records.map((r) => (
        <div className="list-row" key={r.id}>
          <div className="grow">
            <div className="title">{r.code ? <span className="code-chip">{r.code}</span> : 's/ código'} {r.name || r.description || '—'}</div>
            <div className="sub">
              {fmtQty(r)} · {r.doc_name || '—'} · excluído em {fmtDate(r.deleted_at)}
            </div>
          </div>
          <button className="btn sm success" onClick={() => act(() => api(`/records/${r.id}/restore`, { method: 'POST' }), 'Registro restaurado.')}>Restaurar</button>
          <button className="btn sm danger" onClick={() => {
            if (confirm('Excluir definitivamente este registro?')) {
              act(() => api(`/records/${r.id}`, { method: 'DELETE', query: { permanent: '1' } }), 'Registro excluído definitivamente.');
            }
          }}>Excluir definitivamente</button>
        </div>
      ))}

      <div className="section-title"><h2>Documentos excluídos ({data.documents.length})</h2></div>
      {data.documents.length === 0 && <div className="empty"><p>Nenhum documento na lixeira.</p></div>}
      {data.documents.map((d) => (
        <div className="list-row" key={d.id}>
          <div className="grow">
            <div className="title">{d.original_name}</div>
            <div className="sub">
              Importação nº {d.seq} · excluído em {fmtDate(d.deleted_at)} · {d.record_count} registro(s)
            </div>
          </div>
          <button className="btn sm success" onClick={() => act(() => api(`/documents/${d.id}/restore`, { method: 'POST' }), 'Documento restaurado com registros.')}>Restaurar</button>
          <button className="btn sm danger" onClick={() => {
            if (confirm('Excluir definitivamente o documento e seus registros?')) {
              act(() => api(`/documents/${d.id}`, { method: 'DELETE', query: { mode: 'with_records', permanent: '1' } }), 'Excluído definitivamente.');
            }
          }}>Excluir definitivamente</button>
        </div>
      ))}
    </div>
  );
}
