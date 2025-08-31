# Espresso Profiler

ESP32-basert system for trykk-profiling av espresso med Bluetooth-kommunikasjon.

## Funksjoner

- **Trykk-profiling**: Definer trykk-kurver med tid og trykk (bar)
- **Kalibrering**: Automatisk mapping av dim-level til trykk
- **Profil-håndtering**: Lagre, redigere og slette profiler
- **Mobil-vennlig**: Responsivt webgrensesnitt
- **Bluetooth-kommunikasjon**: Enkel tilkobling til ESP32

## Prosjektstruktur

```
espresso-profiler/
├── frontend/          # Next.js webapp
├── backend/           # Express.js API
├── esp32/             # Arduino firmware
└── docs/              # Dokumentasjon
```

## Installasjon

```bash
# Installer alle avhengigheter
npm run install:all

# Start utviklingsserver (frontend + backend)
npm run dev
```

## Kalibrering

1. Gå til "Settings" -> "Pressure Calibration"
2. Kjør automatisk kalibrering (10%-100% dim-level)
3. Les av trykk for hver setting
4. Lagre kalibreringsdata

## Profil-opprettelse

1. Definer tidsintervaller og trykk
2. Visualiser trykk-kurven i grafen
3. Test profilen
4. Lagre med navn

## Teknologier

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Graf**: Recharts (modulær)
- **Backend**: Express.js, WebSocket
- **ESP32**: Arduino framework, Bluetooth LE
- **Storage**: LocalStorage (kan utvides til Supabase)
