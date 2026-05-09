import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

export function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  function handleAction(value) {
    state?.resolve(value);
    setState(null);
  }

  useEffect(() => {
    if (!state) return;
    function onKey(e) {
      if (e.key === 'Escape') handleAction(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const modal = state ? createPortal(
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
        backdropFilter: 'blur(3px)',
      }}
      onClick={() => handleAction(null)}
    >
      <div
        style={{
          background: '#1e2433',
          border: '1px solid #334155',
          borderRadius: 10,
          padding: '24px 28px',
          maxWidth: 460,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          animation: 'modalIn 0.15s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {state.title && (
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>
            {state.title}
          </div>
        )}
        {state.message && (
          <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.65, marginBottom: 24, whiteSpace: 'pre-line' }}>
            {state.message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleAction(null)}
            style={{
              background: '#1f2937', color: '#9ca3af',
              border: '1px solid #374151', borderRadius: 6,
              padding: '8px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
            }}
          >
            {state.cancelLabel || 'Cancel'}
          </button>

          {state.actions
            ? state.actions.map(action => (
              <button
                key={action.value}
                onClick={() => handleAction(action.value)}
                style={{
                  background: action.variant === 'danger'  ? '#7f1d1d'
                             : action.variant === 'success' ? '#166534'
                             : '#1e40af',
                  color: action.variant === 'danger'  ? '#fca5a5'
                       : action.variant === 'success' ? '#4ade80'
                       : '#fff',
                  border: 'none', borderRadius: 6,
                  padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {action.label}
              </button>
            ))
            : (
              <button
                onClick={() => handleAction(true)}
                style={{
                  background: state.danger ? '#7f1d1d' : '#1e40af',
                  color: state.danger ? '#fca5a5' : '#fff',
                  border: 'none', borderRadius: 6,
                  padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {state.confirmLabel || 'Confirm'}
              </button>
            )
          }
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return [confirm, modal];
}
