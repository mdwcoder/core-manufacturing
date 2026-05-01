import { useState, useCallback } from 'react';

export function useToast(duration = 2500) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message) => {
    const id = Date.now();
    setToast({ message, id });
    setTimeout(() => setToast(t => t?.id === id ? null : t), duration);
  }, [duration]);

  const toastEl = toast ? (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      background: '#166534',
      border: '1px solid #22c55e40',
      borderRadius: 8,
      padding: '10px 18px',
      color: '#4ade80',
      fontSize: 13,
      fontWeight: 600,
      zIndex: 9999,
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      pointerEvents: 'none',
    }}>
      <span>✓</span>
      {toast.message}
    </div>
  ) : null;

  return [showToast, toastEl];
}
