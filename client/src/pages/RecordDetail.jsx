import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, fmtQty, fmtDate, downloadUrl, queueOfflineOp, getToken } from '../api.js';
import { useApp } from '../App.jsx';

const STATUSES = [
  { v: 'pendente', label: 'Pendente', cls: 'warn' },
  { v: 'conferido', label: 'Conferido', cls: 'success' },
  { v: 'divergente', label: 'Divergente', cls: 'danger' },
  { v: 'revisar', label: 'Revisar', cls: 'ghost' }
];

export default function RecordDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useApp();
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => api(`/records/${id}`).then((r) => {
    setData(r);
    setForm({
      code: r.record.code || '', name: r.record.name || '', description: r.record.description || '',
      reference: r.record.reference || '', quantity: r.record.quantity ?? '', quantity_text: r.record.quantity_text || '',
      unit: r.record.unit || '', category: r.record.category || ''
    });
  }).catch((e) => notify(e.message, 'err'));

  useEffect(() => { load(); }, [id]);

  if (!data) return <div className="center" style={{ padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  const r = data.record;

  const setStatus = async (status) => {
    try {
      if (!navigator.onLine) {
        queueOfflineOp({ type: 'status', record_id: id, status });
        setData({ ...data, record: { ...r, status } });
        notify('Sem conexão — alteração salva para sincronizar depois.');
        return;
      }
      await api(`/records/${id}/status`, { method: 'POST', body: { status } });
      setData({ ...data, record: { ...r, status, checked_at: status === 'conferido' ? new Date().toISOString() : null } });
      notify(`Status: ${status}`);
    } catch (e) { notify(e.message, 'err'); }
  };

  const toggleFav = async () => {
    const res = await api(`/records/${id}/favorite`, { method: 'POST' });
    setData({ ...data, record: { ...r, favorite: res.favorite } });
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await api(`/records/${id}`, { method: 'PUT', body: form });
      setEdit(false);
      await load();
      notify('Registro atualizado.');
    } catch (e) { notify(e.message, 'err'); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm('Excluir este registro? Ele irá para a lixeira e poderá ser restaurado.')) return;
    await api(`/records/${id}`, { method: 'DELETE' });
    notify('Registro enviado à lixeira.');
    nav(-1);
  };

  const doc = r.document;
  const openInDoc = () => {
    if (!doc || !doc.file_available) { notify('O documento de origem não está mais disponível.', 'err'); return; }
    nav(`/documents/${doc.id}?record=${r.id}&page=${r.page || 1}`);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="link-btn" onClick={() => nav(-1)}>← Voltar</button>
          <h1 style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {r.code ? <span className="code-chip" style={{ fontSize: '1.1rem' }}>{r.code}</span> : <span className="badge gray">sem código</span>}
            <span>{r.name || r.description || 'Registro'}</span>
            <button className="btn sm secondary" onClick={toggleFav}>{r.favorite ? '⭐ Favorito' : '☆ Favoritar'}</button>
          </h1>
          <p className="sub">
            <span className={`badge ${r.status}`}>{r.status}</span>
            {' '}{r.checked_at && <>conferido em {fmtDate(r.checked_at)}</>}
            {r.needs_review ? <span className="badge revisar" style={{ marginLeft: 8 }}>⚠ baixa confiança — revise</span> : null}
          </p>
        </div>
        <div className="btn-row">
          {!edit && <button className="btn secondary" onClick={() => setEdit(true)}>Editar</button>}
          <button className="btn danger secondary" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={remove}>Excluir</button>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Informações do produto</h2>
          {edit ? (
            <div>
              {['code', 'name', 'description', 'reference', 'quantity', 'unit', 'category'].map((f) => (
                <label className="field" key={f}>
                  {{ code: 'Código', name: 'Nome', description: 'Descrição', reference: 'Referência', quantity: 'Quantidade', unit: 'Unidade', category: 'Categoria' }[f]}
                  <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
                </label>
              ))}
              <div className="btn-row">
                <button className="btn" onClick={saveEdit} disabled={busy}>Salvar</button>
                <button className="btn secondary" onClick={() => setEdit(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <dl className="kv">
              <dt>Código</dt><dd className="mono">{r.code || '—'}</dd>
              <dt>Nome</dt><dd>{r.name || '—'}</dd>
              <dt>Descrição</dt><dd>{r.description || '—'}</dd>
              <dt>Referência</dt><dd>{r.reference || '—'}</dd>
              <dt>Quantidade</dt><dd><b>{fmtQty(r)}</b> {r.quantity_text && r.quantity == null && `(informado: ${r.quantity_text})`}</dd>
              <dt>Unidade</dt><dd>{r.unit || '—'}</dd>
              <dt>Categoria</dt><dd>{r.category || '—'}</dd>
              <dt>Confiança</dt><dd>{Math.round((r.confidence ?? 1) * 100)}%</dd>
              {r.extra && Object.entries(JSON.parse(r.extra)).map(([k, v]) => (
                <React.Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></React.Fragment>
              ))}
            </dl>
          )}
        </div>

        <div className="card">
          <h2>Localização no documento</h2>
          <dl className="kv">
            <dt>Documento</dt><dd>{doc ? doc.original_name : '—'}</dd>
            <dt>Nº da importação</dt><dd>{doc ? `PDF ${doc.seq} (importação nº ${doc.seq})` : '—'}</dd>
            <dt>Página</dt><dd>{r.page ?? '—'}</dd>
            <dt>Tabela</dt><dd>{r.table_no ?? '—'}</dd>
            <dt>Linha</dt><dd>{r.row_no ?? '—'}</dd>
            <dt>Coluna</dt><dd>{r.col_no ?? '—'}</dd>
            <dt>Posição (aprox.)</dt><dd className="mono">{r.pos_x != null ? `x:${Math.round(r.pos_x)} y:${Math.round(r.pos_y)} larg:${Math.round(r.pos_w)} alt:${Math.round(r.pos_h)}` : '—'}</dd>
            <dt>Importado em</dt><dd>{fmtDate(r.created_at)}</dd>
          </dl>
          <div className="btn-row mt">
            <button className="btn" onClick={openInDoc} disabled={!doc || !doc.file_available}>Abrir no documento na página {r.page || 1}</button>
            {doc && <a className="btn secondary" href={downloadUrl(`/documents/${doc.id}/file`, { download: 1 })}>Baixar original</a>}
          </div>
          {doc && !doc.file_available && <p className="mt" style={{ color: 'var(--warn)', fontWeight: 600 }}>⚠ O documento de origem não está mais disponível. Os dados do registro foram preservados.</p>}
          {r.snippet && (
            <>
              <h3 className="mt">Trecho original utilizado</h3>
              <div className="snippet">{r.snippet}</div>
            </>
          )}
          {r.pos_x == null && <p className="muted mt">Localização aproximada — coordenadas não disponíveis.</p>}
        </div>
      </div>

      <div className="card">
        <h2>Conferência rápida</h2>
        <div className="check-btns">
          {STATUSES.map((s) => (
            <button key={s.v} className={`btn sm ${s.cls} ${r.status === s.v ? 'active' : 'secondary'}`} onClick={() => setStatus(s.v)}>
              {s.label}
            </button>
          ))}
          <Link className="btn sm ghost" to="/conference">Ir para sessões de conferência →</Link>
        </div>
      </div>

      {data.occurrences.length > 1 && (
        <div className="card">
          <h2>Todas as ocorrências deste código ({data.occurrences.length})</h2>
          <p className="muted">O mesmo código pode existir em vários documentos. Nada é mesclado — cada ocorrência é preservada.</p>
          {data.occurrences.map((o) => (
            <div className="list-row" key={o.id} style={{ cursor: o.id === r.id ? 'default' : 'pointer' }} onClick={() => o.id !== r.id && nav(`/records/${o.id}`)}>
              <div className="grow">
                <div className="title">{o.document ? o.document.original_name : 'Documento indisponível'}</div>
                <div className="sub">
                  {o.quantity_text || o.quantity != null ? `Qtd: ${fmtQty(o)}` : 'Sem quantidade'} ·
                  Página {o.page ?? '—'} · Tabela {o.table_no ?? '—'} · Linha {o.row_no ?? '—'} · Coluna {o.col_no ?? '—'}
                </div>
              </div>
              <span className={`badge ${o.status}`}>{o.status}</span>
              {o.id === r.id && <span className="badge neutral">atual</span>}
            </div>
          ))}
        </div>
      )}

      {data.history.length > 0 && (
        <div className="card">
          <h2>Histórico de alterações</h2>
          <div className="timeline">
            {data.history.map((h) => (
              <div className="item" key={h.id}>
                <div className="t">{fmtDate(h.created_at)} · {h.action}</div>
                {h.old_values && <div className="muted" style={{ fontSize: '.85rem' }}>Antes: {JSON.stringify(h.old_values)}</div>}
                {h.new_values && <div className="muted" style={{ fontSize: '.85rem' }}>Depois: {JSON.stringify(h.new_values)}</div>}
                {h.detail && <div style={{ fontSize: '.88rem' }}>{h.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
