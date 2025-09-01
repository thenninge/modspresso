'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Play, Square, RotateCcw } from 'lucide-react';
import { Profile } from '@/types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

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

export const ProfileSimulatorChartJS: React.FC<ProfileSimulatorProps> = ({ 
  profile, 
  height = 300 
}) => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [simulationData, setSimulationData] = useState<SimulationPoint[]>([]);
  const [currentSegment, setCurrentSegment] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const chartRef = useRef<ChartJS<'line'>>(null);

  // Calculate chart dimensions
  const maxTime = Math.max(...profile.segments.map(s => s.endTime));

  // Generate target curve data
  const targetCurveData = React.useMemo(() => {
    const data: Array<{time: number, targetPressure: number}> = [];
    
    // Create a comprehensive timeline from all segment boundaries
    const timePoints = new Set<number>();
    
    // Add all segment start and end times
    profile.segments.forEach(segment => {
      timePoints.add(segment.startTime);
      timePoints.add(segment.endTime);
    });
    
    // Add intermediate points for smooth curves (every 0.2s for higher resolution)
    for (let time = 0; time <= maxTime; time += 0.2) {
      timePoints.add(time);
    }
    
    // Ensure we have the final time point
    timePoints.add(maxTime);
    
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
        time: Number(time.toFixed(1)),
        targetPressure: Number(targetPressure.toFixed(1))
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
        const newTime = prevTime + 0.2;
        
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
          targetPressure: Number(targetPressure.toFixed(1)),
          currentPressure: Number(currentPressure.toFixed(1)),
          segment: segmentIndex
        }]);
        
        return newTime;
      });
    }, 200); // Update every 200ms for smoother animation
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

  // Prepare Chart.js data
  const chartData = React.useMemo(() => {
    // Use target curve data as the base timeline
    
    return {
      datasets: [
        ...(simulationData.length > 0 ? [{
          label: 'Realtime',
          data: simulationData.map(d => ({ x: d.time, y: d.currentPressure })),
          borderColor: '#ef4444',
          backgroundColor: 'transparent', // No fill for legend symbol
          borderWidth: 2,
          fill: false,
          tension: 0.8, // Increased tension for smoother curves
          pointRadius: 0, // Hide points for smooth curve
        }] : []),
        {
          label: 'Profile',
          data: targetCurveData.map(d => ({ x: d.time, y: d.targetPressure })),
          borderColor: '#3b82f6',
          backgroundColor: 'transparent', // No fill for legend symbol
          borderWidth: 2,
          fill: false,
          tension: 0.8, // Increased tension for smoother curves
          pointRadius: 0, // Hide points for smooth curve
        },
      ],
    };
  }, [targetCurveData, simulationData]);

  // Chart.js options
  const options = React.useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0, // Disable animations for real-time performance
    },
    layout: {
      padding: {
        left: 10,
        right: 10,
        top: 10,
        bottom: 10,
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Tid (s)',
        },
        min: 0, // Always show from start
        max: maxTime, // Always show full timeline
        ticks: {
          stepSize: Math.max(1, Math.floor(maxTime / 10)), // Show reasonable number of ticks
          callback: function(tickValue: number | string) {
            return tickValue + 's';
          }
        },
        grid: {
          display: true,
        },
      },
      y: {
        title: {
          display: true,
          text: 'Trykk (bar)',
        },
        min: 0,
        max: 9,
        ticks: {
          callback: function(tickValue: number | string) {
            return tickValue + ' bar';
          }
        },
      },
    },
    plugins: {
      legend: {
        position: 'top' as const,
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
      },
    },
    interaction: {
      mode: 'nearest' as const,
      axis: 'x' as const,
      intersect: false,
    },
  }), [maxTime]);

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
        <div style={{ height }}>
          <Line ref={chartRef} data={chartData} options={options} />
        </div>
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

export default ProfileSimulatorChartJS;
