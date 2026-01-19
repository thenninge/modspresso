'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// Web Bluetooth API type declarations
declare global {
  interface BluetoothDevice {
    id: string;
    name: string;
    connected: boolean;
    gatt?: BluetoothRemoteGATTServer;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  }

  interface BluetoothRemoteGATTServer {
    connected: boolean;
    device: BluetoothDevice;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    device: BluetoothDevice;
    uuid: string;
    getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTCharacteristic {
    service: BluetoothRemoteGATTService;
    uuid: string;
    properties: BluetoothCharacteristicProperties;
    value?: DataView;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  }

  interface BluetoothCharacteristicProperties {
    broadcast: boolean;
    read: boolean;
    writeWithoutResponse: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
    reliableWrite: boolean;
    writableAuxiliaries: boolean;
  }

  interface Navigator {
    bluetooth: Bluetooth;
  }

  interface Bluetooth {
    requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  }

  interface RequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    optionalServices?: (string | number)[];
    acceptAllDevices?: boolean;
  }

  interface BluetoothLEScanFilter {
    services?: (string | number)[];
    name?: string;
    namePrefix?: string;
    manufacturerData?: BluetoothManufacturerDataFilter[];
    serviceData?: BluetoothServiceDataFilter[];
  }

  interface BluetoothManufacturerDataFilter {
    companyIdentifier: number;
    dataPrefix?: BufferSource;
    mask?: BufferSource;
  }

  interface BluetoothServiceDataFilter {
    service: string | number;
    dataPrefix?: BufferSource;
    mask?: BufferSource;
  }
}

// ESP32 BLE Service and Characteristic UUIDs
const ESP32_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const ESP32_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

interface ESP32Status {
  current_pressure: number;
  is_running: boolean;
  current_segment: number;
  total_segments: number;
  uptime: number;
  is_calibrated: boolean;
  profile_count?: number;
  default_profile1?: number;
  default_profile2?: number;
  default_profile1_name?: string;
  default_profile2_name?: string;
}

interface DeviceInfo {
  id: string;
  name: string;
  connected: boolean;
}

export interface SerialLogEntry {
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  timestamp: number;
}

