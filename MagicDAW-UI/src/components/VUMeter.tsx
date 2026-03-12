import React, { useRef, useEffect, useState } from 'react';

interface VUMeterProps {
  level: number;       // 0-1
  peak?: number;       // 0-1
  width?: number;
  height?: number;
  orientation?: 'vertical' | 'horizontal';
}

export const VUMeter: React.FC<VUMeterProps> = ({
  level,
  peak,
  width = 6,
  height = 120,
  orientation = 'vertical',
}) => {
  const [peakHold, setPeakHold] = useState(0);
  const peakTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const currentLevel = peak ?? level;
    if (currentLevel > peakHold) {
      setPeakHold(currentLevel);
      clearTimeout(peakTimer.current);
      peakTimer.current = setTimeout(() => {
        setPeakHold((prev) => Math.max(0, prev - 0.02));
      }, 800);
    }
  }, [level, peak, peakHold]);

  const isVertical = orientation === 'vertical';

  return (
    <div
      className="relative rounded overflow-hidden"
      style={{
        width: isVertical ? width : height,
        height: isVertical ? height : width,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      {/* Level fill */}
      <div
        className="absolute vu-gradient"
        style={
          isVertical
            ? {
                bottom: 0,
                left: 0,
                right: 0,
                height: `${level * 100}%`,
                transition: 'height 0.05s linear',
                opacity: 0.85,
                background: 'linear-gradient(to top, #7d838b 0%, #b8bec6 55%, #eceff3 100%)',
              }
            : {
                top: 0,
                left: 0,
                bottom: 0,
                width: `${level * 100}%`,
                transition: 'width 0.05s linear',
                opacity: 0.85,
                background:
                  'linear-gradient(to right, #676c73, #9aa1aa, #d3d8df, #f2f4f7)',
              }
        }
      />

      {/* Peak hold indicator */}
      {peakHold > 0.01 && (
        <div
          className="absolute"
          style={
            isVertical
              ? {
                  bottom: `${peakHold * 100}%`,
                  left: 0,
                  right: 0,
                  height: 1.5,
                  background: 'rgba(255,255,255,0.9)',
                  opacity: 0.9,
                }
              : {
                  left: `${peakHold * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1.5,
                  background: 'rgba(255,255,255,0.9)',
                  opacity: 0.9,
                }
          }
        />
      )}
    </div>
  );
};
