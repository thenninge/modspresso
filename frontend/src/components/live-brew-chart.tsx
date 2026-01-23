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
  Legend,
  ReferenceLine
} from 'recharts';
import type { Profile, ProfileSegment } from '@/types';
import type { LiveBrewData } from '@/hooks/use-web-bluetooth';

interface LiveBrewChartProps {
  profile: Profile;
  liveData: LiveBrewData[] | null | undefined;
  isRunning: boolean;
  simulateFrom?: number | null;
  preferSimulation?: boolean;
  height?: number;
}

// Generate target curve from profile segments
const generateTargetCurve = (segments: ProfileSegment[], maxTime: number) => {
  const data: Array<{ time: number; target: number }> = [];
  const step = 0.5; // 0.5 second steps
  
  for (let t = 0; t <= maxTime; t += step) {
    let targetPressure = 0;
    
    for (const segment of segments) {
      if (t >= segment.startTime && t <= segment.endTime) {
        const progress = (t - segment.startTime) / (segment.endTime - segment.startTime);
        targetPressure = segment.startPressure + (segment.endPressure - segment.startPressure) * progress;
        break;
      }
    }
    
    data.push({ time: t, target: targetPressure });
  }
  
  return data;
};

const getPressureAtTime = (segments: ProfileSegment[], time: number) => {
  for (const segment of segments) {
    if (time >= segment.startTime && time <= segment.endTime) {
      const duration = segment.endTime - segment.startTime;
      if (duration <= 0) return segment.endPressure;
      const progress = (time - segment.startTime) / duration;
      return segment.startPressure + (segment.endPressure - segment.startPressure) * progress;
    }
  }
  return segments.length ? segments[segments.length - 1].endPressure : 0;
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
            {entry.dataKey === 'target' ? 'Mål: ' : 'Faktisk: '}
            {Number(entry.value).toFixed(2)} bar
          </p>
        ))}
      </div>
    );
  }
  return null;
});

CustomTooltip.displayName = 'CustomTooltip';

export const LiveBrewChart: React.FC<LiveBrewChartProps> = ({
  profile,
  liveData = [],
  isRunning,
  simulateFrom,
  preferSimulation = false,
  height = 400
}) => {
  const [isMounted, setIsMounted] = React.useState(false);
  const [simulationNow, setSimulationNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  React.useEffect(() => {
    if (!isRunning || !simulateFrom) {
      setSimulationNow(null);
      return;
    }

    setSimulationNow(Date.now());
    const timer = setInterval(() => {
      setSimulationNow(Date.now());
    }, 500);

    return () => clearInterval(timer);
  }, [isRunning, simulateFrom]);

  // Calculate max time from profile
  const maxTime = React.useMemo(() => {
    if (!profile?.segments || profile.segments.length === 0) return 60;
    return Math.max(...profile.segments.map(s => s.endTime));
  }, [profile]);

  // Generate target curve
  const targetCurve = React.useMemo(() => {
    if (!profile?.segments || profile.segments.length === 0) return [];
    return generateTargetCurve(profile.segments, maxTime);
  }, [profile?.segments, maxTime]);

  const simulatedLiveData = React.useMemo(() => {
    if (!isRunning || !simulateFrom || !profile?.segments || profile.segments.length === 0) {
      return [];
    }

    if (!preferSimulation && liveData && Array.isArray(liveData) && liveData.length > 0) {
      return [];
    }

    const elapsedSeconds = Math.max(0, ((simulationNow ?? Date.now()) - simulateFrom) / 1000);
    const maxSimulatedTime = Math.min(elapsedSeconds, maxTime);
    const step = 0.5;
    const points: LiveBrewData[] = [];

    for (let t = 0; t <= maxSimulatedTime; t += step) {
      const target = getPressureAtTime(profile.segments, t);
      points.push({
        time: Number(t.toFixed(1)),
        current_pressure: target,
        target_pressure: target,
        timestamp: simulateFrom + t * 1000
      });
    }

    return points;
  }, [isRunning, simulateFrom, simulationNow, profile, liveData, maxTime, preferSimulation]);

  const currentTime = React.useMemo(() => {
    if (!isRunning || !simulateFrom) return null;
    const elapsedSeconds = ((simulationNow ?? Date.now()) - simulateFrom) / 1000;
    return Math.max(0, Math.min(elapsedSeconds, maxTime));
  }, [isRunning, simulateFrom, simulationNow, maxTime]);

  // Combine target curve with live data for display
  const chartData = React.useMemo(() => {
    const effectiveLiveData = (!preferSimulation && liveData && Array.isArray(liveData) && liveData.length > 0)
      ? liveData
      : simulatedLiveData;

    if (!effectiveLiveData || !Array.isArray(effectiveLiveData) || effectiveLiveData.length === 0) {
      // If no live data, just show target curve
      return targetCurve.map(targetPoint => ({
        time: targetPoint.time,
        target: targetPoint.target,
        current: null,
        target_pressure: null
      }));
    }

    // Create a map of live data points by time
    const liveMap = new Map<number, LiveBrewData>();
    effectiveLiveData.forEach(point => {
      if (point && typeof point.time === 'number') {
        const roundedTime = Math.round(point.time * 2) / 2; // Round to 0.5s
        if (!liveMap.has(roundedTime) || (liveMap.get(roundedTime)?.timestamp || 0) < (point.timestamp || 0)) {
          liveMap.set(roundedTime, point);
        }
      }
    });

    // Combine target curve with live data
    return targetCurve.map(targetPoint => {
      const livePoint = liveMap.get(targetPoint.time);
      return {
        time: targetPoint.time,
        target: targetPoint.target,
        current: livePoint ? (livePoint.current_pressure || null) : null,
        target_pressure: livePoint ? (livePoint.target_pressure || null) : null
      };
    });
  }, [targetCurve, liveData, simulatedLiveData, preferSimulation]);

  if (!isMounted) {
    return (
      <div className="flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg" 
           style={{ height }}>
        <p className="text-gray-500">Laster graf...</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">Live Brew Progress</h4>
        <div className="flex items-center space-x-4 text-xs">
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-blue-500 mr-1"></div>
            <span>Mål</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-green-500 mr-1"></div>
            <span>Faktisk</span>
          </div>
          {isRunning && (
            <div className="flex items-center text-green-600">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-1 animate-pulse"></div>
              <span>Kjører...</span>
            </div>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="time" 
            label={{ value: 'Tid (sekunder)', position: 'insideBottom', offset: -10 }}
            domain={[0, maxTime]}
            tickFormatter={(value) => `${value}s`}
          />
          <YAxis 
            label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
            domain={[0, 12]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {currentTime != null && (
            <ReferenceLine x={currentTime} stroke="#f97316" strokeDasharray="4 4" label={{ value: 'Nå', position: 'insideTopRight', fill: '#f97316' }} />
          )}
          <Line 
            type="monotone" 
            dataKey="target" 
            stroke="#3b82f6" 
            strokeWidth={2}
            dot={false}
            name="Mål"
            strokeDasharray="5 5"
          />
          <Line 
            type="monotone" 
            dataKey="current" 
            stroke="#10b981" 
            strokeWidth={3}
            dot={false}
            name="Faktisk"
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {liveData && liveData.length > 0 && liveData[liveData.length - 1]?.timestamp && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          {liveData.length} datapunkter • Siste oppdatering: {new Date(liveData[liveData.length - 1].timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

export default LiveBrewChart;
