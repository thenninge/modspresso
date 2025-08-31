'use client';

import React, { useState, useEffect } from 'react';
import { Bluetooth, Wifi, WifiOff, RefreshCw, Settings, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useWebSocket } from '@/hooks/use-websocket';

interface BluetoothDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
  connected: boolean;
}

interface BluetoothSettingsProps {
  onConnectionChange?: (connected: boolean) => void;
}

export const BluetoothSettings: React.FC<BluetoothSettingsProps> = ({ 
  onConnectionChange 
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDevice | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [lastError, setLastError] = useState<string>('');
  
  // In production, backend is on same domain, in development use localhost
  const isProduction = process.env.NODE_ENV === 'production';
  const backendUrl = isProduction ? window.location.origin : 'http://localhost:5005';
  const wsUrl = backendUrl.replace('http', 'ws') + '/socket.io/';
  const { isConnected: wsConnected, sendMessage } = useWebSocket(wsUrl);

  // Load saved device from localStorage
  useEffect(() => {
    const savedDevice = localStorage.getItem('modspresso-bluetooth-device');
    if (savedDevice) {
      try {
        const device = JSON.parse(savedDevice);
        setSelectedDevice(device);
      } catch (error) {
        console.error('Failed to parse saved device:', error);
      }
    }
  }, []);

  // Check connection status on mount
  useEffect(() => {
    if (wsConnected) {
      sendMessage({ type: 'get_connection_status' });
    }
  }, [wsConnected, sendMessage]);

  const handleScanDevices = async () => {
    if (!wsConnected) {
      setLastError('WebSocket ikke tilkoblet');
      return;
    }

    setIsScanning(true);
    setDevices([]);
    setLastError('');

    try {
      sendMessage({ type: 'scan_bluetooth_devices' });
      
      // Simulate device discovery (replace with actual WebSocket response handling)
      setTimeout(() => {
        const mockDevices: BluetoothDevice[] = [
          {
            id: 'esp32-001',
            name: 'ESP32-Modspresso',
            address: 'AA:BB:CC:DD:EE:FF',
            rssi: -45,
            connected: false
          },
          {
            id: 'esp32-002', 
            name: 'ESP32-Device',
            address: '11:22:33:44:55:66',
            rssi: -67,
            connected: false
          }
        ];
        setDevices(mockDevices);
        setIsScanning(false);
      }, 3000);
    } catch (error) {
      setLastError('Feil ved skanning av enheter');
      setIsScanning(false);
    }
  };

  const handleConnect = async (device: BluetoothDevice) => {
    if (!wsConnected) {
      setLastError('WebSocket ikke tilkoblet');
      return;
    }

    setConnectionStatus('connecting');
    setLastError('');

    try {
      sendMessage({ 
        type: 'connect_bluetooth_device', 
        data: { deviceId: device.id, address: device.address }
      });

      // Simulate connection process
      setTimeout(() => {
        setConnectionStatus('connected');
        setSelectedDevice(device);
        localStorage.setItem('modspresso-bluetooth-device', JSON.stringify(device));
        onConnectionChange?.(true);
      }, 2000);
    } catch (error) {
      setConnectionStatus('error');
      setLastError('Kunne ikke koble til enhet');
    }
  };

  const handleDisconnect = async () => {
    if (!wsConnected) {
      setLastError('WebSocket ikke tilkoblet');
      return;
    }

    try {
      sendMessage({ type: 'disconnect_bluetooth_device' });
      
      setConnectionStatus('disconnected');
      setSelectedDevice(null);
      localStorage.removeItem('modspresso-bluetooth-device');
      onConnectionChange?.(false);
    } catch (error) {
      setLastError('Feil ved frakobling');
    }
  };

  const getConnectionStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'connecting':
        return <RefreshCw className="h-5 w-5 text-yellow-500 animate-spin" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <WifiOff className="h-5 w-5 text-gray-400" />;
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Tilkoblet';
      case 'connecting':
        return 'Kobler til...';
      case 'error':
        return 'Tilkoblingsfeil';
      default:
        return 'Ikke tilkoblet';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-600';
      case 'connecting':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Bluetooth className="h-6 w-6 text-blue-500 mr-3" />
            <h2 className="text-xl font-bold text-gray-800">Bluetooth-tilkobling</h2>
          </div>
          <div className="flex items-center space-x-2">
            {getConnectionStatusIcon()}
            <span className={`text-sm font-medium ${getConnectionStatusColor()}`}>
              {getConnectionStatusText()}
            </span>
          </div>
        </div>

        {/* Connection Status */}
        {selectedDevice && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-blue-800">
                  Tilkoblet enhet
                </h3>
                <p className="text-sm text-blue-600">
                  {selectedDevice.name} ({selectedDevice.address})
                </p>
              </div>
              <button
                onClick={handleDisconnect}
                className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Frakoble
              </button>
            </div>
          </div>
        )}

        {/* Error Message */}
        {lastError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
              <span className="text-sm text-red-800">{lastError}</span>
            </div>
          </div>
        )}

        {/* Scan Button */}
        <div className="mb-6">
          <button
            onClick={handleScanDevices}
            disabled={isScanning || !wsConnected}
            className={`flex items-center px-4 py-2 rounded-md transition-colors ${
              isScanning || !wsConnected
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isScanning ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Settings className="h-4 w-4 mr-2" />
            )}
            {isScanning ? 'Skanner...' : 'Skann for enheter'}
          </button>
        </div>

        {/* Device List */}
        {devices.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-medium text-gray-800">Tilgjengelige enheter</h3>
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center">
                  <Bluetooth className="h-5 w-5 text-blue-500 mr-3" />
                  <div>
                    <h4 className="text-sm font-medium text-gray-800">{device.name}</h4>
                    <p className="text-xs text-gray-500">{device.address}</p>
                    <p className="text-xs text-gray-400">Signal: {device.rssi} dBm</p>
                  </div>
                </div>
                <button
                  onClick={() => handleConnect(device)}
                  disabled={connectionStatus === 'connecting'}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    connectionStatus === 'connecting'
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-green-500 text-white hover:bg-green-600'
                  }`}
                >
                  Koble til
                </button>
              </div>
            ))}
          </div>
        )}

        {/* No Devices Found */}
        {!isScanning && devices.length === 0 && (
          <div className="text-center py-8">
            <Bluetooth className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Ingen enheter funnet</h3>
            <p className="text-gray-600">
              Klikk "Skann for enheter" for å finne tilgjengelige ESP32-enheter
            </p>
          </div>
        )}
      </div>

      {/* Connection Info */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-medium text-gray-800 mb-4">Tilkoblingsinformasjon</h3>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-center justify-between">
            <span>WebSocket status:</span>
            <span className={wsConnected ? 'text-green-600' : 'text-red-600'}>
              {wsConnected ? 'Tilkoblet' : 'Ikke tilkoblet'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Backend server:</span>
            <span className="text-blue-600">{backendUrl}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>ESP32 service:</span>
            <span className="text-gray-500">Modspresso BLE Service</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BluetoothSettings;
