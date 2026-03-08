import React from 'react';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  glow?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className = '',
  glow,
  style,
  onClick,
}) => {
  return (
    <div
      className={`glass-panel ${className}`}
      style={{
        ...style,
        ...(glow ? { boxShadow: `0 0 20px ${glow}33, 0 0 40px ${glow}1a` } : {}),
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
