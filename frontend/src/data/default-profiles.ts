import { Profile } from '@/types';

export const predefinedProfiles: Profile[] = [
  {
    id: 'classic-espresso',
    name: 'Klassisk Espresso',
    description: 'Standard 9 bar espresso med jevn trykk',
    segments: [
      { startTime: 0, endTime: 8, startPressure: 2, endPressure: 2 },
      { startTime: 8, endTime: 12, startPressure: 2, endPressure: 9 },
      { startTime: 12, endTime: 30, startPressure: 9, endPressure: 9 },
      { startTime: 30, endTime: 32, startPressure: 9, endPressure: 6 },
      { startTime: 32, endTime: 36, startPressure: 6, endPressure: 6 }
    ],
    createdAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'lippe4',
    name: 'Lippe #4',
    description: 'Kort pre-infuse',
    segments: [
      { startTime: 0, endTime: 6, startPressure: 2.5, endPressure: 2.5 },
      { startTime: 6, endTime: 7, startPressure: 2.5, endPressure: 8 },
      { startTime: 7, endTime: 32, startPressure: 8, endPressure: 8 },
      { startTime: 32, endTime: 40, startPressure: 6, endPressure: 6 },
      { startTime: 40, endTime: 41, startPressure: 0, endPressure: 0 }
    ],
    createdAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'lippe6',
    name: 'Lippe #6',
    description: 'Mellom lengre pre-infuse',
    segments: [
      { startTime: 0, endTime: 8, startPressure: 2.2, endPressure: 2.2 },
      { startTime: 8, endTime: 11, startPressure: 2.2, endPressure: 7 },
      { startTime: 11, endTime: 18, startPressure: 7, endPressure: 8 },
      { startTime: 18, endTime: 35, startPressure: 8, endPressure: 8 },
      { startTime: 35, endTime: 45, startPressure: 8, endPressure: 5.5 },
      { startTime: 45, endTime: 46, startPressure: 0, endPressure: 0 }
    ],
    createdAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'srw',
    name: 'SRW Brazil',
    description: 'Lang pre-infuse',
    segments: [
      { startTime: 0, endTime: 10, startPressure: 2, endPressure: 2 },
      { startTime: 10, endTime: 12, startPressure: 2, endPressure: 7 },
      { startTime: 12, endTime: 35, startPressure: 7.5, endPressure: 7.5 },
      { startTime: 35, endTime: 45, startPressure: 5, endPressure: 5 },
      { startTime: 45, endTime: 46, startPressure: 0, endPressure: 0 }
    ],
    createdAt: '2024-01-01T00:00:00.000Z'
  }
];
