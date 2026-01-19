'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Bluetooth, WifiOff, RefreshCw, CheckCircle, XCircle, AlertCircle, Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import type { useWebBluetooth } from '@/hooks/use-web-bluetooth';

interface BluetoothDevice {
  id: string;
  name: string;
}

interface BluetoothSettingsProps {
  onConnectionChange?: (connected: boolean) => void;
  bluetoothHook: ReturnType<typeof useWebBluetooth>;
}

export const BluetoothSettings: React.FC<BluetoothSettingsProps> = ({ 
  onConnectionChange,
  bluetoothHook
}) => {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [pinConfigExpanded, setPinConfigExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  
  // Use Web Bluetooth hook
  const {
    isSupported,
    isConnected,
    device,
    status,
    error,
    isScanning,
    serialLogs,
    scanForDevices,
    connectToDevice,
    disconnect,
    getStatus,
    sendSerialCommand
  } = bluetoothHook;

  const [serialInput, setSerialInput] = useState('');
  
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [serialLogs]);

  // Update parent component when connection changes
  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  // Debug: Log when status changes
  useEffect(() => {
    console.log('Status changed in BluetoothSettings:', status);
  }, [status]);

  // Debug: Log when serialLogs changes
  useEffect(() => {
    console.log('serialLogs changed in BluetoothSettings:', serialLogs.length, 'entries');
  }, [serialLogs]);

  const handleScanDevices = async () => {
    const foundDevices = await scanForDevices();
    setDevices(foundDevices);
  };

  const handleSendSerial = async () => {
    if (!serialInput.trim() || !isConnected) return;
    
    const command = serialInput.trim();
    setSerialInput(''); // Clear input
    
    await sendSerialCommand(command);
  };

  const handleConnect = async () => {
    const success = await connectToDevice();
    if (success) {
      // Device connected successfully
      // Get initial status
      await getStatus();
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    // Device disconnected
    setDevices([]);
  };

  const getConnectionStatusIcon = () => {
    if (!isSupported) return <XCircle className="w-5 h-5 text-red-500" />;
    if (isConnected) return <CheckCircle className="w-5 h-5 text-green-500" />;
    if (isScanning) return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
    return <XCircle className="w-5 h-5 text-gray-400" />;
  };

  const getConnectionStatusText = () => {
    if (!isSupported) return 'Web Bluetooth ikke støttet';
    if (isConnected) return 'Tilkoblet til ESP32';
    if (isScanning) return 'Søker etter enheter...';
    return 'Ikke tilkoblet';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Bluetooth className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-800">Bluetooth-innstillinger</h2>
          </div>
          <div className="flex items-center space-x-2">
            {getConnectionStatusIcon()}
            <span className="text-sm font-medium text-gray-600">
              {getConnectionStatusText()}
            </span>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-sm text-red-700">{error}</span>
          </div>
        </div>
      )}

      {/* Device Status */}
      {isConnected && device && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <div>
                <h3 className="text-sm font-medium text-green-800">Tilkoblet til ESP32</h3>
                <p className="text-xs text-green-600">Enhet: {device.name}</p>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200 transition-colors"
            >
              Koble fra
            </button>
          </div>
        </div>
      )}

      {/* ESP32 Status */}
      {isConnected && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-800">ESP32 Status</h3>
            <button
              onClick={async () => {
                await getStatus();
              }}
              disabled={!isConnected}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Hent status</span>
            </button>
          </div>
          {status ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Trykk:</span>
                  <span className="font-medium">{status.current_pressure} bar</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Kjører:</span>
                  <span className={`font-medium ${status.is_running ? 'text-green-600' : 'text-gray-600'}`}>
                    {status.is_running ? 'Ja' : 'Nei'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Segment:</span>
                  <span className="font-medium">{status.current_segment}/{status.total_segments}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Oppetid:</span>
                  <span className="font-medium">{Math.floor(status.uptime / 60)}m {status.uptime % 60}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Kalibrert:</span>
                  <span className={`font-medium ${status.is_calibrated ? 'text-green-600' : 'text-red-600'}`}>
                    {status.is_calibrated ? 'Ja' : 'Nei'}
                  </span>
                </div>
              </div>
              
              {/* Profile Information */}
              <div className="border-t pt-4 mt-4">
                <h4 className="text-md font-semibold text-gray-700 mb-3">Profiler</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Profil 1 (SW1):</span>
                    <span className="font-medium text-gray-800">
                      {status.default_profile1 !== undefined && status.default_profile1 !== 255 && status.default_profile1_name
                        ? `${status.default_profile1_name} (ID: ${status.default_profile1})`
                        : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Profil 2 (SW2):</span>
                    <span className="font-medium text-gray-800">
                      {status.default_profile2 !== undefined && status.default_profile2 !== 255 && status.default_profile2_name
                        ? `${status.default_profile2_name} (ID: ${status.default_profile2})`
                        : '-'}
                    </span>
                  </div>
                  {status.profile_count !== undefined && (
                    <div className="flex justify-between items-center text-xs text-gray-500 mt-2 pt-2 border-t">
                      <span>Lagrede profiler:</span>
                      <span>{status.profile_count}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">
              Ingen status mottatt ennå. Klikk på &quot;Hent status&quot; for å oppdatere.
            </div>
          )}
        </div>
      )}

      {/* Device Discovery */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-800">Enhetsdiscovery</h3>
          <button
            onClick={handleScanDevices}
            disabled={!isSupported || isScanning || isConnected}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Søker...' : 'Søk etter enheter'}</span>
          </button>
        </div>

        {!isSupported && (
          <div className="text-center py-8">
            <WifiOff className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Web Bluetooth er ikke støttet i denne nettleseren</p>
            <p className="text-sm text-gray-500 mt-2">
              Prøv Chrome, Edge eller Opera for best støtte
            </p>
          </div>
        )}

        {isSupported && devices.length === 0 && !isScanning && (
          <div className="text-center py-8">
            <Bluetooth className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Ingen enheter funnet</p>
            <p className="text-sm text-gray-500 mt-2">
              Klikk &quot;Søk etter enheter&quot; for å finne ESP32-en
            </p>
          </div>
        )}

        {devices.length > 0 && (
          <div className="space-y-3">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <Bluetooth className="w-5 h-5 text-blue-600" />
                  <div>
                    <h4 className="text-sm font-medium text-gray-800">{device.name}</h4>
                    <p className="text-xs text-gray-500">ID: {device.id}</p>
                  </div>
                </div>
                <button
                  onClick={handleConnect}
                  disabled={isConnected}
                  className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  Koble til
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection Info */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-medium text-gray-800 mb-4">Tilkoblingsinformasjon</h3>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-center justify-between">
            <span>Web Bluetooth støtte:</span>
            <span className={isSupported ? 'text-green-600' : 'text-red-600'}>
              {isSupported ? 'Støttet' : 'Ikke støttet'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>ESP32 service:</span>
            <span className="text-gray-500">4fafc201-1fb5-459e-8fcc-c5c9c331914b</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Characteristic:</span>
            <span className="text-gray-500">beb5483e-36e1-4688-b7f5-ea07361b26a8</span>
          </div>
        </div>
      </div>

      {/* Pin Configuration - Collapsible */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <button
          onClick={() => setPinConfigExpanded(!pinConfigExpanded)}
          className="w-full flex items-center justify-between text-left focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-2 -m-2"
          aria-expanded={pinConfigExpanded}
        >
          <h3 className="text-lg font-medium text-gray-800">ESP32 Pin-konfigurasjon</h3>
          {pinConfigExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-500" />
          )}
        </button>
        
        {pinConfigExpanded && (
          <div className="mt-4">
            <p className="text-sm text-gray-600 mb-4">
              Oversikt over hvilke pins på ESP32 som skal kobles til dimmer-modul og brytere:
            </p>
            
            <div className="space-y-4">
              {/* Dimmer Section */}
              <div>
                <h4 className="text-md font-semibold text-gray-700 mb-2">AC Dimmer (RobotDyn Mod-Dimmer-5A-1L)</h4>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium">Zero-cross input:</span>
                    <span className="font-mono bg-white px-2 py-1 rounded border border-blue-300 text-blue-700">
                      GPIO33 (D33)
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 ml-2">
                    → Kobles til zero-cross output på dimmer-modulen
                  </div>
                  <div className="flex items-center justify-between text-sm mt-3">
                    <span className="text-gray-700 font-medium">Gate output (PWM):</span>
                    <span className="font-mono bg-white px-2 py-1 rounded border border-blue-300 text-blue-700">
                      GPIO25 (D25)
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 ml-2">
                    → Kobles til gate/kontroll-pin på dimmer-modulen
                  </div>
                </div>
              </div>

              {/* Buttons Section */}
              <div>
                <h4 className="text-md font-semibold text-gray-700 mb-2">Hardware-brytere</h4>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium">Program 1 (Button 1):</span>
                    <span className="font-mono bg-white px-2 py-1 rounded border border-green-300 text-green-700">
                      GPIO18 (D18)
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 ml-2">
                    → Kobles til første bryter for å starte Program 1
                  </div>
                  <div className="flex items-center justify-between text-sm mt-3">
                    <span className="text-gray-700 font-medium">Program 2 (Button 2):</span>
                    <span className="font-mono bg-white px-2 py-1 rounded border border-green-300 text-green-700">
                      GPIO19 (D19)
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 ml-2">
                    → Kobles til andre bryter for å starte Program 2
                  </div>
                </div>
              </div>

              {/* Other Pins */}
              <div>
                <h4 className="text-md font-semibold text-gray-700 mb-2">Andre pins</h4>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium">Status LED:</span>
                    <span className="font-mono bg-white px-2 py-1 rounded border border-gray-300 text-gray-700">
                      GPIO2
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 ml-2">
                    → Built-in LED på ESP32 (ikke nødvendig å koble ekstra)
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs text-yellow-800">
                <strong>Viktig:</strong> Sørg for at alle koblinger er gjort riktig før oppstart. 
                Feilaktig kobling kan skade ESP32 eller dimmer-modulen.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Serial Monitor */}
      {isConnected && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Terminal className="w-5 h-5 text-gray-600" />
              <h3 className="text-lg font-medium text-gray-800">Serial Monitor</h3>
              <span className="text-xs text-gray-500">({serialLogs.length} meldinger)</span>
            </div>
          </div>
          
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400 max-h-96 overflow-y-auto">
            {serialLogs.length === 0 ? (
              <div className="text-gray-500 italic">Venter på meldinger fra ESP32...</div>
            ) : (
              <div className="space-y-1">
                {serialLogs.map((log, index) => {
                  // ESP32 timestamp is in milliseconds since boot, convert to time string
                  const timeStr = log.timestamp < 86400000 
                    ? `${Math.floor(log.timestamp / 1000)}s`
                    : new Date(log.timestamp).toLocaleTimeString('no-NO');
                  
                  const levelColor = {
                    info: 'text-blue-400',
                    warn: 'text-yellow-400',
                    error: 'text-red-400',
                    debug: 'text-gray-400'
                  }[log.level] || 'text-green-400';
                  
                  // Use timestamp + index as key for better React reconciliation
                  const uniqueKey = `${log.timestamp}-${index}-${log.message.substring(0, 10)}`;
                  
                  return (
                    <div key={uniqueKey} className="flex items-start space-x-2">
                      <span className="text-gray-500 text-xs">{timeStr}</span>
                      <span className={`${levelColor} capitalize text-xs`}>[{log.level}]</span>
                      <span className="text-green-400 flex-1">{log.message}</span>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
          
          
          {/* Serial Input */}
          <div className="mt-4 flex space-x-2">
            <input
              type="text"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && serialInput.trim()) {
                  await handleSendSerial();
                }
              }}
              placeholder="Skriv kommando her (trykk Enter for å sende)..."
              disabled={!isConnected}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleSendSerial}
              disabled={!isConnected || !serialInput.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>

          <div className="mt-2 space-y-1">
            <p className="text-xs text-gray-500">
              Viser Serial output fra ESP32 via Bluetooth. Log-meldinger sendes automatisk.
            </p>
            <p className="text-xs text-gray-500">
              Eksempel-kommandoer: <code className="bg-gray-100 px-1 rounded">{"get_status"}</code> eller <code className="bg-gray-100 px-1 rounded">{"{command: 'get_status'}"}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BluetoothSettings;
