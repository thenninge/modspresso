'use client';

import React, { useState } from 'react';
import { Coffee, Settings, BarChart3, Play, Plus, SlidersHorizontal, X, Bot } from 'lucide-react';
import ProfileEditor from '@/components/profile-editor';
import PressureChart from '@/components/pressure-chart';
import CalibrationPanel from '@/components/calibration-panel';
import ProfileSimulatorChartJS from '@/components/profile-simulator-chartjs';
import BluetoothSettings from '@/components/bluetooth-settings';
import { Profile } from '@/types';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { predefinedProfiles } from '@/data/default-profiles';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'brew' | 'profiles' | 'calibration' | 'settings'>('brew');
  const [showEditor, setShowEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | undefined>();
  const [simulatingProfile, setSimulatingProfile] = useState<Profile | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [bluetoothConnected, setBluetoothConnected] = useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);
  const [profiles, setProfiles] = useLocalStorage<Profile[]>('modspresso-profiles', [
    {
      id: '1',
      name: 'Classic Espresso',
      description: 'Traditional 9-bar extraction',
      segments: [
        { startTime: 0, endTime: 8, startPressure: 2, endPressure: 2 },
        { startTime: 8, endTime: 12, startPressure: 2, endPressure: 8 },
        { startTime: 12, endTime: 30, startPressure: 8, endPressure: 8 },
        { startTime: 30, endTime: 32, startPressure: 8, endPressure: 6 },
        { startTime: 32, endTime: 36, startPressure: 6, endPressure: 6 }
      ],
      createdAt: '2024-01-01T00:00:00.000Z'
    }
  ]);

  // Default profiles for hardware buttons
  const [defaultProfile1, setDefaultProfile1] = useLocalStorage<string>('modspresso-default-profile-1', '');
  const [defaultProfile2, setDefaultProfile2] = useLocalStorage<string>('modspresso-default-profile-2', '');

  const handleSaveProfile = (profile: Profile) => {
    if (editingProfile) {
      setProfiles(profiles.map(p => p.id === profile.id ? profile : p));
    } else {
      setProfiles([...profiles, profile]);
    }
    setShowEditor(false);
    setEditingProfile(undefined);
  };

  const handleEditProfile = (profile: Profile) => {
    const isPredefined = predefinedProfiles.some(p => p.id === profile.id);
    if (isPredefined) {
      // Create a copy of predefined profile with new ID
      const newProfile: Profile = {
        ...profile,
        id: `copy-${Date.now()}`,
        name: `${profile.name} (Kopi)`,
        createdAt: new Date().toISOString()
      };
      setEditingProfile(newProfile);
    } else {
      setEditingProfile(profile);
    }
    setShowEditor(true);
  };

  const handleDeleteProfile = (profileId: string) => {
    if (confirm('Er du sikker på at du vil slette denne profilen?')) {
      setProfiles(profiles.filter(p => p.id !== profileId));
    }
  };

  const handleNewProfile = () => {
    setEditingProfile(undefined);
    setShowEditor(true);
  };

  const handleClearAllProfiles = () => {
    if (confirm('Er du sikker på at du vil slette alle profiler?')) {
      setProfiles([]);
    }
  };

  const handleStartProfile = (profile: Profile) => {
    // TODO: Send profile to ESP32 via WebSocket
    console.log('Starting profile:', profile.name);
    alert(`Starter profil: ${profile.name}`);
  };

  const handleSyncProfiles = () => {
    // TODO: Send all profiles to ESP32 via WebSocket
    console.log('Syncing profiles to ESP32:', profiles);
    
    // For now, show a simple alert
    if (profiles.length === 0) {
      alert('Ingen profiler å synkronisere');
      return;
    }
    
    alert(`Synkroniserer ${profiles.length} profiler til ESP32\n\nDette vil sende alle profiler til ESP32 for lagring og offline bruk.`);
  };

  const handleSimulateProfile = (profile: Profile) => {
    setSimulatingProfile(profile);
  };

  const handleSetDefaultProfile = (profileId: string, button: 1 | 2) => {
    if (button === 1) {
      // Toggle: if already set to this profile, clear it
      setDefaultProfile1(defaultProfile1 === profileId ? '' : profileId);
    } else {
      // Toggle: if already set to this profile, clear it
      setDefaultProfile2(defaultProfile2 === profileId ? '' : profileId);
    }
  };

  const handleCalibrationComplete = (calibrationData: Record<number, number>) => {
    // TODO: Send calibration data to ESP32
    console.log('Calibration completed:', calibrationData);
    alert('Kalibrering fullført! Data er lagret.');
  };

  // Load-only predefined profiles on demand (main view shows only local profiles)
  const handleLoadPredefined = () => {
    if (confirm('Vil du laste inn predefined profiler?')) {
      const existingIds = new Set(profiles.map(p => p.id));
      const toAdd = predefinedProfiles
        .filter(p => !existingIds.has(p.id))
        .map(p => ({ ...p, createdAt: new Date().toISOString() }));
      setProfiles([...profiles, ...toAdd]);
      alert(`${toAdd.length} profiler lagt til.`);
    }
  };

  const renderBrewTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex space-x-4 mt-2 text-sm text-gray-600">
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
              Default 1: {isMounted && defaultProfile1 ? profiles.find(p => p.id === defaultProfile1)?.name || 'Ukjent' : 'Ikke satt'}
            </div>
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-green-500 mr-2"></span>
              Default 2: {isMounted && defaultProfile2 ? profiles.find(p => p.id === defaultProfile2)?.name || 'Ukjent' : 'Ikke satt'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {profiles.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <div className="text-gray-500 mb-4">
              <Coffee className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Ingen profiler ennå</h3>
              <p className="text-gray-600">Gå til Profiler-fanen for å opprette eller laste inn profiler</p>
            </div>
          </div>
        ) : (
          profiles.map((profile) => {
            // Server always renders as white, client checks predefined after mounting
            const isPredefined = false; // Will be updated after client-side mounting
  return (
            <div key={profile.id} className="rounded-lg shadow-md p-6 bg-white">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-800">{profile.name}</h3>
                    {isMounted && isPredefined && (
                      <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">Forhåndsdefinert</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{profile.description}</p>
                </div>
              </div>
              
              <div className="mb-4">
                <PressureChart segments={profile.segments} height={200} showArea={false} />
              </div>

              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-500" suppressHydrationWarning>
                  {isMounted ? new Date(profile.createdAt).toLocaleDateString('nb-NO') : '...'}
                </div>
                <div className="flex space-x-2">
                  <button 
                    onClick={() => handleStartProfile(profile)}
                    className="flex items-center px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                  >
                    <Play size={14} className="mr-1" />
                    Kjør
                  </button>
                  {!(isMounted && isPredefined) && (
                    <div className="flex space-x-1">
                      <button
                        onClick={() => handleSetDefaultProfile(profile.id, 1)}
                        className={`px-2 py-1 text-xs rounded ${
                          isMounted && defaultProfile1 === profile.id 
                            ? 'bg-blue-500 text-white hover:bg-blue-600' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                        title={isMounted && defaultProfile1 === profile.id ? "Fjern fra default profil 1" : "Sett som default profil 1"}
                      >
                        1
                      </button>
                      <button
                        onClick={() => handleSetDefaultProfile(profile.id, 2)}
                        className={`px-2 py-1 text-xs rounded ${
                          isMounted && defaultProfile2 === profile.id 
                            ? 'bg-blue-500 text-white hover:bg-blue-600' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                        title={isMounted && defaultProfile2 === profile.id ? "Fjern fra default profil 2" : "Sett som default profil 2"}
                      >
                        2
                      </button>
                    </div>
                  )}
                </div>
              </div>
          </div>
            );
          })
        )}
      </div>
    </div>
  );

  const renderProfilesTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex space-x-4 mt-2 text-sm text-gray-600">
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
              Default 1: {isMounted && defaultProfile1 ? profiles.find(p => p.id === defaultProfile1)?.name || 'Ukjent' : 'Ikke satt'}
            </div>
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-green-500 mr-2"></span>
              Default 2: {isMounted && defaultProfile2 ? profiles.find(p => p.id === defaultProfile2)?.name || 'Ukjent' : 'Ikke satt'}
            </div>
          </div>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handleClearAllProfiles}
            className="px-3 py-2 text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors text-sm"
          >
            Slett alle
          </button>
          <button
            onClick={handleSyncProfiles}
            className="flex items-center px-3 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors text-sm"
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Synkroniser
          </button>
          <button

            onClick={handleLoadPredefined}
            className="flex items-center px-3 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 transition-colors text-sm"
          >
            Predefined
          </button>
          <button
            onClick={handleNewProfile}
            className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            <Plus size={16} className="mr-2" />
            Ny Profil
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {profiles.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <div className="text-gray-500 mb-4">
              <Coffee className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Ingen profiler ennå</h3>
              <p className="text-gray-600">Opprett din første espresso-profil for å komme i gang</p>
            </div>
            <button
              onClick={handleNewProfile}
              className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors mx-auto"
            >
              <Plus size={16} className="mr-2" />
              Opprett første profil
            </button>
          </div>
        ) : (
          profiles.map((profile) => {
            // Server always renders as white, client checks predefined after mounting
            const isPredefined = false; // Will be updated after client-side mounting
            return (
            <div key={profile.id} className="rounded-lg shadow-md p-6 bg-white">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-800">{profile.name}</h3>
                    {isMounted && isPredefined && (
                      <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">Forhåndsdefinert</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{profile.description}</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleEditProfile(profile)}
                    className="p-2 text-blue-500 hover:bg-blue-50 rounded"
                    title={isMounted && isPredefined ? "Kopier og rediger" : "Rediger profil"}
                  >
                    <Settings size={16} />
                  </button>
                  {!(isMounted && isPredefined) && (
                    <button
                      onClick={() => handleDeleteProfile(profile.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded"
                      title="Slett profil"
                    >
                      <Plus size={16} className="rotate-45" />
                    </button>
                  )}
                </div>
              </div>
              
              <div className="mb-4">
                <PressureChart segments={profile.segments} height={200} showArea={false} />
              </div>

              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-500" suppressHydrationWarning>
                  {isMounted ? new Date(profile.createdAt).toLocaleDateString('nb-NO') : '...'}
                </div>
                <div className="flex space-x-2">
                  <button 
                  onClick={() => handleStartProfile(profile)}
                  className="flex items-center px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                >
                  <Play size={14} className="mr-1" />
                  Kjør
                  </button>
                  <button 
                    onClick={() => handleSimulateProfile(profile)}
                    className="flex items-center px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600"
                  >
                    <Play size={14} className="mr-1" />
                    Simuler
                  </button>
                  {!(isMounted && isPredefined) && (
                    <div className="flex space-x-1">
                      <button
                        onClick={() => handleSetDefaultProfile(profile.id, 1)}
                        className={`px-2 py-1 text-xs rounded ${
                          isMounted && defaultProfile1 === profile.id 
                            ? 'bg-blue-500 text-white hover:bg-blue-600' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                        title={isMounted && defaultProfile1 === profile.id ? "Fjern fra default profil 1" : "Sett som default profil 1"}
                      >
                        1
                      </button>
                      <button
                        onClick={() => handleSetDefaultProfile(profile.id, 2)}
                        className={`px-2 py-1 text-xs rounded ${
                          isMounted && defaultProfile2 === profile.id 
                            ? 'bg-blue-500 text-white hover:bg-blue-600' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                        title={isMounted && defaultProfile2 === profile.id ? "Fjern fra default profil 2" : "Sett som default profil 2"}
                      >
                        2
                      </button>
                    </div>
                  )}
                </div>
              </div>
          </div>
            );
          })
        )}
      </div>
    </div>
  );

  const renderCalibrationTab = () => (
    <CalibrationPanel onComplete={handleCalibrationComplete} />
  );

  const renderSettingsTab = () => (
    <BluetoothSettings onConnectionChange={setBluetoothConnected} />
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <img src="/icon2.png" alt="Modspresso" className="h-8 w-12 mr-3" />
              <h1 className="text-xl font-bold text-gray-900">Modspresso</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center text-sm text-gray-500">
                <div className={`w-2 h-2 rounded-full mr-2 ${bluetoothConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                {bluetoothConnected ? 'ESP32 tilkoblet' : 'Ikke tilkoblet'}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <button
              onClick={() => setActiveTab('brew')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'brew'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Coffee className="mr-2 h-5 w-5" />
              Brew
            </button>
            <button
              onClick={() => setActiveTab('profiles')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'profiles'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <BarChart3 className="mr-2 h-5 w-5" />
              Profiler
            </button>
            <button
              onClick={() => setActiveTab('calibration')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'calibration'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <SlidersHorizontal className="mr-2 h-5 w-5" />
              Kalibrering
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Settings className="mr-2 h-5 w-5" />
              Innstillinger
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {showEditor ? (
          <ProfileEditor
            profile={editingProfile}
            onSave={handleSaveProfile}
            onCancel={() => {
              setShowEditor(false);
              setEditingProfile(undefined);
            }}
          />
        ) : (
          <>
            {activeTab === 'brew' && renderBrewTab()}
            {activeTab === 'profiles' && renderProfilesTab()}
            {activeTab === 'calibration' && renderCalibrationTab()}
            {activeTab === 'settings' && renderSettingsTab()}
          </>
        )}
      </main>

      {/* Profile Simulator Modal */}
      {simulatingProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">
                  Simulerer: {simulatingProfile.name}
                </h2>
                <button
                  onClick={() => setSimulatingProfile(null)}
                  className="p-2 text-gray-500 hover:text-gray-700"
                >
                  <X size={20} />
                </button>
              </div>
              <ProfileSimulatorChartJS profile={simulatingProfile} height={400} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
