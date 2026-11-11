import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, fmtDate, fmtQty } from '../api.js';
import { useApp } from '../App.jsx';

/**
 * Revisão dos dados extraídos antes da confirmação.
 * Registros com baixa confiança ficam destacados. Nada é considerado confirmado sem o usuário.
 */
export default function ReviewPage() {
  const { docId } = useParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [doc, setDoc] = useState(null);
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [d, recs] = await Promise.all([api(`/documents/${docId}`), api(`/documents/${docId}/records`)]);
    setDoc(d.document);
    setRecords(recs.records.map((r) => ({ ...r, _edit: false })));
  };

  useEffect(() => {
    load().catch((e) => notify(e.message, 'err'));
    const iv = setInterval(() => {
      api(`/documents/${docId}`).then((d) => {
        setDoc(d.document);
        if (d.document.status === 'processando' || d.document.status === 'pendente') load();
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(iv);
  }, [docId]);

  const setField = (id, field, value) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const saveRow = async (r) => {
    try {
      await api(`/records/${r.id}`, {
        method: 'PUT',
        body: {
          code: r.code, name: r.name, description: r.description,
          quantity: r.quantity_text || r.quantity, unit: r.unit, reference: r.reference
        }
      });
      setRecords((rs) => rs.map((x) => (x.id === r.id ? { ...x, _edit: false, needs_review: 0 } : x)));
      notify('Linha atualizada.');
    } catch (e) { notify(e.message, 'err'); }
  };

  const removeRow = async (r) => {
    if (!confirm('Excluir esta linha da importação?')) return;
    await api(`/records/${r.id}`, { method: 'DELETE', query: { permanent: '1' } });
    setRecords((rs) => rs.filter((x) => x.id !== r.id));
  };

  const confirmAll = async () => {
    setBusy(true);
    try {
      for (const r of records.filter((x) => x.needs_review)) {
        await api(`/records/${r.id}`, { method: 'PUT', body: { code: r.code, name: r.name, description: r.description, quantity: r.quantity, unit: r.unit, reference: r.reference } });
      }
      notify('Importação confirmada. Os registros estão no banco de dados.');
      nav('/database');
    } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); }
  };

  const cancelAll = async () => {
    if (!confirm('Cancelar esta importação? Os registros extraídos e o documento serão excluídos definitivamente.')) return;
    await api(`/documents/${docId}`, { method: 'DELETE', query: { mode: 'with_records', permanent: '1' } });
    notify('Importação cancelada.');
    nav('/import');
  };

  if (!doc) return <div className="center" style={{ padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  const lowCount = records.filter((r) => r.needs_review).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="link-btn" onClick={() => nav('/import')}>Importações</button>
          <h1>Revisão dos dados extraídos</h1>
          <p className="sub">
            {doc.original_name} · importação nº {doc.seq} · {fmtDate(doc.created_at)} · {records.length} registro(s)
          </p>
        </div>
        <div className="btn-row">
          <button className="btn secondary" onClick={cancelAll}>Cancelar importação</button>
          <button className="btn success" onClick={confirmAll} disabled={busy || records.length === 0}>
            {busy ? 'Salvando…' : 'Confirmar importação'}
          </button>
        </div>
      </div>

      {(doc.status === 'processando' || doc.status === 'pendente') && (
        <div className="card center">
          <div className="spinner" style={{ margin: '0 auto 10px' }} />
          <p>Extraindo informações do documento…</p>
        </div>
      )}

      {doc.status === 'erro' && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <h3 style={{ color: 'var(--danger)' }}>Falha no processamento</h3>
          <p>{doc.error}</p>
          <button className="btn warn" onClick={() => api(`/documents/${docId}/reprocess`, { method: 'POST' }).then(load)}>Tentar novamente</button>
        </div>
      )}

      {doc.status === 'revisao' && (
        <div className="card" style={{ borderColor: 'var(--warn)', background: '#fffbeb' }}>
          <b>{lowCount} registro(s) com baixa confiança</b>
          <p className="muted">As linhas destacadas em amarelo podem conter erros de leitura. Confira e corrija antes de confirmar. Informações ausentes não foram inventadas — campos vazios indicam que o dado não foi identificado no documento.</p>
        </div>
      )}

      {records.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th><th>Nome</th><th>Descrição</th><th>Qtd.</th><th>Un.</th>
                <th>Ref.</th><th>Pág.</th><th>Tab.</th><th>Lin.</th><th>Col.</th><th>Conf.</th><th></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className={r.needs_review ? 'low-confidence' : ''}>
                  <td className="cell-small"><input value={r.code || ''} onChange={(e) => setField(r.id, 'code', e.target.value)} placeholder="—" /></td>
                  <td><input value={r.name || ''} onChange={(e) => setField(r.id, 'name', e.target.value)} placeholder="—" /></td>
                  <td><input value={r.description || ''} onChange={(e) => setField(r.id, 'description', e.target.value)} placeholder="—" /></td>
                  <td className="cell-small"><input value={r.quantity_text ?? (r.quantity ?? '')} onChange={(e) => setField(r.id, 'quantity_text', e.target.value)} placeholder="—" /></td>
                  <td className="cell-small"><input value={r.unit || ''} onChange={(e) => setField(r.id, 'unit', e.target.value)} placeholder="—" /></td>
                  <td className="cell-small"><input value={r.reference || ''} onChange={(e) => setField(r.id, 'reference', e.target.value)} placeholder="—" /></td>
                  <td>{r.page ?? '—'}</td>
                  <td>{r.table_no ?? '—'}</td>
                  <td>{r.row_no ?? '—'}</td>
                  <td>{r.col_no ?? '—'}</td>
                  <td>{Math.round((r.confidence ?? 1) * 100)}%</td>
                  <td>
                    <div className="btn-row">
                      <button className="btn sm success" onClick={() => saveRow(r)} title="Salvar linha">Salvar</button>
                      <button className="btn sm danger" onClick={() => removeRow(r)} title="Excluir linha">Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doc.status === 'pronto' && records.length === 0 && (
        <div className="empty">
          <h3>Nenhum item identificado no documento</h3>
          <p>O arquivo foi preservado, mas não foi possível identificar produtos ou códigos nele.</p>
        </div>
      )}
    </div>
  );
}
