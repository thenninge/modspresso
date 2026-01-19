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
  AreaChart
} from 'recharts';
import { ProfileSegment } from '@/types';

interface PressureChartProps {
  segments: ProfileSegment[];
  width?: number;
  height?: number;
  showArea?: boolean;
  className?: string;
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

export const PressureChart: React.FC<PressureChartProps> = ({
  segments,
  width = 600,
  height = 400,
  showArea = true,
  className = ''
}) => {
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

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
              label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
              domain={[0, maxTime]}
              tickFormatter={tickFormatter}
            />
            <YAxis 
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              domain={[0, 9]}
            />
            <Tooltip content={<CustomTooltip />} />
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
              label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
              domain={[0, maxTime]}
              tickFormatter={tickFormatter}
            />
            <YAxis 
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              domain={[0, 9]}
            />
            <Tooltip content={<CustomTooltip />} />
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

export default PressureChart;
