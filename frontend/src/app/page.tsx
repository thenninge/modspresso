'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Coffee, Settings, BarChart3, Play, Plus, SlidersHorizontal, X } from 'lucide-react';
import Image from 'next/image';
import ProfileEditor from '@/components/profile-editor';
import { VisualProfileEditor } from '@/components/visual-profile-editor';
import PressureChart from '@/components/pressure-chart';
import CalibrationPanel from '@/components/calibration-panel';
import ProfileSimulatorChartJS from '@/components/profile-simulator-chartjs';
import BluetoothSettings from '@/components/bluetooth-settings';
import { LiveBrewChart } from '@/components/live-brew-chart';
import { Profile } from '@/types';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { predefinedProfiles } from '@/data/default-profiles';
import { useWebBluetooth } from '@/hooks/use-web-bluetooth';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'brew' | 'profiles' | 'calibration' | 'settings'>('brew');
  const [showEditor, setShowEditor] = useState(false);
  const [showVisualEditor, setShowVisualEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | undefined>();
  const [simulatingProfile, setSimulatingProfile] = useState<Profile | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [selectedBrewProfile, setSelectedBrewProfile] = useState<string>('');
  
  // Use Web Bluetooth hook at top level to maintain connection across tab switches
  const bluetoothHook = useWebBluetooth();
  const bluetoothConnected = bluetoothHook.isConnected;
  const esp32Status = bluetoothHook.status;
  const liveBrewData = bluetoothHook.liveBrewData || [];

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

  // Auto-select running profile when it starts via button
  const isRunningGlobal = esp32Status?.is_running || false;
  const runningProfileGlobal = isRunningGlobal 
    ? profiles.find(p => {
        const isDefault1 = defaultProfile1 && p.id === defaultProfile1;
        const isDefault2 = defaultProfile2 && p.id === defaultProfile2;
        return isDefault1 || isDefault2;
      })
    : null;

  React.useEffect(() => {
    if (isRunningGlobal && runningProfileGlobal && (!selectedBrewProfile || selectedBrewProfile !== runningProfileGlobal.id)) {
      setSelectedBrewProfile(runningProfileGlobal.id);
    }
  }, [isRunningGlobal, runningProfileGlobal?.id, selectedBrewProfile]);

  const handleSaveProfile = (profile: Profile) => {
    if (editingProfile) {
      setProfiles(profiles.map(p => p.id === profile.id ? profile : p));
    } else {
      setProfiles([...profiles, profile]);
    }
    setShowEditor(false);
    setShowVisualEditor(false);
    setEditingProfile(undefined);
  };

  const handleEditProfile = useCallback((profile: Profile) => {
    const isPredefined = predefinedProfiles.some(p => p.id === profile.id);
    if (isPredefined) {
      // Create a copy of predefined profile with new ID
      const newProfile: Profile = {
        ...profile,
        id: `copy-${Date.now()}`,
        name: `${profile.name} (Kopi)`,
        createdAt: '2024-01-01T00:00:00.000Z' // Static date to avoid hydration issues
      };
      setEditingProfile(newProfile);
    } else {
      setEditingProfile(profile);
    }
    setShowEditor(true);
  }, []);

  const handleEditVisualProfile = useCallback((profile: Profile) => {
    const isPredefined = predefinedProfiles.some(p => p.id === profile.id);
    if (isPredefined) {
      // Create a copy of predefined profile with new ID
      const newProfile: Profile = {
        ...profile,
        id: `copy-${Date.now()}`,
        name: `${profile.name} (Kopi)`,
        createdAt: '2024-01-01T00:00:00.000Z' // Static date to avoid hydration issues
      };
      setEditingProfile(newProfile);
    } else {
      setEditingProfile(profile);
    }
    setShowVisualEditor(true);
  }, []);

  const handleDeleteProfile = useCallback((profileId: string) => {
    if (confirm('Er du sikker på at du vil slette denne profilen?')) {
      setProfiles(profiles.filter(p => p.id !== profileId));
    }
  }, [profiles, setProfiles]);

  const handleNewProfile = () => {
    setEditingProfile(undefined);
    setShowEditor(true);
  };

  const handleNewVisualProfile = () => {
    setEditingProfile(undefined);
    setShowVisualEditor(true);
  };

  // const handleClearAllProfiles = () => {
  //   if (confirm('Er du sikker på at du vil slette alle profiler?')) {
  //     setProfiles([]);
  //   }
  // };

  const handleStartProfile = useCallback(async (profile: Profile) => {
    if (!bluetoothHook.isConnected) {
      alert('Ikke tilkoblet til ESP32! Koble til via Innstillinger først.');
      return;
    }
    
    // If profile is already running, stop it instead
    if (esp32Status?.is_running) {
      try {
        await bluetoothHook.stopProfile();
        return;
      } catch (error) {
        console.error('Error stopping profile:', error);
        alert('Feil ved stopp av profil. Sjekk Serial Monitor for detaljer.');
        return;
      }
    }
    
    try {
      // Check if profile is assigned to a button - if so, we know the ESP32 ID
      let esp32ProfileId: number | null = null;
      if (profile.id === defaultProfile1) {
        esp32ProfileId = 1; // Button 1 profiles get ID 1 on ESP32
      } else if (profile.id === defaultProfile2) {
        esp32ProfileId = 2; // Button 2 profiles get ID 2 on ESP32
      }
      
      if (esp32ProfileId !== null) {
        // Profile is synced to ESP32 - start it by ID (more efficient)
        console.log(`Starting synced profile by ID: ${profile.name} (ESP32 ID: ${esp32ProfileId})`);
        await bluetoothHook.startProfileById(esp32ProfileId);
      } else {
        // Profile not synced or not assigned to button - send full profile
        console.log('Starting profile with full data:', profile.name);
        await bluetoothHook.startProfile({
          name: profile.name,
          segments: profile.segments
        });
      }
    } catch (error) {
      console.error('Error starting profile:', error);
      alert('Feil ved start av profil. Sjekk Serial Monitor for detaljer.');
    }
  }, [bluetoothHook, esp32Status, defaultProfile1, defaultProfile2]);

  const handleSyncProfiles = async () => {
    if (!bluetoothHook.isConnected) {
      alert('Ikke tilkoblet til ESP32! Koble til via Innstillinger først.');
      return;
    }
    
    if (profiles.length === 0) {
      alert('Ingen profiler å synkronisere');
      return;
    }
    
    // Ask user if they want to clear existing profiles first
    const clearFirst = confirm(
      'Vil du slette alle eksisterende profiler på ESP32 før synkronisering?\n\n' +
      'Ja = Slett alle gamle profiler først (anbefalt)\n' +
      'Nei = Overskriv kun profiler med samme ID'
    );
    
    try {
      // Clear all profiles on ESP32 if user requested
      if (clearFirst) {
        await bluetoothHook.clearAllProfiles();
        await new Promise(resolve => setTimeout(resolve, 200)); // Wait a bit after clearing
      }
      // First, send profiles assigned to buttons 1 and 2 with their button IDs
      // Profiles assigned to button 1 get ID 1, button 2 gets ID 2
      if (defaultProfile1) {
        const profile1 = profiles.find(p => p.id === defaultProfile1);
        if (profile1) {
          await bluetoothHook.storeProfile(1, {
            id: 1,
            name: profile1.name,
            segments: profile1.segments
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (defaultProfile2) {
        const profile2 = profiles.find(p => p.id === defaultProfile2);
        if (profile2) {
          await bluetoothHook.storeProfile(2, {
            id: 2,
            name: profile2.name,
            segments: profile2.segments
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Then send other profiles with auto-incremented IDs (skip 1 and 2 if used)
      let esp32Id = 0;
      for (let i = 0; i < Math.min(profiles.length, 10); i++) {
        const profile = profiles[i];
        
        // Skip if this profile is assigned to button 1 or 2 (already sent above)
        if (profile.id === defaultProfile1 || profile.id === defaultProfile2) {
          continue;
        }
        
        // Skip IDs 1 and 2 if they're taken by button assignments
        while (esp32Id === 1 || esp32Id === 2 || (esp32Id === 1 && defaultProfile1) || (esp32Id === 2 && defaultProfile2)) {
          esp32Id++;
        }
        
        if (esp32Id >= 10) break; // Maximum 10 profiles
        
        await bluetoothHook.storeProfile(esp32Id, {
          id: esp32Id,
          name: profile.name,
          segments: profile.segments
        });
        // Small delay between profiles
        await new Promise(resolve => setTimeout(resolve, 100));
        esp32Id++;
      }
      
      // Set default profiles to use IDs 1 and 2
      if (defaultProfile1) {
        await bluetoothHook.setDefaultProfileForButton(1, 1);
      }
      
      if (defaultProfile2) {
        await bluetoothHook.setDefaultProfileForButton(2, 2);
      }
      
      alert(`✅ Synkronisert ${profiles.length} profiler til ESP32!\n\nProfiler tilegnet knapp 1 og 2 har fått ID 1 og 2 på ESP32.`);
    } catch (error) {
      console.error('Error syncing profiles:', error);
      alert('Feil ved synkronisering av profiler. Sjekk Serial Monitor for detaljer.');
    }
  };


  const handleSetDefaultProfile = useCallback(async (profileId: string, button: 1 | 2) => {
    if (button === 1) {
      // Toggle: if already set to this profile, clear it
      const newProfileId = defaultProfile1 === profileId ? '' : profileId;
      setDefaultProfile1(newProfileId);
      
      // Sync to ESP32 - profile assigned to button 1 gets ID 1
      if (bluetoothHook.isConnected && newProfileId) {
        const profile = profiles.find(p => p.id === newProfileId);
        if (profile) {
          // Store profile with ID 1 on ESP32
          await bluetoothHook.storeProfile(1, {
            id: 1,
            name: profile.name,
            segments: profile.segments
          });
          // Set button 1 to use profile ID 1
          await bluetoothHook.setDefaultProfileForButton(1, 1);
        }
      } else if (bluetoothHook.isConnected && !newProfileId) {
        // Clear button assignment
        await bluetoothHook.setDefaultProfileForButton(1, 255); // 255 = no profile
      }
    } else {
      // Toggle: if already set to this profile, clear it
      const newProfileId = defaultProfile2 === profileId ? '' : profileId;
      setDefaultProfile2(newProfileId);
      
      // Sync to ESP32 - profile assigned to button 2 gets ID 2
      if (bluetoothHook.isConnected && newProfileId) {
        const profile = profiles.find(p => p.id === newProfileId);
        if (profile) {
          // Store profile with ID 2 on ESP32
          await bluetoothHook.storeProfile(2, {
            id: 2,
            name: profile.name,
            segments: profile.segments
          });
          // Set button 2 to use profile ID 2
          await bluetoothHook.setDefaultProfileForButton(2, 2);
        }
      } else if (bluetoothHook.isConnected && !newProfileId) {
        // Clear button assignment
        await bluetoothHook.setDefaultProfileForButton(2, 255); // 255 = no profile
      }
    }
  }, [bluetoothHook, profiles, defaultProfile1, defaultProfile2, setDefaultProfile1, setDefaultProfile2]);

  const handleCalibrationComplete = async (calibrationData: Record<number, number>) => {
    // Save to localStorage
    localStorage.setItem('modspresso-calibration', JSON.stringify(calibrationData));
    
    // Send to ESP32 if connected
    if (bluetoothHook.isConnected) {
      try {
        await bluetoothHook.setCalibrationData(calibrationData);
        alert('✅ Kalibrering fullført og synkronisert til ESP32!');
      } catch (error) {
        console.error('Error sending calibration to ESP32:', error);
        alert('Kalibrering lagret lokalt, men kunne ikke synkroniseres til ESP32.');
      }
    } else {
      alert('Kalibrering fullført! Data er lagret lokalt og vil synkroniseres automatisk når du kobler til ESP32.');
    }
    console.log('Calibration completed:', calibrationData);
  };

  // Load-only predefined profiles on demand (main view shows only local profiles)
  const handleLoadPredefined = () => {
    if (confirm('Vil du laste inn predefined profiler?')) {
      const existingIds = new Set(profiles.map(p => p.id));
      const toAdd = predefinedProfiles
        .filter(p => !existingIds.has(p.id))
        .map(p => ({ ...p, createdAt: '2024-01-01T00:00:00.000Z' })); // Static date to avoid hydration issues
      setProfiles([...profiles, ...toAdd]);
      alert(`${toAdd.length} profiler lagt til.`);
    }
  };

  // Memoize default profile names to prevent recalculation on each render
  const defaultProfile1Name = useMemo(() => {
    return isMounted && defaultProfile1 ? profiles.find(p => p.id === defaultProfile1)?.name || 'Ukjent' : 'Ikke satt';
  }, [isMounted, defaultProfile1, profiles]);

  const defaultProfile2Name = useMemo(() => {
    return isMounted && defaultProfile2 ? profiles.find(p => p.id === defaultProfile2)?.name || 'Ukjent' : 'Ikke satt';
  }, [isMounted, defaultProfile2, profiles]);

  // Separate component for Brew/Stop button to prevent re-rendering charts when status changes
  const BrewButton = React.memo(({ profile, onStartProfile }: { profile: Profile; onStartProfile: (profile: Profile) => void }) => {
    const isRunning = bluetoothHook.status?.is_running ?? false;
    return (
      <div className="flex space-x-2">
        {isRunning ? (
          <button 
            onClick={() => onStartProfile(profile)}
            className="flex items-center px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            <X size={14} className="mr-1" />
            Stop
          </button>
        ) : (
          <button 
            onClick={() => onStartProfile(profile)}
            className="flex items-center px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
          >
            <Play size={14} className="mr-1" />
            Brew
          </button>
        )}
      </div>
    );
  }, (prevProps, nextProps) => {
    // Only re-render if profile ID changed
    return prevProps.profile.id === nextProps.profile.id && prevProps.onStartProfile === nextProps.onStartProfile;
  });
  BrewButton.displayName = 'BrewButton';

  const ProfileRunButton = React.memo(({ profile, onStartProfile, onSimulate }: { 
    profile: Profile; 
    onStartProfile: (profile: Profile) => void;
    onSimulate: (profile: Profile) => void;
  }) => {
    const isRunning = bluetoothHook.status?.is_running ?? false;
    return (
      <div className="flex space-x-2">
        {isRunning ? (
          <button 
            onClick={() => onStartProfile(profile)}
            className="flex items-center px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            <X size={14} className="mr-1" />
            Stop
          </button>
        ) : (
          <button 
            onClick={() => onStartProfile(profile)}
            className="flex items-center px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
          >
            <Play size={14} className="mr-1" />
            Kjør
          </button>
        )}
        <button
          onClick={() => onSimulate(profile)}
          className="flex items-center px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600"
        >
          <BarChart3 size={14} className="mr-1" />
          Simuler
        </button>
      </div>
    );
  }, (prevProps, nextProps) => {
    // Only re-render if profile ID changed
    return prevProps.profile.id === nextProps.profile.id && 
           prevProps.onStartProfile === nextProps.onStartProfile && 
           prevProps.onSimulate === nextProps.onSimulate;
  });
  ProfileRunButton.displayName = 'ProfileRunButton';

  // Memoize profile cards to prevent re-rendering charts when only bluetooth status changes
  const brewProfileCards = useMemo(() => {
    return profiles.map((profile) => {
      const isPredefined = predefinedProfiles.some(p => p.id === profile.id) && !profiles.some(p => p.id === profile.id);
      return (
        <div key={profile.id} className={`rounded-lg shadow-md p-6 ${isPredefined ? 'bg-blue-50 border border-blue-200' : 'bg-white'}`}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-800">{profile.name}</h3>
                {isPredefined && (
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
            {!isPredefined && (
              <div className="flex space-x-1">
                <button
                  onClick={() => handleSetDefaultProfile(profile.id, 1)}
                  className={`px-2 py-1 text-xs rounded ${
                    defaultProfile1 === profile.id 
                      ? 'bg-blue-500 text-white hover:bg-blue-600' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  title={defaultProfile1 === profile.id ? "Fjern fra default profil 1" : "Sett som default profil 1"}
                >
                  1
                </button>
                <button
                  onClick={() => handleSetDefaultProfile(profile.id, 2)}
                  className={`px-2 py-1 text-xs rounded ${
                    defaultProfile2 === profile.id 
                      ? 'bg-blue-500 text-white hover:bg-blue-600' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  title={defaultProfile2 === profile.id ? "Fjern fra default profil 2" : "Sett som default profil 2"}
                >
                  2
                </button>
              </div>
            )}
            <BrewButton profile={profile} onStartProfile={handleStartProfile} />
          </div>
        </div>
      );
    });
  }, [profiles, defaultProfile1, defaultProfile2, handleSetDefaultProfile, handleStartProfile, BrewButton]);

  // Memoize profiles tab profile cards
  const profilesTabCards = useMemo(() => {
    return profiles.map((profile) => {
      const isPredefined = predefinedProfiles.some(p => p.id === profile.id) && !profiles.some(p => p.id === profile.id);
      return (
        <div key={profile.id} className={`rounded-lg shadow-md p-6 ${isPredefined ? 'bg-blue-50 border border-blue-200' : 'bg-white'}`}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-800">{profile.name}</h3>
                {isPredefined && (
                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">Forhåndsdefinert</span>
                )}
              </div>
              <p className="text-sm text-gray-600">{profile.description}</p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => handleEditProfile(profile)}
                className="p-2 text-blue-500 hover:bg-blue-50 rounded"
                title={isPredefined ? "Kopier og rediger" : "Rediger profil"}
              >
                <Settings size={16} />
              </button>
              <button
                onClick={() => handleEditVisualProfile(profile)}
                className="p-2 text-purple-500 hover:bg-purple-50 rounded"
                title={isPredefined ? "Kopier og rediger visuelt" : "Rediger profil visuelt"}
              >
                <BarChart3 size={16} />
              </button>
              {!isPredefined && (
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
            <ProfileRunButton 
              profile={profile} 
              onStartProfile={handleStartProfile}
              onSimulate={setSimulatingProfile}
            />
          </div>
        </div>
      );
    });
  }, [profiles, handleEditProfile, handleEditVisualProfile, handleDeleteProfile, handleStartProfile]);

  const renderBrewTab = () => {
    // Find currently running profile
    const isRunning = esp32Status?.is_running || false;
    const runningProfile = isRunning 
      ? profiles.find(p => {
          const isDefault1 = defaultProfile1 && p.id === defaultProfile1;
          const isDefault2 = defaultProfile2 && p.id === defaultProfile2;
          return isDefault1 || isDefault2;
        })
      : null;

    // Determine which profile to display in the chart
    // If running, use the running profile; otherwise use selected profile
    const displayedProfile = isRunning && runningProfile 
      ? runningProfile 
      : selectedBrewProfile 
        ? profiles.find(p => p.id === selectedBrewProfile) || null
        : null;

    return (
      <div className="space-y-6">
        {/* Large profile chart at the top */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="mb-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-800">Bryggeprofil</h2>
              <div className="flex items-center space-x-4">
                {/* Profile selector dropdown */}
                <div className="flex items-center space-x-2">
                  <label htmlFor="profile-select" className="text-sm font-medium text-gray-700">
                    Velg profil:
                  </label>
                  <select
                    id="profile-select"
                    value={displayedProfile?.id || ''}
                    onChange={(e) => {
                      const profileId = e.target.value;
                      setSelectedBrewProfile(profileId);
                      // Stop current profile if selecting a new one
                      if (isRunning && bluetoothHook.isConnected) {
                        bluetoothHook.stopProfile();
                      }
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    disabled={isRunning}
                  >
                    <option value="">-- Velg profil --</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                {/* Start/Stop button */}
                {displayedProfile && (
                  <button
                    onClick={() => {
                      if (isRunning) {
                        bluetoothHook.stopProfile();
                      } else {
                        handleStartProfile(displayedProfile);
                      }
                    }}
                    disabled={!bluetoothHook.isConnected}
                    className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      isRunning
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-green-500 text-white hover:bg-green-600'
                    } disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed`}
                  >
                    {isRunning ? (
                      <>
                        <X size={16} className="mr-2" />
                        Stopp
                      </>
                    ) : (
                      <>
                        <Play size={16} className="mr-2" />
                        Start Brygging
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Show button status if not running */}
            {!isRunning && (
              <div className="flex space-x-4 text-sm text-gray-600 mb-4">
                <div className="flex items-center">
                  <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
                  Knapp 1 (SW1): {defaultProfile1Name}
                </div>
                <div className="flex items-center">
                  <span className="w-3 h-3 rounded-full bg-green-500 mr-2"></span>
                  Knapp 2 (SW2): {defaultProfile2Name}
                </div>
              </div>
            )}
          </div>

          {/* Large chart - shows live data when running, target curve when not */}
          {displayedProfile ? (
            <div>
              {isRunning && liveBrewData && liveBrewData.length > 0 ? (
                <LiveBrewChart 
                  profile={displayedProfile}
                  liveData={liveBrewData}
                  isRunning={true}
                  height={500}
                />
              ) : (
                <div>
                  <div className="mb-2 text-sm text-gray-600">
                    Målprofil: {displayedProfile.name}
                  </div>
                  <PressureChart segments={displayedProfile.segments} height={500} showArea={true} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg" style={{ height: 500 }}>
              <div className="text-center text-gray-500">
                <Coffee className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Ingen profil valgt</h3>
                <p className="text-gray-600">Velg en profil fra nedtrekksmenyen for å starte brygging</p>
              </div>
            </div>
          )}
        </div>

        {/* Info section */}
        {!isMounted ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <div className="text-gray-500">
              <Coffee className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Laster profiler...</h3>
              <p className="text-gray-600">Venter på data</p>
            </div>
          </div>
        ) : profiles.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <div className="text-gray-500">
              <Coffee className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Ingen profiler ennå</h3>
              <p className="text-gray-600">Gå til Profiler-fanen for å opprette eller laste inn profiler</p>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderProfilesTab = () => (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleNewProfile}
            className="flex items-center justify-center px-3 py-1.5 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm"
          >
            <Plus size={16} className="mr-2" />
            Ny Profil
          </button>
          <button
            onClick={handleSyncProfiles}
            className="flex items-center justify-center px-3 py-1.5 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors text-sm"
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Synkroniser
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleLoadPredefined}
            className="flex items-center justify-center px-3 py-1.5 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 transition-colors text-sm"
          >
            Predefinerte
          </button>
          <button
            onClick={handleNewVisualProfile}
            className="flex items-center justify-center px-3 py-1.5 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors text-sm"
          >
            <BarChart3 size={16} className="mr-2" />
            Visuell Editor
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {!isMounted ? (
          // Server-side: Always show loading state
          <div className="col-span-full text-center py-12">
            <div className="text-gray-500 mb-4">
              <Coffee className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Laster profiler...</h3>
              <p className="text-gray-600">Venter på data</p>
            </div>
          </div>
        ) : profiles.length === 0 ? (
          // Client-side: Show empty state
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
          profilesTabCards
        )}
      </div>
    </div>
  );

  const renderCalibrationTab = () => (
    <CalibrationPanel onComplete={handleCalibrationComplete} bluetoothHook={bluetoothHook} />
  );

  const renderSettingsTab = () => (
    <BluetoothSettings onConnectionChange={() => {/* Connection state is managed by hook */}} bluetoothHook={bluetoothHook} />
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Image src="/icon2.png" alt="Modspresso" width={48} height={32} className="mr-3" />
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
        ) : showVisualEditor ? (
          <VisualProfileEditor
            profile={editingProfile}
            onSave={handleSaveProfile}
            onCancel={() => {
              setShowVisualEditor(false);
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
