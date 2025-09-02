const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000", 
      "http://localhost:3001",
      "https://modspresso.vercel.app",
      "https://modspresso-git-main-thenninge.vercel.app",
      "https://modspresso-thenninge.vercel.app"
    ],
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors({
  origin: [
    "http://localhost:3000", 
    "http://localhost:3001",
    "https://modspresso.vercel.app",
    "https://modspresso-git-main-thenninge.vercel.app",
    "https://modspresso-thenninge.vercel.app"
  ],
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/profiles', require('./routes/profiles'));
app.use('/api/calibration', require('./routes/calibration'));
app.use('/api/connection', require('./routes/connection'));

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Handle profile execution
  socket.on('start-profile', (profileData) => {
    console.log('Starting profile:', profileData);
    // TODO: Send to ESP32 via Bluetooth
    socket.emit('profile-started', { status: 'running' });
  });

  socket.on('stop-profile', () => {
    console.log('Stopping profile');
    // TODO: Stop ESP32
    socket.emit('profile-stopped', { status: 'stopped' });
  });

  // Handle calibration
  socket.on('start-calibration', (calibrationData) => {
    console.log('Starting calibration:', calibrationData);
    // TODO: Send calibration commands to ESP32
    socket.emit('calibration-started', { status: 'running' });
  });

  // Handle dim level control
  socket.on('set_dim_level', (data) => {
    console.log('Setting dim level:', data);
    // TODO: Send to ESP32 via Bluetooth
    socket.emit('dim_level_set', { status: 'success', level: data.level });
  });

  // Handle calibration data
  socket.on('set_calibration_data', (data) => {
    console.log('Setting calibration data:', data);
    // TODO: Send to ESP32 via Bluetooth
    // For now, simulate ESP32 response
    setTimeout(() => {
      const response = {
        type: 'calibration_data_set',
        data: {
          status: 'calibration_data_set',
          total_points: Object.keys(data.calibration).length,
          valid_points: Object.keys(data.calibration).length,
          is_calibrated: true,
          timestamp: Date.now(),
          calibration_data: data.calibration
        }
      };
      socket.emit('calibration_data_set', response);
    }, 1000); // Simulate 1 second delay
  });
});

const PORT = process.env.PORT || 8008;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
});
