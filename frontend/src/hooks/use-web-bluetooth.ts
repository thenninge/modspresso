'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// ESP32 BLE Service and Characteristic UUIDs
const ESP32_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const ESP32_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

interface BluetoothDevice {
  id: string;
  name: string;
  connected: boolean;
}

interface ESP32Status {
  current_pressure: number;
  is_running: boolean;
  current_segment: number;
  total_segments: number;
  uptime: number;
  is_calibrated: boolean;
}

export const useWebBluetooth = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [status, setStatus] = useState<ESP32Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);
  const serviceRef = useRef<BluetoothRemoteGATTService | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  // Check if Web Bluetooth is supported
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
      setIsSupported(true);
    } else {
      setError('Web Bluetooth ikke støttet i denne nettleseren');
    }
  }, []);

  const scanForDevices = useCallback(async () => {
    if (!isSupported) {
      setError('Web Bluetooth ikke støttet');
      return [];
    }

    setIsScanning(true);
    setError(null);

    try {
      const bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'EspressoProfiler' },
          { namePrefix: 'ESP32' },
          { services: [ESP32_SERVICE_UUID] }
        ],
        optionalServices: [ESP32_SERVICE_UUID]
      });

      const deviceInfo: BluetoothDevice = {
        id: bluetoothDevice.id,
        name: bluetoothDevice.name || 'Unknown Device',
        connected: bluetoothDevice.gatt?.connected || false
      };

      setDevice(deviceInfo);
      deviceRef.current = bluetoothDevice;
      
      return [deviceInfo];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ukjent feil';
      setError(`Kunne ikke skanne etter enheter: ${errorMessage}`);
      return [];
    } finally {
      setIsScanning(false);
    }
  }, [isSupported]);

  const connectToDevice = useCallback(async (deviceId?: string) => {
    if (!isSupported) {
      setError('Web Bluetooth ikke støttet');
      return false;
    }

    if (!deviceRef.current) {
      setError('Ingen enhet valgt');
      return false;
    }

    setError(null);

    try {
      const bluetoothDevice = deviceRef.current;
      
      if (!bluetoothDevice.gatt) {
        setError('GATT server ikke tilgjengelig');
        return false;
      }

      // Connect to GATT server
      const server = await bluetoothDevice.gatt.connect();
      serverRef.current = server;

      // Get the ESP32 service
      const service = await server.getPrimaryService(ESP32_SERVICE_UUID);
      serviceRef.current = service;

      // Get the characteristic
      const characteristic = await service.getCharacteristic(ESP32_CHARACTERISTIC_UUID);
      characteristicRef.current = characteristic;

      // Set up notifications
      await characteristic.startNotifications();
      
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          const decoder = new TextDecoder();
          const jsonString = decoder.decode(value);
          try {
            const data = JSON.parse(jsonString);
            if (data.type === 'status_update') {
              setStatus(data);
            }
          } catch (err) {
            console.error('Failed to parse ESP32 message:', err);
          }
        }
      });

      // Listen for disconnection
      bluetoothDevice.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        setDevice(null);
        setStatus(null);
        deviceRef.current = null;
        serverRef.current = null;
        serviceRef.current = null;
        characteristicRef.current = null;
      });

      setIsConnected(true);
      setDevice({
        id: bluetoothDevice.id,
        name: bluetoothDevice.name || 'ESP32',
        connected: true
      });

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ukjent feil';
      setError(`Kunne ikke koble til enhet: ${errorMessage}`);
      return false;
    }
  }, [isSupported]);

  const disconnect = useCallback(async () => {
    if (serverRef.current && serverRef.current.connected) {
      serverRef.current.disconnect();
    }
    
    setIsConnected(false);
    setDevice(null);
    setStatus(null);
    deviceRef.current = null;
    serverRef.current = null;
    serviceRef.current = null;
    characteristicRef.current = null;
  }, []);

  const sendCommand = useCallback(async (command: Record<string, unknown>) => {
    if (!characteristicRef.current) {
      setError('Ikke tilkoblet til ESP32');
      return false;
    }

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(command));
      await characteristicRef.current.writeValue(data);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ukjent feil';
      setError(`Kunne ikke sende kommando: ${errorMessage}`);
      return false;
    }
  }, []);

  // ESP32 specific commands
  const startProfile = useCallback(async (profile: Record<string, unknown>) => {
    return await sendCommand({
      command: 'start_profile',
      profile
    });
  }, [sendCommand]);

  const stopProfile = useCallback(async () => {
    return await sendCommand({
      command: 'stop_profile'
    });
  }, [sendCommand]);

  const setDimLevel = useCallback(async (level: number) => {
    return await sendCommand({
      command: 'set_dim_level',
      level
    });
  }, [sendCommand]);

  const startCalibration = useCallback(async () => {
    return await sendCommand({
      command: 'start_calibration'
    });
  }, [sendCommand]);

  const setCalibrationData = useCallback(async (calibration: Record<string, unknown>) => {
    return await sendCommand({
      command: 'set_calibration_data',
      calibration
    });
  }, [sendCommand]);

  const getStatus = useCallback(async () => {
    return await sendCommand({
      command: 'get_status'
    });
  }, [sendCommand]);

  return {
    // State
    isSupported,
    isConnected,
    device,
    status,
    error,
    isScanning,
    
    // Actions
    scanForDevices,
    connectToDevice,
    disconnect,
    sendCommand,
    
    // ESP32 specific commands
    startProfile,
    stopProfile,
    setDimLevel,
    startCalibration,
    setCalibrationData,
    getStatus
  };
};
