import React, { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  separator?: false;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuEntry[];
}

interface ContextMenuContextValue {
  openMenu: (x: number, y: number, items: ContextMenuEntry[]) => void;
  closeMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue>({
  openMenu: () => {},
  closeMenu: () => {},
});

export const useContextMenu = () => useContext(ContextMenuContext);

// ── Menu Popup ───────────────────────────────────────────────────────────────

const MenuPopup: React.FC<{ state: ContextMenuState; onClose: () => void }> = React.memo(
  ({ state, onClose }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
      requestAnimationFrame(() => setVisible(true));
    }, []);

    // Adjust position to stay on-screen
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        el.style.left = `${state.x - rect.width}px`;
      }
      if (rect.bottom > window.innerHeight) {
        el.style.top = `${state.y - rect.height}px`;
      }
    }, [state.x, state.y]);

    // Close on outside click / escape
    useEffect(() => {
      const handleClick = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) {
          onClose();
        }
      };
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
      return () => {
        document.removeEventListener('mousedown', handleClick);
        document.removeEventListener('keydown', handleKey);
      };
    }, [onClose]);

    return (
      <div
        ref={ref}
        style={{
          position: 'fixed',
          left: state.x,
          top: state.y,
          zIndex: 10000,
          minWidth: 180,
          padding: '4px 0',
          borderRadius: 8,
          background: 'rgba(13, 21, 32, 0.92)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(103, 232, 249, 0.2)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(103, 232, 249, 0.06)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.95)',
          transformOrigin: 'top left',
          transition: 'opacity 0.12s ease, transform 0.12s ease',
        }}
      >
        {state.items.map((entry, i) => {
          if (entry.separator) {
            return (
              <div
                key={`sep-${i}`}
                style={{
                  height: 1,
                  margin: '4px 8px',
                  background: 'rgba(120, 200, 220, 0.12)',
                }}
              />
            );
          }
          const item = entry as ContextMenuItem;
          return (
            <button
              key={`${item.label}-${i}`}
              disabled={item.disabled}
              onClick={() => {
                item.action();
                onClose();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '5px 12px',
                border: 'none',
                background: 'transparent',
                color: item.disabled ? 'var(--text-muted)' : 'var(--text)',
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                cursor: item.disabled ? 'default' : 'pointer',
                textAlign: 'left',
                letterSpacing: '0.02em',
                borderRadius: 0,
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) {
                  (e.currentTarget as HTMLElement).style.background =
                    'rgba(103, 232, 249, 0.08)';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <span style={{ color: 'var(--text-muted)', fontSize: 9, marginLeft: 16 }}>
                  {item.shortcut}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  },
);

// ── Provider ─────────────────────────────────────────────────────────────────

export const ContextMenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);

  const openMenu = useCallback((x: number, y: number, items: ContextMenuEntry[]) => {
    setMenuState({ x, y, items });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  // Suppress native context menu when our menu is open
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // We handle this via onContextMenu on individual elements
    };
    return () => {};
  }, []);

  return (
    <ContextMenuContext.Provider value={{ openMenu, closeMenu }}>
      {children}
      {menuState && <MenuPopup state={menuState} onClose={closeMenu} />}
    </ContextMenuContext.Provider>
  );
};