export const useWebBluetooth = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [status, setStatus] = useState<ESP32Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [serialLogs, setSerialLogs] = useState<SerialLogEntry[]>([]);

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

  const scanForDevices = useCallback(async (): Promise<DeviceInfo[]> => {
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

      const deviceInfo: DeviceInfo = {
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

  const connectToDevice = useCallback(async () => {
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
      console.log('Starting BLE notifications...');
      try {
        await characteristic.startNotifications();
        console.log('BLE notifications started successfully');
      } catch (err) {
        console.error('Failed to start notifications:', err);
        throw err;
      }
      
      console.log('Setting up characteristicvaluechanged event listener...');
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        console.log('characteristicvaluechanged event received!'); // Debug
        const value = (event.target as unknown as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          const decoder = new TextDecoder();
          const jsonString = decoder.decode(value);
          console.log('Received BLE message:', jsonString); // Debug logging
          try {
            const data = JSON.parse(jsonString);
            console.log('Parsed data:', data); // Debug logging
            if (data.type === 'status_update') {
              // Extract only the status fields (exclude 'type')
              const statusData: ESP32Status = {
                current_pressure: data.current_pressure ?? 0,
                is_running: data.is_running ?? false,
                current_segment: data.current_segment ?? 0,
                total_segments: data.total_segments ?? 0,
                uptime: data.uptime ?? 0,
                is_calibrated: data.is_calibrated ?? false
              };
              console.log('Setting status:', statusData); // Debug logging
              setStatus(statusData);
            } else if (data.type === 'serial_log') {
              console.log('Received serial_log message:', data); // Debug logging
              // Add log entry to serial logs (keep last 500 entries)
              setSerialLogs(prev => {
                const newLogs = [...prev, {
                  message: data.message || '',
                  level: data.level || 'info',
                  timestamp: data.timestamp || Date.now()
                }];
                console.log('Updated serialLogs, new count:', newLogs.length); // Debug logging
                return newLogs.slice(-500); // Keep last 500 entries
              });
            } else {
              console.log('Unknown message type:', data.type); // Debug logging
            }
          } catch (err) {
            console.error('Failed to parse ESP32 message:', err, 'Raw:', jsonString);
          }
        } else {
          console.log('No value in characteristicvaluechanged event'); // Debug logging
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
      const jsonString = JSON.stringify(command);
      const data = encoder.encode(jsonString);
      
      // BLE has a maximum write size of 512 bytes
      const MAX_CHUNK_SIZE = 512;
      
      if (data.length <= MAX_CHUNK_SIZE) {
        // Small command, send directly
        await characteristicRef.current.writeValue(data);
        return true;
      } else {
        // Large command, need to split or optimize
        // For now, truncate or optimize the profile data
        console.warn(`Command too large (${data.length} bytes), attempting to optimize...`);
        
        // If it's a store_profile command, try to optimize the profile data
        if (command.command === 'store_profile' && command.profile) {
          const profile = command.profile as Record<string, unknown>;
          // Limit segments to essential data only
          if (Array.isArray(profile.segments)) {
            const segments = profile.segments as Array<Record<string, unknown>>;
            const profileName = (profile.name as string) || '';
            
            // Start with aggressive optimization and reduce until it fits
            let maxSegments = Math.min(segments.length, 10);
            let nameLength = 12;
            let optimizedData: Uint8Array | null = null;
            let optimizedJson: string = '';
            let attempts = 0;
            const maxAttempts = 5;
            
            do {
              const optimizedSegments = segments.slice(0, maxSegments).map(seg => ({
                st: seg.startTime,  // Shortened keys to reduce size
                et: seg.endTime,
                sp: seg.startPressure,
                ep: seg.endPressure
              }));
              
              const optimizedCommand = {
                cmd: 'store_profile',  // Shortened command
                id: command.id,
                p: {  // Shortened profile
                  id: profile.id,
                  n: profileName.substring(0, nameLength), // Shortened name field
                  s: optimizedSegments  // Shortened segments field
                }
            };
              
              optimizedJson = JSON.stringify(optimizedCommand);
              optimizedData = encoder.encode(optimizedJson);
              
              // If still too large, reduce further
              if (optimizedData.length > MAX_CHUNK_SIZE && attempts < maxAttempts) {
                if (maxSegments > 5) {
                  maxSegments -= 2;  // Reduce segments
                } else if (nameLength > 8) {
                  nameLength -= 2;  // Reduce name length
                } else if (maxSegments > 1) {
                  maxSegments -= 1;  // Last resort: reduce to minimum
                } else {
                  break;  // Can't reduce further
                }
                attempts++;
              } else {
                break;
              }
            } while (optimizedData.length > MAX_CHUNK_SIZE && attempts < maxAttempts);
            
            if (optimizedData && optimizedData.length <= MAX_CHUNK_SIZE) {
              console.log(`Profile optimized: ${data.length} → ${optimizedData.length} bytes (${maxSegments} segments, ${nameLength} char name)`);
              await characteristicRef.current.writeValue(new Uint8Array(optimizedData));
              return true;
            } else if (optimizedData) {
              setError(`Profil for stor (${optimizedData.length} bytes). Redusert til ${maxSegments} segments, men fortsatt for stor. Prøv med færre segments.`);
              return false;
            }
          }
        }
        
        setError(`Kommando for stor (${data.length} bytes). Maksimum størrelse er ${MAX_CHUNK_SIZE} bytes.`);
        return false;
      }
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

  const sendSerialCommand = useCallback(async (text: string) => {
    if (!characteristicRef.current) {
      setError('Ikke tilkoblet til ESP32');
      return false;
    }

    try {
      // Try to parse as JSON first (for structured commands)
      let commandText = text.trim();
      try {
        JSON.parse(commandText);
        // Valid JSON, send as-is
      } catch {
        // Not valid JSON, wrap in JSON command format
        commandText = JSON.stringify({ command: commandText });
      }

      const encoder = new TextEncoder();
      const data = encoder.encode(commandText);
      await characteristicRef.current.writeValue(data);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ukjent feil';
      setError(`Kunne ikke sende kommando: ${errorMessage}`);
      return false;
    }
  }, []);

  const storeProfile = useCallback(async (id: number, profile: Record<string, unknown>) => {
    return await sendCommand({
      command: 'store_profile',
      id,
      profile
    });
  }, [sendCommand]);

  const setDefaultProfileForButton = useCallback(async (button: number, profileId: number) => {
    return await sendCommand({
      command: 'set_default_profile',
      button,
      profileId
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
    serialLogs,
    
    // Actions
    scanForDevices,
    connectToDevice,
    disconnect,
    sendCommand,
    sendSerialCommand,
    
    // ESP32 specific commands
    startProfile,
    stopProfile,
    setDimLevel,
    startCalibration,
    setCalibrationData,
    getStatus,
    storeProfile,
    setDefaultProfileForButton
  };
};
