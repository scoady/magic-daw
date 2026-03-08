import React, { useState, useCallback, useRef, useEffect } from 'react';

interface KnobProps {
  value: number;        // 0-1
  onChange?: (value: number) => void;
  size?: number;
  color?: string;
  label?: string;
  displayValue?: string;
  min?: number;
  max?: number;
}

export const Knob: React.FC<KnobProps> = ({
  value,
  onChange,
  size = 40,
  color = '#2dd4bf',
  label,
  displayValue,
  min = 0,
  max = 1,
}) => {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const normalizedValue = (value - min) / (max - min);
  const angle = normalizedValue * 270 - 135;
  const r = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Arc for the value indicator
  const startAngle = (-135 * Math.PI) / 180;
  const endAngle = (angle * Math.PI) / 180;
  const arcR = r - 2;

  const startX = cx + arcR * Math.cos(startAngle - Math.PI / 2);
  const startY2 = cy + arcR * Math.sin(startAngle - Math.PI / 2);
  const endX = cx + arcR * Math.cos(endAngle - Math.PI / 2);
  const endY = cy + arcR * Math.sin(endAngle - Math.PI / 2);
  const largeArc = normalizedValue > 0.5 ? 1 : 0;

  const indicatorX = cx + (r - 6) * Math.cos(endAngle - Math.PI / 2);
  const indicatorY = cy + (r - 6) * Math.sin(endAngle - Math.PI / 2);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    startY.current = e.clientY;
    startValue.current = normalizedValue;
  }, [normalizedValue]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = (startY.current - e.clientY) / 150;
      const newValue = Math.max(0, Math.min(1, startValue.current + delta));
      onChange?.(min + newValue * (max - min));
    };

    const handleMouseUp = () => setDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, onChange, min, max]);

  return (
    <div className="knob-container flex flex-col items-center gap-1">
      <svg
        width={size}
        height={size}
        onMouseDown={handleMouseDown}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        {/* Background track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(120, 200, 220, 0.12)"
          strokeWidth={2}
        />
        <circle cx={cx} cy={cy} r={r - 3} fill="rgba(0, 0, 0, 0.4)" />

        {/* Value arc */}
        {normalizedValue > 0.01 && (
          <path
            d={`M ${startX} ${startY2} A ${arcR} ${arcR} 0 ${largeArc} 1 ${endX} ${endY}`}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.8}
          />
        )}

        {/* Indicator dot */}
        <circle
          cx={indicatorX}
          cy={indicatorY}
          r={2.5}
          fill={color}
        />

        {/* Center glow */}
        <circle
          cx={cx}
          cy={cy}
          r={3}
          fill={color}
          opacity={0.15}
        />
      </svg>

      {/* Display value */}
      {displayValue && (
        <span
          className="text-center"
          style={{
            fontSize: 8,
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {displayValue}
        </span>
      )}

      {/* Label */}
      {label && (
        <span
          className="text-center"
          style={{
            fontSize: 7,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
