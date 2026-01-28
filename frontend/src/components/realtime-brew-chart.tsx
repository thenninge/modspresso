'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { Profile, ProfileSegment } from '@/types';

interface RealtimeBrewChartProps {
  profile: Profile;
  startTime: number; // timestamp in ms when brew started
  isRunning: boolean;
  height?: number;
}

// Generate target pressure curve from profile segments
const generateTargetCurve = (segments: ProfileSegment[], maxTime: number) => {
  const data: Array<{ time: number; pressure: number }> = [];
  const step = 0.5; // 0.5 second steps for smooth curve
  
  for (let t = 0; t <= maxTime; t += step) {
    let pressure = 0;
    
    for (const segment of segments) {
      if (t >= segment.startTime && t <= segment.endTime) {
        const progress = (t - segment.startTime) / (segment.endTime - segment.startTime);
        pressure = segment.startPressure + (segment.endPressure - segment.startPressure) * progress;
        break;
      }
    }
    
    data.push({ time: t, pressure: Number(pressure.toFixed(2)) });
  }
  
  return data;
};

// Custom tooltip
const CustomTooltip = React.memo(({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color?: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium mb-2">Tid: {Number(label).toFixed(1)}s</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color }}>
            {entry.dataKey === 'pressure' ? 'Mål: ' : 'Nå: '}
            {Number(entry.value).toFixed(2)} bar
          </p>
        ))}
      </div>
    );
  }
  return null;
});

CustomTooltip.displayName = 'CustomTooltip';

export const RealtimeBrewChart: React.FC<RealtimeBrewChartProps> = ({
  profile,
  startTime,
  isRunning,
  height = 400
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Calculate max time from profile
  const maxTime = useMemo(() => {
    if (!profile?.segments || profile.segments.length === 0) return 60;
    return Math.max(...profile.segments.map(s => s.endTime));
  }, [profile]);

  // Generate full target curve (static)
  const targetCurve = useMemo(() => {
    if (!profile?.segments || profile.segments.length === 0) return [];
    return generateTargetCurve(profile.segments, maxTime);
  }, [profile?.segments, maxTime]);

  // Update current time every 100ms (1:1 real time)
  useEffect(() => {
    if (!isRunning || !startTime) {
      setCurrentTime(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      setCurrentTime(Math.min(elapsed, maxTime));
    }, 100); // Update 10 times per second for smooth animation

    return () => clearInterval(interval);
  }, [isRunning, startTime, maxTime]);

  // Generate chart data: full target curve + current position marker
  const chartData = useMemo(() => {
    return targetCurve.map(point => ({
      time: point.time,
      pressure: point.pressure,
      // Only show "current" dot at the current time position
      current: Math.abs(point.time - currentTime) < 0.3 ? point.pressure : null
    }));
  }, [targetCurve, currentTime]);

  if (!isMounted) {
    return (
      <div className="flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg" 
           style={{ height }}>
        <p className="text-gray-500">Laster graf...</p>
      </div>
    );
  }

  // Calculate marker position as percentage
  const markerPosition = currentTime > 0 ? ((currentTime / maxTime) * 100) : 0;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">
          {isRunning ? 'Live Brygging' : 'Profil'}
        </h4>
        {isRunning && (
          <div className="flex items-center space-x-4 text-xs">
            <div className="flex items-center text-green-600">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-1 animate-pulse"></div>
              <span>Kjører... ({currentTime.toFixed(1)}s / {maxTime}s)</span>
            </div>
            <div className="text-gray-500">
              {((currentTime / maxTime) * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>
      <div className="w-full relative" style={{ height }}>
        {/* CSS overlay marker - this WILL work */}
        {isRunning && currentTime > 0 && markerPosition > 0 && (
          <div
            style={{
              position: 'absolute',
              left: `calc(${markerPosition}% + 20px)`, // 20px = left margin
              top: 5,
              bottom: 20,
              width: '3px',
              backgroundColor: '#f97316',
              zIndex: 10,
              pointerEvents: 'none'
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '-20px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: '#f97316',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap'
              }}
            >
              NÅ
            </div>
          </div>
        )}
        
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="time" 
              type="number"
              domain={[0, maxTime]}
              label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
              tickFormatter={(value) => `${value}s`}
            />
            <YAxis 
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              domain={[0, 12]}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Target curve (full profile) */}
            <Line 
              type="monotone" 
              dataKey="pressure" 
              stroke="#3b82f6" 
              strokeWidth={2}
              dot={false}
              name="Mål"
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default RealtimeBrewChart;
