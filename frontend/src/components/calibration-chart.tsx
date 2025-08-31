'use client';

import React, { useState, useMemo } from 'react';
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

interface CalibrationPoint {
  dimLevel: number;
  pressure: number;
}

interface CalibrationChartProps {
  calibrationData: Record<number, number>;
  onPointClick?: (dimLevel: number, pressure: number) => void;
}

// Linear interpolation function
const interpolate = (x: number, points: CalibrationPoint[]): number => {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].pressure;
  
  // Sort points by dimLevel
  const sortedPoints = [...points].sort((a, b) => a.dimLevel - b.dimLevel);
  
  // Find the two points to interpolate between
  let lowerPoint = sortedPoints[0];
  let upperPoint = sortedPoints[sortedPoints.length - 1];
  
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    if (x >= sortedPoints[i].dimLevel && x <= sortedPoints[i + 1].dimLevel) {
      lowerPoint = sortedPoints[i];
      upperPoint = sortedPoints[i + 1];
      break;
    }
  }
  
  // Linear interpolation
  if (upperPoint.dimLevel === lowerPoint.dimLevel) {
    return lowerPoint.pressure;
  }
  
  const ratio = (x - lowerPoint.dimLevel) / (upperPoint.dimLevel - lowerPoint.dimLevel);
  return lowerPoint.pressure + ratio * (upperPoint.pressure - lowerPoint.pressure);
};

// Generate smooth curve data
const generateSmoothCurve = (calibrationData: Record<number, number>): Array<{dimLevel: number, pressure: number}> => {
  const points: CalibrationPoint[] = [
    { dimLevel: 0, pressure: 0 } // Always start at 0,0
  ];
  
  // Add calibration points
  Object.entries(calibrationData).forEach(([dimLevel, pressure]) => {
    if (pressure !== null && pressure !== undefined) {
      points.push({ dimLevel: parseInt(dimLevel), pressure });
    }
  });
  
  // Sort by dimLevel
  points.sort((a, b) => a.dimLevel - b.dimLevel);
  
  // Generate smooth curve with 101 points (0-100)
  const curveData = [];
  for (let i = 0; i <= 100; i++) {
    const interpolatedPressure = interpolate(i, points);
    curveData.push({
      dimLevel: i,
      pressure: Math.round(interpolatedPressure * 10) / 10 // Round to 1 decimal
    });
  }
  
  return curveData;
};

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="text-sm font-medium text-gray-800">
          Dim-level: <span className="text-blue-600">{label}%</span>
        </p>
        <p className="text-sm text-gray-600">
          Trykk: <span className="text-green-600">{payload[0].value} bar</span>
        </p>
      </div>
    );
  }
  return null;
};

export const CalibrationChart: React.FC<CalibrationChartProps> = ({
  calibrationData,
  onPointClick
}) => {
  const [clickedPoint, setClickedPoint] = useState<{dimLevel: number, pressure: number} | null>(null);
  
  const curveData = useMemo(() => {
    return generateSmoothCurve(calibrationData);
  }, [calibrationData]);
  
  const calibrationPoints = useMemo(() => {
    return Object.entries(calibrationData)
      .filter(([_, pressure]) => pressure !== null && pressure !== undefined)
      .map(([dimLevel, pressure]) => ({
        dimLevel: parseInt(dimLevel),
        pressure: pressure as number
      }))
      .sort((a, b) => a.dimLevel - b.dimLevel);
  }, [calibrationData]);
  
  const handleChartClick = (data: { activeLabel?: string; activePayload?: Array<{ value: number; payload: { dimLevel: number; pressure: number } }> }) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const point = data.activePayload[0].payload;
      setClickedPoint(point);
      if (onPointClick) {
        onPointClick(point.dimLevel, point.pressure);
      }
    }
  };
  
  const hasData = Object.values(calibrationData).some(pressure => pressure !== null && pressure !== undefined);
  
  if (!hasData) {
    return (
      <div className="h-64 flex items-center justify-center bg-gray-50 border border-gray-200 rounded-lg">
        <p className="text-gray-500">Ingen kalibreringsdata tilgjengelig</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="h-64 border border-gray-200 rounded-lg p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={curveData}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            onClick={handleChartClick}
            style={{ cursor: 'crosshair' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="dimLevel"
              label={{ value: 'Dim-level (%)', position: 'insideBottom', offset: -10 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              label={{ value: 'Trykk (bar)', angle: -90, position: 'insideLeft' }}
              tick={{ fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Smooth curve */}
            <Line
              type="monotone"
              dataKey="pressure"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6, fill: '#3b82f6' }}
            />
            
            {/* Calibration points */}
            {calibrationPoints.map((point, index) => (
              <ReferenceLine
                key={index}
                x={point.dimLevel}
                stroke="#ef4444"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            ))}
            
            {/* Clicked point indicator */}
            {clickedPoint && (
              <ReferenceLine
                x={clickedPoint.dimLevel}
                stroke="#10b981"
                strokeWidth={2}
                label={{
                  value: `${clickedPoint.dimLevel}% → ${clickedPoint.pressure} bar`,
                  position: 'top',
                  fill: '#10b981',
                  fontSize: 12
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* Calibration points legend */}
      <div className="bg-gray-50 p-3 rounded-lg">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Kalibreringspunkter:</h4>
        <div className="flex flex-wrap gap-2">
          {calibrationPoints.map((point, index) => (
            <div
              key={index}
              className="flex items-center space-x-1 text-xs bg-white px-2 py-1 rounded border"
            >
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span className="text-gray-600">
                {point.dimLevel}%: {point.pressure} bar
              </span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Instructions */}
      <div className="text-xs text-gray-500">
        💡 Klikk på grafen for å se interpolerte verdier mellom kalibreringspunktene
      </div>
    </div>
  );
};

export default CalibrationChart;
