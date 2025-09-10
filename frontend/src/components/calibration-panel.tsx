'use client';

import React, { useState } from 'react';
import { Play, Square, RotateCcw, Save, AlertTriangle, CheckCircle, Send, Download, TestTube, Clock } from 'lucide-react';
import { useWebBluetooth } from '@/hooks/use-web-bluetooth';
import CalibrationChart from './calibration-chart';

interface CalibrationStep {
  dimLevel: number;
  pressure: number | null;
  isRunning: boolean;
  completed: boolean;
}

interface CalibrationPanelProps {
  onComplete: (calibrationData: Record<number, number>) => void;
}

export const CalibrationPanel: React.FC<CalibrationPanelProps> = ({ onComplete }) => {
  const [steps, setSteps] = useState<CalibrationStep[]>([]);
  const [isTestingPressureCurve, setIsTestingPressureCurve] = useState(false);
  const [currentTestPressure, setCurrentTestPressure] = useState<number | null>(null);
  const [testDurationPerPressure, setTestDurationPerPressure] = useState<number>(3);
  const { isConnected, setDimLevel, setCalibrationData, status } = useWebBluetooth();

  // Load saved calibration data from localStorage
  React.useEffect(() => {
    const savedCalibration = localStorage.getItem('modspresso-calibration');
    if (savedCalibration) {
      try {
        const savedData = JSON.parse(savedCalibration);
        const newSteps: CalibrationStep[] = [];
        for (let i = 1; i <= 10; i++) {
          const dimLevel = i * 10;
          const savedPressure = savedData[dimLevel];
          newSteps.push({
            dimLevel,
            pressure: savedPressure !== undefined ? savedPressure : null,
            isRunning: false,
            completed: savedPressure !== undefined
          });
        }
        setSteps(newSteps);
      } catch (error) {
        console.error('Failed to load saved calibration:', error);
        // Fallback to empty steps
        initializeEmptySteps();
      }
    } else {
      initializeEmptySteps();
    }
  }, []);

  const initializeEmptySteps = () => {
    const newSteps: CalibrationStep[] = [];
    for (let i = 1; i <= 10; i++) {
      newSteps.push({
        dimLevel: i * 10, // 10%, 20%, 30%, ..., 100%
        pressure: null,
        isRunning: false,
        completed: false
      });
    }
    setSteps(newSteps);
  };

  const startDimLevel = async (dimLevel: number) => {
    // Stop all other dim levels first
    const updatedSteps = steps.map(step => ({
      ...step,
      isRunning: step.dimLevel === dimLevel
    }));
    setSteps(updatedSteps);
    
    // Send command to ESP32 via WebSocket
    await setDimLevel(dimLevel);
    console.log(`Starting dim level ${dimLevel}%`);
  };

  const stopDimLevel = async (dimLevel: number) => {
    const updatedSteps = steps.map(step => ({
      ...step,
      isRunning: false
    }));
    setSteps(updatedSteps);
    
    // Send command to ESP32 via WebSocket
    await setDimLevel(0);
    console.log(`Stopping dim level ${dimLevel}%`);
  };

  const setPressure = (dimLevel: number, pressure: number) => {
    const updatedSteps = steps.map(step => 
      step.dimLevel === dimLevel 
        ? { ...step, pressure, completed: true }
        : step
    );
    setSteps(updatedSteps);
    
    // Save to localStorage
    saveCalibrationToStorage(updatedSteps);
  };

  const saveCalibrationToStorage = (currentSteps: CalibrationStep[]) => {
    const calibrationData: Record<number, number> = {};
    currentSteps.forEach(step => {
      if (step.pressure !== null) {
        calibrationData[step.dimLevel] = step.pressure;
      }
    });
    
    localStorage.setItem('modspresso-calibration', JSON.stringify(calibrationData));
  };

  const resetCalibration = () => {
    const newSteps: CalibrationStep[] = [];
    for (let i = 1; i <= 10; i++) {
      newSteps.push({
        dimLevel: i * 10,
        pressure: null,
        isRunning: false,
        completed: false
      });
    }
    setSteps(newSteps);
    
    // Clear localStorage
    localStorage.removeItem('modspresso-calibration');
  };

  const loadDefaultCalibration = () => {
    const defaultCalibration: Record<number, number> = {
      0: 0,    // 0% → 0 bar
      10: 1,   // 10% → 1 bar
      20: 2,   // 20% → 2 bar
      30: 3,   // 30% → 3 bar
      40: 5,   // 40% → 5 bar
      50: 6.5, // 50% → 6.5 bar
      60: 7.5, // 60% → 7.5 bar
      70: 9,   // 70% → 9 bar
      80: 9,   // 80% → 9 bar
      90: 9,   // 90% → 9 bar
      100: 9   // 100% → 9 bar
    };

    const newSteps: CalibrationStep[] = [];
    for (let i = 1; i <= 10; i++) {
      const dimLevel = i * 10;
      const pressure = defaultCalibration[dimLevel];
      newSteps.push({
        dimLevel,
        pressure,
        isRunning: false,
        completed: pressure !== undefined
      });
    }
    setSteps(newSteps);
    
    // Save to localStorage
    saveCalibrationToStorage(newSteps);
    
    console.log('Default calibration loaded:', defaultCalibration);
  };

  const completeCalibration = () => {
    const calibrationData: Record<number, number> = {};
    steps.forEach(step => {
      if (step.pressure !== null) {
        calibrationData[step.dimLevel] = step.pressure;
      }
    });
    onComplete(calibrationData);
  };

  const sendToESP32 = async () => {
    const calibrationData: Record<number, number> = {};
    steps.forEach(step => {
      if (step.pressure !== null) {
        calibrationData[step.dimLevel] = step.pressure;
      }
    });
    
    if (Object.keys(calibrationData).length === 0) {
      alert('Ingen kalibreringsdata å sende!');
      return;
    }
    
    // Show loading state
    const loadingMessage = 'Sender kalibreringsdata til ESP32...';
    alert(loadingMessage);
    
    // Send calibration data to ESP32 via WebSocket
    await setCalibrationData(calibrationData);
    
    console.log('Sending calibration data to ESP32:', calibrationData);
  };

  const testPressureCurve = async () => {
    // Check if we have calibration data
    const calibrationData: Record<number, number> = {};
    steps.forEach(step => {
      if (step.pressure !== null) {
        calibrationData[step.dimLevel] = step.pressure;
      }
    });
    
    if (Object.keys(calibrationData).length === 0) {
      alert('Ingen kalibreringsdata tilgjengelig! Kalibrer systemet først.');
      return;
    }

    if (!isConnected) {
      alert('Ikke tilkoblet backend! Sjekk tilkobling.');
      return;
    }

    setIsTestingPressureCurve(true);
    
    // Test pressure levels from 0 to 10 bars
    const testPressures = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    
    for (let i = 0; i < testPressures.length; i++) {
      const targetPressure = testPressures[i];
      setCurrentTestPressure(targetPressure);
      
      // Calculate required dim level for this pressure using calibration data
      const requiredDimLevel = calculateDimLevelForPressure(targetPressure, calibrationData);
      
      console.log(`Testing pressure ${targetPressure} bar -> Dim level: ${requiredDimLevel}%`);
      
      // Send command to ESP32 to set the dim level
      sendMessage({
        type: 'set_dim_level',
        data: { level: requiredDimLevel }
      });
      
      // Wait for user-specified duration at each pressure level
      await new Promise(resolve => setTimeout(resolve, testDurationPerPressure * 1000));
    }
    
    // Stop the pump at the end
    await setDimLevel(0);
    
    setCurrentTestPressure(null);
    setIsTestingPressureCurve(false);
    
    alert(`✅ Trykk-kurve test fullført!\n\nPumpen har kjørt gjennom alle trykknivåer 0-10 bar.\nHver trykknivå ble testet i ${testDurationPerPressure} sekunder.\nSjekk manometeret for å verifisere at kalibreringen er korrekt.`);
  };

  const calculateDimLevelForPressure = (targetPressure: number, calibrationData: Record<number, number>): number => {
    if (targetPressure === 0) return 0;
    
    // Find the closest calibration points for interpolation
    const levels = Object.keys(calibrationData).map(Number).sort((a, b) => a - b);
    
    if (levels.length === 0) return 0;
    
    // Find exact match
    if (calibrationData[targetPressure] !== undefined) {
      return targetPressure;
    }
    
    // Find bounds for interpolation
    let lowerLevel = levels[0];
    let upperLevel = levels[levels.length - 1];
    
    for (let i = 0; i < levels.length - 1; i++) {
      if (targetPressure >= levels[i] && targetPressure <= levels[i + 1]) {
        lowerLevel = levels[i];
        upperLevel = levels[i + 1];
        break;
      }
    }
    
    const lowerPressure = calibrationData[lowerLevel];
    const upperPressure = calibrationData[upperLevel];
    
    // Interpolate to find the dim level that would produce targetPressure
    if (upperLevel === lowerLevel) return lowerLevel;
    
    const pressureRatio = (targetPressure - lowerPressure) / (upperPressure - lowerPressure);
    const interpolatedLevel = lowerLevel + pressureRatio * (upperLevel - lowerLevel);
    
    // Round to nearest 5% for practical use
    return Math.round(interpolatedLevel / 5) * 5;
  };

  const completedSteps = steps.filter(step => step.completed).length;
  const progress = (completedSteps / steps.length) * 100;

  // Convert steps to calibration data format
  const calibrationData: Record<number, number> = {};
  steps.forEach(step => {
    if (step.pressure !== null) {
      calibrationData[step.dimLevel] = step.pressure;
    }
  });

  // Get last uploaded calibration data
  const [lastUploaded, setLastUploaded] = useState<{data: Record<number, number>, timestamp: string} | null>(null);
  
  React.useEffect(() => {
    const uploaded = localStorage.getItem('modspresso-calibration-uploaded');
    if (uploaded) {
      try {
        setLastUploaded(JSON.parse(uploaded));
      } catch (error) {
        console.error('Failed to load last uploaded calibration:', error);
      }
    }
  }, []);

  // Handle calibration status updates from ESP32
  React.useEffect(() => {
    if (status && status.is_calibrated) {
      // ESP32 is calibrated - we can show success message
      const completedSteps = steps.filter(step => step.completed).length;
      if (completedSteps > 0) {
        console.log(`✅ ESP32 kalibrert med ${completedSteps} punkter`);
      }
    }
  }, [status, steps]);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Trykk-kalibrering</h2>
        <p className="text-gray-600">
          Kalibrer dim-level til trykk ved å teste hver setting og registrere manometer-avlesning.
        </p>
        <div className="flex items-center mt-2">
          <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm text-gray-600">
            {isConnected ? 'Tilkoblet backend' : 'Ikke tilkoblet backend'}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      {steps.length > 0 && (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">
              Fremdrift: {completedSteps} av {steps.length} steg
            </span>
            <span className="text-sm text-gray-500">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Control Buttons */}
      <div className="flex space-x-3 mb-6">
        <button
          onClick={completeCalibration}
          disabled={completedSteps === 0}
          className="flex items-center px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={16} className="mr-2" />
          Lagre
        </button>
        <button
          onClick={sendToESP32}
          disabled={completedSteps === 0}
          className="flex items-center px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={16} className="mr-2" />
          Send
        </button>
        <button
          onClick={loadDefaultCalibration}
          className="flex items-center px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors"
        >
          <Download size={16} className="mr-2" />
          Default
        </button>
        <button
          onClick={resetCalibration}
          className="flex items-center px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
        >
          <RotateCcw size={16} className="mr-2" />
          Nullstill
        </button>
      </div>

      {/* Calibration Fields */}
      {steps.length > 0 && (
        <div className="space-y-4 mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Kalibreringsfelter</h3>
          {steps.map((step) => (
            <div 
              key={step.dimLevel}
              className={`p-4 border rounded-lg ${
                step.isRunning 
                  ? 'border-blue-500 bg-blue-50' 
                  : step.completed 
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4 flex-1">
                  <div className="w-16 text-sm font-medium text-gray-700">
                    {step.dimLevel}% Output
                  </div>
                  <div className="flex items-center space-x-2 flex-1">
                    <span className="text-sm text-gray-600">Trykk:</span>
                    <input
                      type="number"
                      value={step.pressure || ''}
                      onChange={(e) => setPressure(step.dimLevel, parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-black"
                      placeholder="0.0"
                      min="0"
                      max="12"
                      step="0.1"
                      disabled={step.isRunning}
                    />
                    <span className="text-sm text-gray-500">bar</span>
                    {step.completed && (
                      <CheckCircle size={16} className="text-green-500" />
                    )}
                  </div>
                </div>
                <div className="flex space-x-2">
                  {!step.isRunning ? (
                    <button
                      onClick={() => startDimLevel(step.dimLevel)}
                      className="flex items-center px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors"
                    >
                      <Play size={14} className="mr-1" />
                      Start
                    </button>
                  ) : (
                    <button
                      onClick={() => stopDimLevel(step.dimLevel)}
                      className="flex items-center px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors"
                    >
                      <Square size={14} className="mr-1" />
                      Stopp
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Last Uploaded Calibration Info */}
      {lastUploaded && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Sist opplastet til ESP32:</h3>
          <div className="text-xs text-blue-600 mb-2">
            {new Date(lastUploaded.timestamp).toLocaleString('nb-NO')}
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(lastUploaded.data).map(([dimLevel, pressure]) => (
              <span key={dimLevel} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                {dimLevel}%: {pressure} bar
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Calibration Chart */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">Kalibrerings-kurve</h3>
        <CalibrationChart 
          calibrationData={calibrationData}
          onPointClick={(dimLevel, pressure) => {
            console.log(`Klikket på ${dimLevel}% → ${pressure} bar`);
          }}
        />
      </div>

      {/* Test Pressure Curve Section */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-semibold text-blue-800 mb-3">Test Trykk-kurve</h3>
        
        {/* Test Duration Setting */}
        <div className="mb-4 p-3 bg-white border border-blue-200 rounded-lg">
          <div className="flex items-center space-x-3">
            <Clock size={20} className="text-blue-600" />
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">
                Test varighet per trykknivå:
              </label>
              <input
                type="number"
                value={testDurationPerPressure}
                onChange={(e) => setTestDurationPerPressure(Math.max(1, Math.min(60, parseInt(e.target.value) || 3)))}
                className="w-16 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-black"
                min="1"
                max="60"
                step="1"
                disabled={isTestingPressureCurve}
              />
              <span className="text-sm text-gray-600">sekunder</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Hvor lenge pumpen skal kjøre ved hvert trykknivå under testingen
          </p>
        </div>

        {/* Test Button */}
        <div className="flex justify-center">
          <button
            onClick={testPressureCurve}
            disabled={completedSteps === 0 || isTestingPressureCurve}
            className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-lg font-medium"
          >
            <TestTube size={20} className="mr-3" />
            {isTestingPressureCurve ? 'Tester...' : 'Start Trykk-kurve Test'}
          </button>
        </div>

        {/* Current Test Pressure Display */}
        {isTestingPressureCurve && currentTestPressure !== null && (
          <div className="mt-4 p-3 bg-blue-100 border border-blue-300 rounded-lg">
            <div className="flex items-center justify-center">
              <div className="animate-pulse mr-3">
                <div className="w-4 h-4 bg-blue-600 rounded-full"></div>
              </div>
              <span className="text-lg font-semibold text-blue-800">
                Tester trykk: {currentTestPressure} bar
              </span>
            </div>
            <p className="text-sm text-blue-700 text-center mt-2">
              Pumpen kjører automatisk gjennom alle trykknivåer 0-10 bar ({testDurationPerPressure}s per nivå)
            </p>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start">
          <AlertTriangle size={20} className="text-yellow-600 mr-3 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-yellow-800 mb-1">Instruksjoner</h4>
            <ul className="text-sm text-yellow-700 space-y-1">
              <li>• Koble ESP32 til strøm og last opp firmware</li>
              <li>• Koble manometeret til trykksystemet</li>
              <li>• Start kalibrering for å initialisere feltene</li>
              <li>• Klikk "Start" for hver Output-verdi du vil teste</li>
              <li>• Les av trykket på manometeret og registrer verdien</li>
              <li>• Klikk "Stopp" når du er ferdig med testingen</li>
              <li>• Gjenta for alle Output-verdier du vil kalibrere</li>
              <li>• Klikk "Lagre" når du er ferdig</li>
              <li>• Juster test-varighet og bruk "Test Trykk-kurve" for å verifisere kalibreringen</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalibrationPanel;
