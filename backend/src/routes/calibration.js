const express = require('express');
const router = express.Router();

// Calibration data structure
let calibrationData = {
  dimLevelToPressure: {},
  lastCalibrated: null,
  isCalibrated: false
};

// Get calibration data
router.get('/', (req, res) => {
  res.json(calibrationData);
});

// Start calibration process
router.post('/start', (req, res) => {
  const { steps = 10 } = req.body;
  
  // Generate calibration steps (10% to 100%)
  const calibrationSteps = [];
  for (let i = 1; i <= steps; i++) {
    const dimLevel = Math.round((i / steps) * 100);
    calibrationSteps.push({
      step: i,
      dimLevel,
      pressure: null, // Will be filled by user
      timestamp: null
    });
  }

  res.json({
    status: 'calibration_started',
    steps: calibrationSteps,
    message: 'Calibration started. Set each dim level and record pressure readings.'
  });
});

// Update calibration step
router.post('/step/:step', (req, res) => {
  const { step } = req.params;
  const { pressure } = req.body;
  
  if (typeof pressure !== 'number' || pressure < 0) {
    return res.status(400).json({ error: 'Invalid pressure value' });
  }

  // Update calibration data
  const dimLevel = Math.round((parseInt(step) / 10) * 100);
  calibrationData.dimLevelToPressure[dimLevel] = pressure;
  
  res.json({
    status: 'step_updated',
    step: parseInt(step),
    dimLevel,
    pressure,
    message: `Pressure ${pressure} bar recorded for ${dimLevel}% dim level`
  });
});

// Complete calibration
router.post('/complete', (req, res) => {
  const { steps } = req.body;
  
  if (!steps || !Array.isArray(steps)) {
    return res.status(400).json({ error: 'Invalid steps data' });
  }

  // Validate all steps have pressure readings
  const incompleteSteps = steps.filter(s => s.pressure === null);
  if (incompleteSteps.length > 0) {
    return res.status(400).json({ 
      error: 'Incomplete calibration',
      incompleteSteps: incompleteSteps.map(s => s.step)
    });
  }

  // Update calibration data
  steps.forEach(step => {
    const dimLevel = Math.round((step.step / 10) * 100);
    calibrationData.dimLevelToPressure[dimLevel] = step.pressure;
  });

  calibrationData.isCalibrated = true;
  calibrationData.lastCalibrated = new Date().toISOString();

  res.json({
    status: 'calibration_completed',
    calibrationData,
    message: 'Calibration completed successfully'
  });
});

// Get pressure for dim level (interpolated)
router.get('/pressure/:dimLevel', (req, res) => {
  const { dimLevel } = req.params;
  const dimLevelNum = parseInt(dimLevel);
  
  if (!calibrationData.isCalibrated) {
    return res.status(400).json({ error: 'System not calibrated' });
  }

  // Find closest calibration points
  const levels = Object.keys(calibrationData.dimLevelToPressure).map(Number).sort((a, b) => a - b);
  
  if (levels.length === 0) {
    return res.status(400).json({ error: 'No calibration data available' });
  }

  // Find exact match or interpolate
  if (calibrationData.dimLevelToPressure[dimLevelNum] !== undefined) {
    return res.json({
      dimLevel: dimLevelNum,
      pressure: calibrationData.dimLevelToPressure[dimLevelNum],
      interpolated: false
    });
  }

  // Interpolate between closest points
  let lowerLevel = levels[0];
  let upperLevel = levels[levels.length - 1];
  
  for (let i = 0; i < levels.length - 1; i++) {
    if (dimLevelNum >= levels[i] && dimLevelNum <= levels[i + 1]) {
      lowerLevel = levels[i];
      upperLevel = levels[i + 1];
      break;
    }
  }

  const lowerPressure = calibrationData.dimLevelToPressure[lowerLevel];
  const upperPressure = calibrationData.dimLevelToPressure[upperLevel];
  
  const pressure = lowerPressure + (upperPressure - lowerPressure) * 
    (dimLevelNum - lowerLevel) / (upperLevel - lowerLevel);

  res.json({
    dimLevel: dimLevelNum,
    pressure: Math.round(pressure * 100) / 100,
    interpolated: true,
    bounds: { lowerLevel, upperLevel }
  });
});

// Reset calibration
router.delete('/', (req, res) => {
  calibrationData = {
    dimLevelToPressure: {},
    lastCalibrated: null,
    isCalibrated: false
  };
  
  res.json({
    status: 'calibration_reset',
    message: 'Calibration data reset'
  });
});

module.exports = router;
