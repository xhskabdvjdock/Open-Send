'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { useT } from '@/lib/i18n';

// In-app replacement for window.confirm(): monochrome, RTL-aware, promise-based.
interface ConfirmOpts {
  title: string;
  message: string;
  okLabel?: string;
  danger?: boolean;
}

export function useConfirm(): { dialog: React.ReactNode; ask: (o: ConfirmOpts) => Promise<boolean> } {
  const { t } = useT();
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);

  const ask = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    []
  );

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        state.resolve(false);
        setState(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  const dialog = state ? (
    <div className="modal-overlay" onClick={() => close(false)}>
      <div className="modal-card" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>
          <AlertTriangle size={18} style={{ verticalAlign: -3 }} /> {state.title}
        </h3>
        <p className="muted">{state.message}</p>
        <div className="row mt">
          <button
            type="button"
            autoFocus
            className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => close(true)}
          >
            {state.okLabel || t('dlgConfirm')}
          </button>
          <button type="button" className="btn" onClick={() => close(false)}>
            {t('dlgCancel')}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { dialog, ask };
}

// In-app replacement for window.prompt(): returns the typed value or null.
interface PromptOpts {
  title: string;
  message?: string;
  placeholder?: string;
  okLabel?: string;
  minLength?: number;
  isPassword?: boolean;
}

export function usePrompt(): { dialog: React.ReactNode; ask: (o: PromptOpts) => Promise<string | null> } {
  const { t } = useT();
  const [state, setState] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null);

  const ask = useCallback(
    (opts: PromptOpts) => new Promise<string | null>((resolve) => setState({ ...opts, resolve })),
    []
  );

  const close = (v: string | null) => {
    state?.resolve(v);
    setState(null);
  };

  const dialog = state ? (
    <PromptForm
      key={`${state.title}-${Date.now()}`}
      opts={state}
      cancelLabel={t('dlgCancel')}
      onCancel={() => close(null)}
      onOk={(v) => close(v)}
    />
  ) : null;

  return { dialog, ask };
}

function PromptForm({
  opts,
  cancelLabel,
  onCancel,
  onOk,
}: {
  opts: PromptOpts;
  cancelLabel: string;
  onCancel: () => void;
  onOk: (v: string) => void;
}) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const { t } = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((opts.minLength || 0) > 0 && value.length < (opts.minLength || 0)) {
      setErr(t('errPwShort'));
      return;
    }
    onOk(value);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>
          <KeyRound size={18} style={{ verticalAlign: -3 }} /> {opts.title}
        </h3>
        {opts.message && <p className="muted small">{opts.message}</p>}
        {err && <p className="error-box">{err}</p>}
        <form onSubmit={submit}>
          <input
            className="input"
            autoFocus
            type={opts.isPassword ? 'password' : 'text'}
            placeholder={opts.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            dir="ltr"
          />
          <div className="row mt">
            <button type="submit" className="btn btn-primary">
              {opts.okLabel || t('dlgConfirm')}
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
