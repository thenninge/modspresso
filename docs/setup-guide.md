# Espresso Profiler - Komplett Oppsett

Dette er en komplett guide for å sette opp ESP32-basert espresso trykk-profiling system.

## Systemoversikt

Systemet består av:
1. **ESP32** med Bluetooth LE og PWM-kontroll
2. **RobotDyn AC-dimmer** for pump-kontroll
3. **Trykk-sensor** for sanntids måling
4. **Webapp** for profil-håndtering og kalibrering
5. **Backend API** for kommunikasjon

## Komponenter

### Elektronikk
- ESP32-WROOM-32
- RobotDyn AC-dimmer (220V/10A)
- Manuelt manometer (0-12 bar)
- Breadboard og kabler
- 220V til 5V adapter (for ESP32)

### Programvare
- Arduino IDE med ESP32-støtte
- Node.js (for backend)
- Modern nettleser (for frontend)

## Installasjon

### 1. ESP32 Firmware

```bash
cd esp32
# Åpne espresso_profiler.ino i Arduino IDE
# Installer biblioteker:
# - ArduinoJson (via Library Manager)
# Last opp til ESP32
```

### 2. Backend

```bash
cd backend
npm install
npm run dev
# Server kjører på http://localhost:5005
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# Webapp kjører på http://localhost:3000
```

### 4. Start hele systemet

```bash
# Fra prosjekt-rot
npm run dev
# Starter både frontend og backend
```

## Kobling av ESP32

### AC-dimmer
```
ESP32 GPIO25 -> AC-dimmer control pin
ESP32 GND -> AC-dimmer GND
```

### Trykk-måling
```
Manuelt manometer -> Les av under kalibrering
(Ingen elektronisk kobling til ESP32)
```

### Strømforsyning
```
220V -> AC-dimmer input
AC-dimmer output -> Espressomaskin pump
5V adapter -> ESP32 USB
```

## Kalibrering

### 1. Trykk-kalibrering
1. Gå til "Kalibrering" i webapp
2. Start automatisk kalibrering
3. Sett dim-level (10%, 20%, ..., 100%)
4. Les av trykk på manometeret for hver setting
5. Lagre kalibreringsdata

### 2. Profil-opprettelse
1. Gå til "Profiler" i webapp
2. Klikk "Ny Profil"
3. Definer tidssegmenter og trykk
4. Se trykk-kurven i grafen
5. Lagre profilen

## Bruk

### Kjøre profil
1. Velg profil i webapp
2. Klikk "Kjør"
3. Systemet følger trykk-kurven automatisk
4. Stopp når ønskelig

### Sanntids overvåking
- Se gjeldende trykk i webapp
- Følg profil-fremdrift
- Stopp/start når som helst

## Feilsøking

### Bluetooth-problemer
- Sjekk at ESP32 er synlig som "EspressoProfiler-ESP32"
- Restart ESP32 hvis nødvendig
- Verifiser UUID-er i koden

### Trykk-lesing
- Kalibrer trykk-sensor først
- Sjekk spenningsforsyning
- Verifiser ADC-kobling

### Dimmer-kontroll
- Sjekk PWM-frekvens (50Hz)
- Verifiser GPIO25-kobling
- Test med enkelt dim-level først

## Sikkerhet

⚠️ **VIKTIG**: 
- AC-dimmer håndterer 220V
- Bruk riktig isolasjon
- Test i sikker omgivelse
- Følg elektriske sikkerhetsregler

## Utvidelser

### Database-integrasjon
- Supabase for cloud-synkronisering
- Profil-deling mellom brukere
- Historikk og statistikk

### Avanserte funksjoner
- Temperatur-kontroll
- Flere pump-kontroller
- Automatisk profil-optimalisering

## Support

For spørsmål eller problemer:
1. Sjekk feilsøkings-seksjonen
2. Se ESP32 Serial Monitor for debugging
3. Kontroller webapp console for feil
