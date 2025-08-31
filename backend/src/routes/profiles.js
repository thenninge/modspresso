const express = require('express');
const router = express.Router();

// In-memory storage (will be replaced with LocalStorage in frontend)
let profiles = [
  {
    id: '1',
    name: 'Classic Espresso',
    description: 'Traditional 9-bar extraction',
    segments: [
      { startTime: 0, endTime: 8, startPressure: 2, endPressure: 2 },
      { startTime: 8, endTime: 12, startPressure: 2, endPressure: 8 },
      { startTime: 12, endTime: 30, startPressure: 8, endPressure: 8 },
      { startTime: 30, endTime: 32, startPressure: 8, endPressure: 6 },
      { startTime: 32, endTime: 36, startPressure: 6, endPressure: 6 }
    ],
    createdAt: new Date().toISOString()
  }
];

// Get all profiles
router.get('/', (req, res) => {
  res.json(profiles);
});

// Get profile by ID
router.get('/:id', (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  res.json(profile);
});

// Create new profile
router.post('/', (req, res) => {
  const { name, description, segments } = req.body;
  
  if (!name || !segments || !Array.isArray(segments)) {
    return res.status(400).json({ error: 'Invalid profile data' });
  }

  const newProfile = {
    id: Date.now().toString(),
    name,
    description: description || '',
    segments,
    createdAt: new Date().toISOString()
  };

  profiles.push(newProfile);
  res.status(201).json(newProfile);
});

// Update profile
router.put('/:id', (req, res) => {
  const { name, description, segments } = req.body;
  const profileIndex = profiles.findIndex(p => p.id === req.params.id);
  
  if (profileIndex === -1) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  profiles[profileIndex] = {
    ...profiles[profileIndex],
    name: name || profiles[profileIndex].name,
    description: description || profiles[profileIndex].description,
    segments: segments || profiles[profileIndex].segments,
    updatedAt: new Date().toISOString()
  };

  res.json(profiles[profileIndex]);
});

// Delete profile
router.delete('/:id', (req, res) => {
  const profileIndex = profiles.findIndex(p => p.id === req.params.id);
  
  if (profileIndex === -1) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  profiles.splice(profileIndex, 1);
  res.status(204).send();
});

module.exports = router;
