import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, fmtDate, fmtQty, authHeaders } from '../api.js';
import { useApp } from '../App.jsx';

export default function ImportPage() {
  const nav = useNavigate();
  const { notify } = useApp();
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [docs, setDocs] = useState([]);
  const [uploadMode, setUploadMode] = useState('multipart');
  const fileRef = useRef(null);
  const camRef = useRef(null);

  const load = () => api('/documents').then((r) => setDocs(r.documents)).catch(() => {});
  useEffect(() => {
    api('/health').then((h) => setUploadMode(h.upload_mode || 'multipart')).catch(() => {});
    load();
    const iv = setInterval(() => {
      api('/documents').then((r) => setDocs(r.documents)).catch(() => {});
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  const uploadChunked = async (file) => {
    setProgress(`Enviando ${file.name}…`);
    const start = await api('/documents/uploads/start', { method: 'POST', body: { original_name: file.name } });
    const chunkSize = start.chunk_size || 2 * 1024 * 1024;
    const total = Math.ceil(file.size / chunkSize) || 1;
    for (let i = 0; i < total; i++) {
      const slice = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size));
      const res = await fetch(`/api/documents/uploads/${start.upload_id}/chunk/${i}`, {
        method: 'PUT',
        headers: { ...authHeaders() },
        body: slice
      });
      if (!res.ok) throw new Error(`Falha no envio do pedaço ${i + 1}`);
      setProgress(`Enviando ${file.name} — ${Math.round(((i + 1) / total) * 100)}%`);
    }
    const done = await api(`/documents/uploads/${start.upload_id}/complete`, {
      method: 'POST',
      body: { original_name: file.name, mime_type: file.type || 'application/octet-stream' }
    });
    setProgress(`Processando ${file.name}…`);
    await api(`/documents/${done.id}/process`, { method: 'POST' }).catch(() => {});
    return done;
  };

  const upload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      if (uploadMode === 'chunked') {
        for (const f of files) await uploadChunked(f);
        notify(`${files.length} documento(s) enviado(s) e processado(s).`);
      } else {
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        const r = await api('/documents/upload', { method: 'POST', formData: fd });
        notify(`${r.documents.length} documento(s) enviado(s). Processando…`);
      }
      load();
    } catch (e) {
      notify(e.message, 'err');
    } finally {
      setUploading(false);
      setProgress('');
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    upload(e.dataTransfer.files);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Importar documentos</h1>
          <p className="sub">PDF, JPG, PNG e fotografias. O processamento é automático e o arquivo original é preservado.</p>
        </div>
      </div>

      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <h3>＋ Arraste arquivos aqui ou toque para selecionar</h3>
        <p>PDF · JPG · JPEG · PNG · WebP · TIFF · HEIC — até 200 MB por arquivo</p>
        <div className="btn-row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
            Selecionar arquivos
          </button>
          <button type="button" className="btn secondary" onClick={(e) => { e.stopPropagation(); camRef.current?.click(); }}>
            📷 Fotografar documento
          </button>
        </div>
        <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tif,.tiff,.heic,.avif,application/pdf,image/*" hidden onChange={(e) => upload(e.target.files)} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files)} />
      </div>

      {uploading && <p className="center mt">{progress || 'Enviando arquivos…'}</p>}

      <div className="section-title">
        <h2>Documentos recentes</h2>
        <Link className="btn sm secondary" to="/documents">Gerenciar todos →</Link>
      </div>

      {docs.filter((d) => !d.deleted_at).slice(0, 8).map((d) => (
        <div className="list-row" key={d.id}>
          <div className="grow">
            <div className="title">{d.original_name}</div>
            <div className="sub">
              Importação nº {d.seq} · {fmtDate(d.created_at)} · {d.record_count} registro(s) · {d.page_count} página(s)
            </div>
          </div>
          <StatusBadge status={d.status} low={d.low_confidence_count} />
          {d.status === 'pronto' || d.status === 'revisao' ? (
            <Link className="btn sm" to={`/import/${d.id}/review`}>
              {d.status === 'revisao' ? '⚠ Revisar dados' : 'Ver dados'}
            </Link>
          ) : d.status === 'erro' ? (
            <button className="btn sm warn" onClick={() => api(`/documents/${d.id}/reprocess`, { method: 'POST' }).then(load)}>Reprocessar</button>
          ) : (
            <span className="muted">processando…</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatusBadge({ status, low }) {
  const map = {
    pendente: ['gray', 'na fila'],
    processando: ['neutral', 'processando'],
    pronto: ['conferido', 'pronto'],
    revisao: ['revisar', `revisar dados${low ? ` (${low})` : ''}`],
    erro: ['divergente', 'erro']
  };
  const [cls, label] = map[status] || ['gray', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
