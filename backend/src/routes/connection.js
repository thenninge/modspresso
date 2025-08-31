const express = require('express');
const router = express.Router();

// Connection status
let connectionStatus = {
  connected: false,
  deviceName: null,
  deviceId: null,
  lastConnected: null,
  error: null
};

// Get connection status
router.get('/status', (req, res) => {
  res.json(connectionStatus);
});

// Scan for ESP32 devices
router.post('/scan', (req, res) => {
  // TODO: Implement Bluetooth scanning
  // For now, return mock data
  const mockDevices = [
    {
      id: 'esp32-001',
      name: 'EspressoProfiler-ESP32',
      rssi: -45,
      address: '00:11:22:33:44:55'
    },
    {
      id: 'esp32-002', 
      name: 'ESP32_TestDevice',
      rssi: -67,
      address: 'AA:BB:CC:DD:EE:FF'
    }
  ];

  res.json({
    status: 'scanning',
    devices: mockDevices,
    message: 'Found ESP32 devices'
  });
});

// Connect to ESP32
router.post('/connect', (req, res) => {
  const { deviceId } = req.body;
  
  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  // TODO: Implement actual Bluetooth connection
  // Mock connection for now
  connectionStatus = {
    connected: true,
    deviceName: 'EspressoProfiler-ESP32',
    deviceId: deviceId,
    lastConnected: new Date().toISOString(),
    error: null
  };

  res.json({
    status: 'connected',
    connectionStatus,
    message: 'Successfully connected to ESP32'
  });
});

// Disconnect from ESP32
router.post('/disconnect', (req, res) => {
  // TODO: Implement actual Bluetooth disconnection
  connectionStatus = {
    connected: false,
    deviceName: null,
    deviceId: null,
    lastConnected: connectionStatus.lastConnected,
    error: null
  };

  res.json({
    status: 'disconnected',
    connectionStatus,
    message: 'Disconnected from ESP32'
  });
});

// Send command to ESP32
router.post('/command', (req, res) => {
  const { command, data } = req.body;
  
  if (!connectionStatus.connected) {
    return res.status(400).json({ error: 'Not connected to ESP32' });
  }

  if (!command) {
    return res.status(400).json({ error: 'Command required' });
  }

  // TODO: Implement actual command sending via Bluetooth
  console.log('Sending command to ESP32:', { command, data });

  res.json({
    status: 'command_sent',
    command,
    data,
    timestamp: new Date().toISOString(),
    message: 'Command sent to ESP32'
  });
});

// Get ESP32 status
router.get('/esp32-status', (req, res) => {
  if (!connectionStatus.connected) {
    return res.status(400).json({ error: 'Not connected to ESP32' });
  }

  // TODO: Get actual status from ESP32
  const mockStatus = {
    currentPressure: 8.2,
    currentDimLevel: 75,
    isRunning: false,
    currentProfile: null,
    uptime: 3600,
    temperature: 92.5,
    lastUpdate: new Date().toISOString()
  };

  res.json(mockStatus);
});

module.exports = router;
