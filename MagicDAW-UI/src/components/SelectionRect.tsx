import React from 'react';

interface SelectionRectProps {
  rect: { x: number; y: number; width: number; height: number } | null;
}

export const SelectionRect: React.FC<SelectionRectProps> = React.memo(({ rect }) => {
  if (!rect || rect.width < 2 || rect.height < 2) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: '1px solid rgba(103, 232, 249, 0.5)',
        background: 'rgba(103, 232, 249, 0.06)',
        borderRadius: 2,
        pointerEvents: 'none',
        zIndex: 50,
        boxShadow: '0 0 8px rgba(103, 232, 249, 0.1)',
      }}
    />
  );
});
