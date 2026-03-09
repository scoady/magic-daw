import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';

// ── Toast Types ──────────────────────────────────────────────────────────────

interface ToastItem {
  id: number;
  message: string;
  type?: 'info' | 'success' | 'error';
  fadingOut?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export const useToast = () => useContext(ToastContext);

// ── Single Toast ─────────────────────────────────────────────────────────────

const ToastCard: React.FC<{ item: ToastItem; onRemove: (id: number) => void }> = React.memo(
  ({ item, onRemove }) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
      // Trigger entrance animation
      requestAnimationFrame(() => setVisible(true));
      const fadeTimer = setTimeout(() => setVisible(false), 1200);
      const removeTimer = setTimeout(() => onRemove(item.id), 1500);
      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }, [item.id, onRemove]);

    const borderColor =
      item.type === 'error'
        ? 'rgba(239, 68, 68, 0.5)'
        : item.type === 'success'
          ? 'rgba(52, 211, 153, 0.5)'
          : 'rgba(103, 232, 249, 0.4)';

    const glowColor =
      item.type === 'error'
        ? 'rgba(239, 68, 68, 0.15)'
        : item.type === 'success'
          ? 'rgba(52, 211, 153, 0.15)'
          : 'rgba(103, 232, 249, 0.1)';

    return (
      <div
        style={{
          padding: '6px 14px',
          borderRadius: 8,
          background: 'rgba(13, 21, 32, 0.85)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${borderColor}`,
          boxShadow: `0 0 20px ${glowColor}, 0 4px 12px rgba(0,0,0,0.4)`,
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text)',
          letterSpacing: '0.03em',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.95)',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {item.message}
      </div>
    );
  },
);

// ── Toast Container + Provider ───────────────────────────────────────────────

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]); // keep max 5
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast stack */}
      <div
        style={{
          position: 'fixed',
          bottom: 48,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
