'use client';

/* Shared file dropzone (student send + teacher-folder submit).
 *
 * The native <input type="file"> covers the whole box as a transparent overlay,
 * so EVERY tap lands directly on the real control — no programmatic .click()
 * anywhere in the activation path (some hardened browsers swallow synthetic
 * activation while native taps always work). Drag & drop is handled on the
 * container (drop bubbles up from the input; preventDefault also cancels the
 * input's native drop-autofill, so each drop is counted exactly once).
 */

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function FileDropzone({ inputId, onPick }: { inputId: string; onPick: (files: File[]) => void }) {
  const { t } = useT();
  const [dragOver, setDragOver] = useState(false);
  const nodeRef = useRef<HTMLInputElement | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const handleNativeChange = useCallback(() => {
    const el = nodeRef.current;
    if (!el) return;
    const fl = el.files;
    if (fl && fl.length > 0) onPickRef.current(Array.from(fl));
    el.value = '';
  }, []);

  const bindInput = useCallback(
    (el: HTMLInputElement | null) => {
      nodeRef.current = el;
      if (!el || (el as unknown as { _bound?: boolean })._bound) return;
      (el as unknown as { _bound?: boolean })._bound = true;
      el.addEventListener('change', handleNativeChange);
    },
    [handleNativeChange]
  );

  return (
    <div
      className={`drop${dragOver ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) onPickRef.current(Array.from(e.dataTransfer.files));
      }}
    >
      <UploadCloud size={26} />
      <div style={{ fontWeight: 700, marginTop: 6 }}>{t('dragDrop')}</div>
      <div className="hint small" style={{ marginTop: 2 }}>
        {t('dragHintFallback')}
      </div>
      <span className="btn btn-sm mt" aria-hidden>
        {t('chooseFiles')}
      </span>
      <input
        id={inputId}
        ref={bindInput}
        type="file"
        multiple
        className="file-overlay"
        aria-label={t('uploadFiles')}
      />
    </div>
  );
}
