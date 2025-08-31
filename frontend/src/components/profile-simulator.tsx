'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { Play, Square, RotateCcw } from 'lucide-react';
import { Profile } from '@/types';

interface ProfileSimulatorProps {
  profile: Profile;
  height?: number;
}

interface SimulationPoint {
  time: number;
  targetPressure: number;
  currentPressure: number;
  segment: number;
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="text-sm font-medium text-gray-800">
          Tid: <span className="text-blue-600">{label}s</span>
        </p>
        <p className="text-sm text-gray-600">
          Mål-trykk: <span className="text-green-600">{payload[0].value} bar</span>
        </p>
        {payload[1] && (
          <p className="text-sm text-gray-600">
            Nåværende: <span className="text-red-600">{payload[1].value} bar</span>
          </p>
        )}
      </div>
    );
  }
  return null;
};

export const ProfileSimulator: React.FC<ProfileSimulatorProps> = ({ 
  profile, 
  height = 300 
}) => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [simulationData, setSimulationData] = useState<SimulationPoint[]>([]);
  const [currentSegment, setCurrentSegment] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sliding window for smooth rendering - only show last 5 seconds
  const WINDOW_SIZE = 5; // seconds
  const visibleSimulationData = React.useMemo(() => {
    if (!isSimulating) return simulationData;
    
    const windowStart = Math.max(0, currentTime - WINDOW_SIZE);
    return simulationData.filter(point => point.time >= windowStart);
  }, [simulationData, currentTime, isSimulating]);

  // Calculate chart dimensions based on profile segments (master scale)
  const maxTime = Math.max(...profile.segments.map(s => s.endTime));
  const maxPressure = Math.max(...profile.segments.map(s => Math.max(s.startPressure, s.endPressure)));
  
  // Generate target curve data based on profile segments (master timeline)
  const targetCurveData = React.useMemo(() => {
    const data: Array<{time: number, targetPressure: number}> = [];
    
    // Create a comprehensive timeline from all segment boundaries
    const timePoints = new Set<number>();
    
    // Add all segment start and end times
    profile.segments.forEach(segment => {
      timePoints.add(segment.startTime);
      timePoints.add(segment.endTime);
    });
    
    // Add intermediate points for smooth curves (every 0.5s)
    for (let time = 0; time <= maxTime; time += 0.5) {
      timePoints.add(time);
    }
    
    // Convert to sorted array
    const sortedTimePoints = Array.from(timePoints).sort((a, b) => a - b);
    
    // Generate target pressure for each time point
    sortedTimePoints.forEach(time => {
      let targetPressure = 0;
      
      // Find which segment this time belongs to
      for (const segment of profile.segments) {
        if (time >= segment.startTime && time <= segment.endTime) {
          const progress = (time - segment.startTime) / (segment.endTime - segment.startTime);
          targetPressure = segment.startPressure + (segment.endPressure - segment.startPressure) * progress;
          break;
        }
      }
      
      data.push({
        time: time,
        targetPressure: Math.round(targetPressure * 10) / 10
      });
    });
    
    return data;
  }, [profile, maxTime]);

  const startSimulation = () => {
    setIsSimulating(true);
    setCurrentTime(0);
    setSimulationData([]);
    setCurrentSegment(0);
    
    intervalRef.current = setInterval(() => {
      setCurrentTime(prevTime => {
        const newTime = prevTime + 0.5;
        
        if (newTime > maxTime) {
          stopSimulation();
          return prevTime;
        }
        
        // Calculate target pressure for current time
        let targetPressure = 0;
        let segmentIndex = 0;
        
        for (let i = 0; i < profile.segments.length; i++) {
          const segment = profile.segments[i];
          if (newTime >= segment.startTime && newTime <= segment.endTime) {
            const progress = (newTime - segment.startTime) / (segment.endTime - segment.startTime);
            targetPressure = segment.startPressure + (segment.endPressure - segment.startPressure) * progress;
            segmentIndex = i;
            break;
          }
        }
        
        // Simulate current pressure with realistic pump behavior
        let currentPressure = targetPressure;
        
        // Add pump lag/delay (pump takes time to reach target)
        const pumpLag = 0.8; // 80% of target in first 0.5s
        const currentSegment = profile.segments[segmentIndex];
        const timeInSegment = newTime - currentSegment.startTime;
        if (timeInSegment < 1.0) {
          // Pump is still ramping up
          const rampProgress = Math.min(timeInSegment / 1.0, 1.0);
          currentPressure = targetPressure * (pumpLag + (1 - pumpLag) * rampProgress);
        }
        
        // Add realistic noise/variation
        const baseNoise = (Math.random() - 0.5) * 0.2; // ±0.1 bar base noise
        const pumpVibration = Math.sin(newTime * 10) * 0.05; // High-frequency vibration
        const pressureVariation = baseNoise + pumpVibration;
        
        currentPressure = Math.max(0, currentPressure + pressureVariation);
        
        setCurrentSegment(segmentIndex);
        setSimulationData(prev => [...prev, {
          time: Number(newTime.toFixed(1)),
          targetPressure: Math.round(targetPressure * 10) / 10,
          currentPressure: Math.round(currentPressure * 10) / 10,
          segment: segmentIndex
        }]);
        
        return newTime;
      });
    }, 500); // Update every 500ms
  };

  const stopSimulation = () => {
    setIsSimulating(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const resetSimulation = () => {
    stopSimulation();
    setCurrentTime(0);
    setSimulationData([]);
    setCurrentSegment(0);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const progressPercent = (currentTime / maxTime) * 100;

  return (
    <div className="space-y-4">
      {/* Control Panel */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {!isSimulating ? (
            <button
              onClick={startSimulation}
              className="flex items-center px-3 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
            >
              <Play size={16} className="mr-1" />
              Start Simulering
            </button>
          ) : (
            <button
              onClick={stopSimulation}
              className="flex items-center px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
            >
              <Square size={16} className="mr-1" />
              Stopp
            </button>
          )}
          
          <button
            onClick={resetSimulation}
            className="flex items-center px-3 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
          >
            <RotateCcw size={16} className="mr-1" />
            Reset
          </button>
        </div>
        
        <div className="text-sm text-gray-600">
          {isSimulating ? (
            <span className="text-green-600">Simulerer...</span>
          ) : (
            <span>Klar til simulering</span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">
            Fremdrift: {currentTime.toFixed(1)}s / {maxTime}s
          </span>
          <span className="text-gray-500">{Math.round(progressPercent)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Chart */}
      <div className="border border-gray-200 rounded-lg p-4">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={targetCurveData}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            domain={{ 
              x: isSimulating ? [Math.max(0, currentTime - WINDOW_SIZE), currentTime + 1] : [0, maxTime], 
              y: [0, maxPressure + 1] 
            }}
            scale="time"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="time"
              label={{ value: 'Tid (s)', position: 'insideBottom', offset: -10 }}
              tick={{ fontSize: 12 }}
              domain={isSimulating ? [Math.max(0, currentTime - WINDOW_SIZE), currentTime + 1] : [0, maxTime]}
              type="number"
              scale="time"
            />
            <YAxis
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              tick={{ fontSize: 12 }}
              domain={[0, maxPressure + 1]}
              type="number"
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Target curve (planned) */}
            <Line
              type="monotone"
              dataKey="targetPressure"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="Mål-trykk"
              scale="time"
            />
            
            {/* Current pressure (simulated) */}
            {visibleSimulationData.length > 0 && (
              <Line
                type="monotone"
                dataKey="currentPressure"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                name="Nåværende trykk"
                data={visibleSimulationData}
                connectNulls={false}
                scale="time"
              />
            )}
            
            {/* Current time indicator */}
            {isSimulating && (
              <ReferenceLine
                x={currentTime}
                stroke="#10b981"
                strokeWidth={2}
                label={{
                  value: `${currentTime.toFixed(1)}s`,
                  position: 'top',
                  fill: '#10b981',
                  fontSize: 12
                }}
              />
            )}
            
            {/* Segment boundaries */}
            {profile.segments.map((segment, index) => (
              <ReferenceLine
                key={index}
                x={segment.startTime}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                strokeWidth={1}
                label={{
                  value: `S${index + 1}`,
                  position: 'insideTop',
                  fill: '#f59e0b',
                  fontSize: 10
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Current Status */}
      {isSimulating && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="text-sm font-medium text-blue-800">
                Segment {currentSegment + 1}: {profile.segments[currentSegment]?.startTime}s - {profile.segments[currentSegment]?.endTime}s
              </h4>
              <p className="text-xs text-blue-600">
                Trykk: {profile.segments[currentSegment]?.startPressure} → {profile.segments[currentSegment]?.endPressure} bar
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-blue-800">
                {currentTime.toFixed(1)}s
              </div>
              <div className="text-xs text-blue-600">
                {Math.round(progressPercent)}% fullført
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileSimulator;
