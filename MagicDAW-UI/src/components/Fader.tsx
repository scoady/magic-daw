import React, { useState, useCallback, useRef, useEffect } from 'react';

interface FaderProps {
  value: number;     // 0-1
  onChange?: (value: number) => void;
  height?: number;
  width?: number;
  color?: string;
  label?: string;
  dbDisplay?: boolean;
}

const DB_MARKS = [
  { label: '+6', pos: 0 },
  { label: '0', pos: 6 / 54 },
  { label: '-6', pos: 12 / 54 },
  { label: '-12', pos: 18 / 54 },
  { label: '-24', pos: 30 / 54 },
  { label: '-48', pos: 1 },
];

export const Fader: React.FC<FaderProps> = ({
  value,
  onChange,
  height = 180,
  width = 30,
  color = '#2dd4bf',
  label,
  dbDisplay = true,
}) => {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const fillHeight = value * height;
  const thumbY = height - fillHeight;

  const dB = value > 0 ? (value * 54 - 48).toFixed(1) : '-inf';

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const y = 1 - (e.clientY - rect.top) / rect.height;
      onChange?.(Math.max(0, Math.min(1, y)));
    };

    const handleMouseUp = () => setDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, onChange]);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-1">
        {/* Fader track */}
        <div
          ref={trackRef}
          className="relative rounded"
          style={{
            width,
            height,
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid var(--border)',
            cursor: dragging ? 'grabbing' : 'pointer',
          }}
          onMouseDown={handleMouseDown}
        >
          {/* Aurora gradient fill */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-b"
            style={{
              height: fillHeight,
              background: `linear-gradient(to top, ${color}99, var(--cyan)4d, var(--purple)1a)`,
              transition: dragging ? 'none' : 'height 0.1s ease',
            }}
          />

          {/* Thumb */}
          <div
            className="absolute left-[-2px] right-[-2px] rounded"
            style={{
              top: thumbY - 4,
              height: 8,
              background: 'rgba(200, 220, 240, 0.15)',
              border: `1px solid ${color}`,
              transition: dragging ? 'none' : 'top 0.1s ease',
            }}
          >
            <div
              className="absolute top-1/2 left-1 right-1"
              style={{
                height: 1.5,
                marginTop: -0.75,
                background: color,
                opacity: 0.9,
              }}
            />
          </div>
        </div>

        {/* dB markings */}
        {dbDisplay && (
          <div className="relative" style={{ height, width: 24 }}>
            {DB_MARKS.map((mark) => (
              <div
                key={mark.label}
                className="absolute flex items-center gap-0.5"
                style={{ top: mark.pos * height - 4 }}
              >
                <div
                  style={{
                    width: 4,
                    height: 0.5,
                    background: 'rgba(255,255,255,0.15)',
                  }}
                />
                <span
                  style={{
                    fontSize: 6,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    opacity: 0.6,
                  }}
                >
                  {mark.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Value display */}
      <span
        style={{
          fontSize: 8,
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {dB} dB
      </span>

      {/* Label */}
      {label && (
        <span
          style={{
            fontSize: 7,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
