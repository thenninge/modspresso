'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Profile, ProfileSegment } from '@/types';
import { Save, RotateCcw } from 'lucide-react';

interface ProfilePoint {
  time: number;
  pressure: number;
}

interface VisualProfileEditorProps {
  profile?: Profile;
  onSave: (profile: Profile) => void;
  onCancel: () => void;
}

export const VisualProfileEditor: React.FC<VisualProfileEditorProps> = ({
  profile,
  onSave,
  onCancel
}) => {
  const [profileName, setProfileName] = useState(profile?.name || '');
  const [profileDescription, setProfileDescription] = useState(profile?.description || '');
  const [points, setPoints] = useState<ProfilePoint[]>(() => {
    if (profile) {
      // Convert existing profile segments to points
      const profilePoints: ProfilePoint[] = [];
      profile.segments.forEach(segment => {
        profilePoints.push({ time: segment.startTime, pressure: segment.startPressure });
        if (segment.startTime !== segment.endTime) {
          profilePoints.push({ time: segment.endTime, pressure: segment.endPressure });
        }
      });
      return profilePoints.sort((a, b) => a.time - b.time);
    }
    // Default: just 2 points - user must draw the rest
    return [
      { time: 0, pressure: 2 },
      { time: 12, pressure: 8 }
    ];
  });

  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const GRID_SIZE = 25; // pixels per grid unit (reduced from 40 to fit 50s on screen)
  const TIME_RANGE = 50; // seconds (reduced from 60 to 50)
  const PRESSURE_RANGE = 9; // bar (changed from 10 to 9 to match our app)
  const POINT_RADIUS = 6;

  // Convert screen coordinates to data coordinates
  const screenToData = (x: number, y: number): ProfilePoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { time: 0, pressure: 0 };

    const rect = canvas.getBoundingClientRect();
    const dataX = (x - rect.left) / GRID_SIZE;
    const dataY = PRESSURE_RANGE - (y - rect.top) / GRID_SIZE;

    // Snap to grid: 1s intervals, 0.5 bar intervals
    const snappedTime = Math.round(dataX);
    const snappedPressure = Math.round(dataY * 2) / 2;

    return {
      time: Math.max(0, Math.min(TIME_RANGE, snappedTime)),
      pressure: Math.max(0, Math.min(PRESSURE_RANGE, snappedPressure))
    };
  };

  // Convert data coordinates to screen coordinates
  const dataToScreen = (point: ProfilePoint): { x: number; y: number } => {
    return {
      x: point.time * GRID_SIZE,
      y: (PRESSURE_RANGE - point.pressure) * GRID_SIZE
    };
  };

  // Draw the canvas
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;

    // Vertical lines (time)
    for (let i = 0; i <= TIME_RANGE; i++) {
      const x = i * GRID_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    // Horizontal lines (pressure)
    for (let i = 0; i <= PRESSURE_RANGE; i++) {
      const y = i * GRID_SIZE;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw axis labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';

    // Time labels
    for (let i = 0; i <= TIME_RANGE; i += 5) {
      const x = i * GRID_SIZE;
      ctx.fillText(`${i}s`, x, canvas.height - 5);
    }

    // Pressure labels
    for (let i = 0; i <= PRESSURE_RANGE; i += 2) {
      const y = (PRESSURE_RANGE - i) * GRID_SIZE;
      ctx.fillText(`${i}bar`, 25, y + 4);
    }

    // Draw curve
    if (points.length > 1) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 3;
      ctx.beginPath();

      const sortedPoints = [...points].sort((a, b) => a.time - b.time);
      const firstPoint = dataToScreen(sortedPoints[0]);
      ctx.moveTo(firstPoint.x, firstPoint.y);

      for (let i = 1; i < sortedPoints.length; i++) {
        const point = dataToScreen(sortedPoints[i]);
        ctx.lineTo(point.x, point.y);
      }

      ctx.stroke();
    }

    // Draw points
    points.forEach((point, index) => {
      const screenPoint = dataToScreen(point);
      const isDragging = draggingPoint === index;

      // Point circle
      ctx.fillStyle = isDragging ? '#ef4444' : '#3b82f6';
      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, POINT_RADIUS, 0, 2 * Math.PI);
      ctx.fill();

      // Point border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Point label
      ctx.fillStyle = '#374151';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${point.pressure}bar`, screenPoint.x, screenPoint.y - 10);
    });
  };

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking on a point
    for (let i = 0; i < points.length; i++) {
      const screenPoint = dataToScreen(points[i]);
      const distance = Math.sqrt((x - screenPoint.x) ** 2 + (y - screenPoint.y) ** 2);
      
      if (distance <= POINT_RADIUS) {
        setDraggingPoint(i);
        return;
      }
    }

    // Add new point
    const newPoint = screenToData(e.clientX, e.clientY);
    setPoints([...points, newPoint]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingPoint !== null) {
      const newPoint = screenToData(e.clientX, e.clientY);
      const newPoints = [...points];
      newPoints[draggingPoint] = newPoint;
      setPoints(newPoints);
    }
  };

  const handleMouseUp = () => {
    setDraggingPoint(null);
  };

  // Convert points to profile segments
  const pointsToSegments = (points: ProfilePoint[]): ProfileSegment[] => {
    const sortedPoints = [...points].sort((a, b) => a.time - b.time);
    const segments: ProfileSegment[] = [];

    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const current = sortedPoints[i];
      const next = sortedPoints[i + 1];

      segments.push({
        startTime: current.time,
        endTime: next.time,
        startPressure: current.pressure,
        endPressure: next.pressure
      });
    }

    return segments;
  };

  // Handle save
  const handleSave = () => {
    if (!profileName.trim()) {
      alert('Vennligst gi profilen et navn');
      return;
    }

    const segments = pointsToSegments(points);
    if (segments.length === 0) {
      alert('Vennligst legg til minst to punkter');
      return;
    }

    const newProfile: Profile = {
      id: profile?.id || `profile-${Date.now()}`,
      name: profileName,
      description: profileDescription,
      segments,
      createdAt: profile?.createdAt || '2024-01-01T00:00:00.000Z', // Static date to avoid hydration issues
      updatedAt: '2024-01-01T00:00:00.000Z' // Static date to avoid hydration issues
    };

    onSave(newProfile);
  };

  // Handle reset
  const handleReset = () => {
    setPoints([
      { time: 0, pressure: 2 },
      { time: 12, pressure: 8 }
    ]);
  };

  // Redraw canvas when points change
  useEffect(() => {
    drawCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, draggingPoint]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">
            {profile ? 'Rediger Profil' : 'Ny Visuell Profil'}
          </h2>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {/* Profile info */}
        <div className="mb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Profilnavn
            </label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="F.eks. Klassisk Espresso"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beskrivelse
            </label>
            <input
              type="text"
              value={profileDescription}
              onChange={(e) => setProfileDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="F.eks. Balansert espresso med god kropp"
            />
          </div>
        </div>

        {/* Instructions */}
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Instruksjoner:</strong> Profilen starter med 2 punkter (0s @ 2bar, 12s @ 8bar). 
            Klikk på grafen for å legge til flere punkter. Dra punktene for å endre trykk og tid. 
            Snapper til 1s intervaller og 0.5 bar steg.
          </p>
        </div>

        {/* Canvas */}
        <div className="mb-6 border border-gray-300 rounded-lg overflow-auto">
          <canvas
            ref={canvasRef}
            width={TIME_RANGE * GRID_SIZE}
            height={PRESSURE_RANGE * GRID_SIZE}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="cursor-crosshair"
          />
        </div>

        {/* Current points */}
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-800 mb-3">Aktuelle punkter:</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {points
              .sort((a, b) => a.time - b.time)
              .map((point, index) => (
                <div key={index} className="bg-gray-50 p-2 rounded text-sm">
                  {point.time}s @ {point.pressure}bar
                </div>
              ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-3">
          <button
            onClick={handleReset}
            className="flex items-center px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
          >
            <RotateCcw size={16} className="mr-2" />
            Nullstill
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            <Save size={16} className="mr-2" />
            Lagre Profil
          </button>
        </div>
      </div>
    </div>
  );
};
