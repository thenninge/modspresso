'use client';

import React, { useState, useEffect } from 'react';
import { Bluetooth, WifiOff, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useWebBluetooth } from '@/hooks/use-web-bluetooth';

interface BluetoothDevice {
  id: string;
  name: string;
}

interface BluetoothSettingsProps {
  onConnectionChange?: (connected: boolean) => void;
}

export const BluetoothSettings: React.FC<BluetoothSettingsProps> = ({ 
  onConnectionChange 
}) => {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  
  // Use Web Bluetooth hook
  const {
    isSupported,
    isConnected,
    device,
    status,
    error,
    isScanning,
    scanForDevices,
    connectToDevice,
    disconnect,
    getStatus
  } = useWebBluetooth();

  // Update parent component when connection changes
  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  const handleScanDevices = async () => {
    const foundDevices = await scanForDevices();
    setDevices(foundDevices);
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
      {status && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-medium text-gray-800 mb-4">ESP32 Status</h3>
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
    </div>
  );
};

export default BluetoothSettings;
