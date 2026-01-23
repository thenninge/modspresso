'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine
} from 'recharts';
import { ProfileSegment } from '@/types';

interface PressureChartProps {
  segments: ProfileSegment[];
  width?: number;
  height?: number;
  showArea?: boolean;
  className?: string;
  markerStartAt?: number | null;
  isRunning?: boolean;
}

// Convert segments to chart data points
const segmentsToChartData = (segments: ProfileSegment[]) => {
  const data: Array<{ time: number; pressure: number }> = [];
  
  segments.forEach(segment => {
    // Add start point
    data.push({
      time: segment.startTime,
      pressure: segment.startPressure
    });
    
    // Add end point
    data.push({
      time: segment.endTime,
      pressure: segment.endPressure
    });
  });
  
  return data.sort((a, b) => a.time - b.time);
};

// Custom tooltip component - defined outside to prevent recreation on each render
const CustomTooltip = React.memo(({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium">Tid: {label}s</p>
        <p className="text-blue-600">Trykk: {payload[0].value} bar</p>
      </div>
    );
  }
  return null;
});

CustomTooltip.displayName = 'CustomTooltip';

const PressureChartComponent: React.FC<PressureChartProps> = ({
  segments,
  width = 600,
  height = 400,
  showArea = true,
  className = '',
  markerStartAt = null,
  isRunning = false
}) => {
  const [isMounted, setIsMounted] = React.useState(false);
  const [markerTime, setMarkerTime] = React.useState<number | null>(null);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  React.useEffect(() => {
    if (!isRunning || !markerStartAt) {
      setMarkerTime(null);
      return;
    }

    const updateMarker = () => {
      const elapsedSeconds = (Date.now() - markerStartAt) / 1000;
      setMarkerTime(elapsedSeconds);
    };

    updateMarker();
    const timer = setInterval(updateMarker, 200);
    return () => clearInterval(timer);
  }, [isRunning, markerStartAt]);

  // Memoize chart data to prevent unnecessary recalculations
  const chartData = React.useMemo(() => {
    return segmentsToChartData(segments);
  }, [segments]);

  // Memoize maxTime to prevent recalculation
  const maxTime = React.useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.max(...chartData.map(d => d.time));
  }, [chartData]);

  // Memoize chart configuration to prevent re-renders (must be before early returns)
  const chartMargin = React.useMemo(() => ({ top: 20, right: 30, left: 20, bottom: 20 }), []);
  const tickFormatter = React.useCallback((value: number) => `${value}s`, []);
  
  // Don't render until mounted on client
  if (!isMounted) {
    return (
      <div className={`flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg ${className}`} 
           style={{ width, height }}>
        <p className="text-gray-500">Laster graf...</p>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className={`flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg ${className}`} 
           style={{ width, height }}>
        <p className="text-gray-500">Ingen data å vise</p>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        {showArea ? (
          <AreaChart data={chartData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="time" 
              type="number"
              label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
              domain={[0, maxTime]}
              tickFormatter={tickFormatter}
            />
            <YAxis 
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              domain={[0, 9]}
            />
            <Tooltip content={<CustomTooltip />} />
            {markerTime != null && (
              <ReferenceLine
                x={Math.max(0, Math.min(markerTime, maxTime))}
                stroke="#f97316"
                strokeDasharray="4 4"
                label={{ value: 'Nå', position: 'insideTopRight', fill: '#f97316' }}
              />
            )}
            <Area 
              type="monotone" 
              dataKey="pressure" 
              stroke="#3b82f6" 
              fill="#3b82f6" 
              fillOpacity={0.3}
              strokeWidth={3}
            />
          </AreaChart>
        ) : (
          <LineChart data={chartData} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="time" 
              type="number"
              label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
              domain={[0, maxTime]}
              tickFormatter={tickFormatter}
            />
            <YAxis 
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              domain={[0, 9]}
            />
            <Tooltip content={<CustomTooltip />} />
            {markerTime != null && (
              <ReferenceLine
                x={Math.max(0, Math.min(markerTime, maxTime))}
                stroke="#f97316"
                strokeDasharray="4 4"
                label={{ value: 'Nå', position: 'insideTopRight', fill: '#f97316' }}
              />
            )}
            <Line 
              type="monotone" 
              dataKey="pressure" 
              stroke="#3b82f6" 
              strokeWidth={3}
              dot={false}
              activeDot={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
};

// Memoize with deep comparison of segments to prevent re-renders when parent re-renders
const PressureChart = React.memo(PressureChartComponent, (prevProps, nextProps) => {
  // Compare segments deeply
  if (prevProps.segments.length !== nextProps.segments.length) {
    return false; // Re-render if segment count changed
  }
  
  for (let i = 0; i < prevProps.segments.length; i++) {
    const prev = prevProps.segments[i];
    const next = nextProps.segments[i];
    if (
      prev.startTime !== next.startTime ||
      prev.endTime !== next.endTime ||
      prev.startPressure !== next.startPressure ||
      prev.endPressure !== next.endPressure
    ) {
      return false; // Re-render if any segment changed
    }
  }
  
  // Compare other props
  if (
    prevProps.width !== nextProps.width ||
    prevProps.height !== nextProps.height ||
    prevProps.showArea !== nextProps.showArea ||
    prevProps.className !== nextProps.className ||
    prevProps.markerStartAt !== nextProps.markerStartAt ||
    prevProps.isRunning !== nextProps.isRunning
  ) {
    return false; // Re-render if other props changed
  }
  
  return true; // Don't re-render - props are the same
});

PressureChart.displayName = 'PressureChart';

export default PressureChart;
