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

// Custom tooltip component
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium">Tid: {label}s</p>
        <p className="text-blue-600">Trykk: {payload[0].value} bar</p>
      </div>
    );
  }
  return null;
};

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

  const chartData = segmentsToChartData(segments);
  
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

  const maxTime = isMounted ? Math.max(...chartData.map(d => d.time)) : 0;
  const maxPressure = isMounted ? Math.max(...chartData.map(d => d.pressure)) : 0;

  return (
    <div className={`${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        {showArea ? (
          <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="time" 
              label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
              domain={[0, maxTime]}
              tickFormatter={(value) => `${value}s`}
            />
            <YAxis 
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              domain={[0, Math.ceil(maxPressure * 1.1)]}
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
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="time" 
              label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
              domain={[0, maxTime]}
              tickFormatter={(value) => `${value}s`}
            />
            <YAxis 
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              domain={[0, Math.ceil(maxPressure * 1.1)]}
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
