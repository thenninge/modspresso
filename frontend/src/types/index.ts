// Profile types
export interface ProfileSegment {
  startTime: number;
  endTime: number;
  startPressure: number;
  endPressure: number;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  segments: ProfileSegment[];
  createdAt: string;
  updatedAt?: string;
}

// Calibration types
export interface CalibrationStep {
  step: number;
  dimLevel: number;
  pressure: number | null;
  timestamp: string | null;
}

export interface CalibrationData {
  dimLevelToPressure: Record<number, number>;
  lastCalibrated: string | null;
  isCalibrated: boolean;
}

// Connection types
export interface BluetoothDevice {
  id: string;
  name: string;
  rssi: number;
  address: string;
}

export interface ConnectionStatus {
  connected: boolean;
  deviceName: string | null;
  deviceId: string | null;
  lastConnected: string | null;
  error: string | null;
}

export interface ESP32Status {
  currentPressure: number;
  currentDimLevel: number;
  isRunning: boolean;
  currentProfile: string | null;
  uptime: number;
  temperature: number;
  lastUpdate: string;
}

// API Response types
export interface ApiResponse<T> {
  status: string;
  data?: T;
  message?: string;
  error?: string;
}

// WebSocket event types
export interface WebSocketEvents {
  'profile-started': { status: string };
  'profile-stopped': { status: string };
  'calibration-started': { status: string };
  'pressure-update': { pressure: number; timestamp: string };
  'status-update': ESP32Status;
}

// Brew log types
export interface BrewLogEntry {
  id: string;
  date: string;
  beanType: string;
  grindSize: string;
  nextGrindSize: string;
  gramsIn: number | null;
  gramsOut: number | null;
  brewTimeSeconds: number | null;
  grade: number | null;
  notes: string;
  createdAt: string;
  updatedAt?: string;
}
