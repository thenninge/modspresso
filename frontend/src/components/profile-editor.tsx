'use client';

import React, { useState } from 'react';
import { Profile, ProfileSegment } from '@/types';
import PressureChart from './pressure-chart';
import { Plus, Trash2, Save, X } from 'lucide-react';

interface ProfileEditorProps {
  profile?: Profile;
  onSave: (profile: Profile) => void;
  onCancel: () => void;
}

export const ProfileEditor: React.FC<ProfileEditorProps> = ({
  profile,
  onSave,
  onCancel
}) => {
  const [name, setName] = useState(profile?.name || '');
  const [description, setDescription] = useState(profile?.description || '');
  const [segments, setSegments] = useState<ProfileSegment[]>(
    profile?.segments || [
      { startTime: 0, endTime: 8, startPressure: 2, endPressure: 2 }
    ]
  );

  const addSegment = () => {
    const lastSegment = segments[segments.length - 1];
    const newSegment: ProfileSegment = {
      startTime: lastSegment ? lastSegment.endTime : 0,
      endTime: lastSegment ? lastSegment.endTime + 4 : 4,
      startPressure: lastSegment ? lastSegment.endPressure : 2,
      endPressure: lastSegment ? lastSegment.endPressure : 2
    };
    setSegments([...segments, newSegment]);
  };

  const removeSegment = (index: number) => {
    if (segments.length > 1) {
      const newSegments = segments.filter((_, i) => i !== index);
      setSegments(newSegments);
    }
  };

  const updateSegment = (index: number, field: keyof ProfileSegment, value: number) => {
    const newSegments = [...segments];
    newSegments[index] = { ...newSegments[index], [field]: value };
    
    // Auto-adjust subsequent segments
    if (field === 'endTime' && index < segments.length - 1) {
      const currentEndTime = value;
      const nextSegment = newSegments[index + 1];
      if (nextSegment.startTime < currentEndTime) {
        nextSegment.startTime = currentEndTime;
        nextSegment.endTime = Math.max(nextSegment.endTime, currentEndTime + 1);
      }
    }
    
    setSegments(newSegments);
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert('Profilnavn er påkrevd');
      return;
    }

    const newProfile: Profile = {
      id: profile?.id || Date.now().toString(),
      name: name.trim(),
      description: description.trim(),
      segments: segments.filter(s => s.startTime !== s.endTime), // Remove invalid segments
      createdAt: profile?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onSave(newProfile);
  };

  const isValid = name.trim() && segments.length > 0;

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          {profile ? 'Rediger Profil' : 'Ny Profil'}
        </h2>
        <button
          onClick={onCancel}
          className="p-2 text-gray-500 hover:text-gray-700"
        >
          <X size={20} />
        </button>
      </div>

      {/* Profile Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Profilnavn *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            placeholder="F.eks. Classic Espresso"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Beskrivelse
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
            placeholder="Beskrivelse av profilen"
          />
        </div>
      </div>

      {/* Pressure Chart Preview */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">Trykk-kurve</h3>
        <div className="border border-gray-200 rounded-lg p-4">
          <PressureChart segments={segments} height={300} />
        </div>
      </div>

      {/* Segments Editor */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Tidssegmenter</h3>
          <button
            onClick={addSegment}
            className="flex items-center px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            <Plus size={16} className="mr-1" />
            Legg til segment
          </button>
        </div>

        <div className="space-y-3">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg">
              <div className="flex-1 grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Start tid (s)</label>
                  <input
                    type="number"
                    value={segment.startTime}
                    onChange={(e) => updateSegment(index, 'startTime', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-black"
                    min={0}
                    step={0.5}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Slutt tid (s)</label>
                  <input
                    type="number"
                    value={segment.endTime}
                    onChange={(e) => updateSegment(index, 'endTime', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-black"
                    min={segment.startTime}
                    step={0.5}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Start trykk (bar)</label>
                  <input
                    type="number"
                    value={segment.startPressure}
                    onChange={(e) => updateSegment(index, 'startPressure', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-black"
                    min={0}
                    max={12}
                    step={0.1}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Slutt trykk (bar)</label>
                  <input
                    type="number"
                    value={segment.endPressure}
                    onChange={(e) => updateSegment(index, 'endPressure', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-black"
                    min={0}
                    max={12}
                    step={0.1}
                  />
                </div>
              </div>
              {segments.length > 1 && (
                <button
                  onClick={() => removeSegment(index)}
                  className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end space-x-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
        >
          Avbryt
        </button>
        <button
          onClick={handleSave}
          disabled={!isValid}
          className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={16} className="mr-1" />
          Lagre Profil
        </button>
      </div>
    </div>
  );
};

export default ProfileEditor;
