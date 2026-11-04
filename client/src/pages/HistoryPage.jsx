import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';

const ACTION_LABEL = {
  registro_editado: 'Registro editado',
  registro_excluido: 'Registro excluído',
  registro_excluido_definitivo: 'Registro excluído definitivamente',
  registro_restaurado: 'Registro restaurado',
  registro_arquivado: 'Registro arquivado',
  status_conferencia: 'Status de conferência',
  documento_importado: 'Documento importado',
  documento_processado: 'Documento processado',
  documento_erro: 'Erro no processamento',
  documento_excluido: 'Documento excluído',
  documento_excluido_definitivo: 'Documento excluído definitivamente',
  documento_restaurado: 'Documento restaurado',
  documento_restaurado_lixeira: 'Documento restaurado da lixeira',
  documento_renomeado: 'Documento renomeado',
  documento_arquivado: 'Documento arquivado',
  sessao_criada: 'Sessão de conferência criada',
  sessao_excluida: 'Sessão excluída',
  usuario_criado: 'Usuário criado',
  senha_alterada: 'Senha alterada',
  configuracoes_alteradas: 'Configurações alteradas',
  lixeira_esvaziada: 'Lixeira esvaziada'
};

export default function HistoryPage() {
  const [history, setHistory] = useState([]);
  const [recordId, setRecordId] = useState('');
  const [docId, setDocId] = useState('');

  const load = () => api('/history', { query: { record_id: recordId, document_id: docId, limit: 200 } }).then((r) => setHistory(r.history)).catch(() => {});
  useEffect(() => { load(); }, [recordId, docId]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Histórico</h1>
          <p className="sub">Rastreabilidade completa: dados anteriores, atualizados, data, hora e tipo de alteração.</p>
        </div>
      </div>

      <div className="card">
        <div className="filters">
          <label className="field">Filtrar por registro (ID)
            <input value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="uuid do registro" />
          </label>
          <label className="field">Filtrar por documento (ID)
            <input value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="número do documento" />
          </label>
          <button className="pill-btn" onClick={() => { setRecordId(''); setDocId(''); }}>Limpar</button>
        </div>
      </div>

      {history.length === 0 && <div className="empty"><h3>Nenhum evento</h3><p>As alterações aparecerão aqui.</p></div>}

      <div className="card">
        <div className="timeline">
          {history.map((h) => (
            <div className="item" key={h.id}>
              <div className="t">{fmtDate(h.created_at)}</div>
              <div style={{ fontWeight: 700 }}>
                {ACTION_LABEL[h.action] || h.action}
                {h.record_id && <> · <Link to={`/records/${h.record_id}`}>ver registro</Link></>}
              </div>
              {h.detail && <div className="muted" style={{ fontSize: '.88rem' }}>{h.detail}</div>}
              {h.old_values && (
                <details>
                  <summary className="muted" style={{ cursor: 'pointer', fontSize: '.85rem' }}>Dados anteriores</summary>
                  <div className="snippet">{JSON.stringify(h.old_values, null, 2)}</div>
                </details>
              )}
              {h.new_values && (
                <details>
                  <summary className="muted" style={{ cursor: 'pointer', fontSize: '.85rem' }}>Dados atualizados</summary>
                  <div className="snippet">{JSON.stringify(h.new_values, null, 2)}</div>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
