import React, { useState } from 'react';

function EyeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.9 17.9A10.6 10.6 0 0112 20C5.5 20 1.5 12 1.5 12a19 19 0 015.2-6.1M9.9 4.3A10.9 10.9 0 0112 4c6.5 0 10.5 8 10.5 8a19.2 19.2 0 01-2.3 3.3M10 10a3 3 0 004.2 4.2" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

/** Campo de senha com botão de mostrar/ocultar (estilo formal). */
export default function PasswordField({ label, value, onChange, autoComplete, minLength, placeholder, id }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field" htmlFor={id}>{label}
      <div className="pw-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          title={visible ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </label>
  );
}

/** Seta discreta para botões de ação principal. */
export function ChevronIcon() {
  return (
    <svg className="btn-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
