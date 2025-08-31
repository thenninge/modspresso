# ESP32 Espresso Profiler Firmware

ESP32-basert firmware for trykk-profiling av espresso med Bluetooth LE-kommunikasjon.

## Funksjoner

- **Bluetooth LE-kommunikasjon** med webapp
- **AC-dimmer kontroll** via PWM
- **Trykk-sensoring** via ADC
- **Profil-eksekvering** med sanntids trykk-kontroll
- **Kalibrering** av dim-level til trykk-mapping

## Kobling

### AC-dimmer (RobotDyn)
```
ESP32 GPIO25 -> AC-dimmer control pin
ESP32 GND -> AC-dimmer GND
```

### Trykk-sensor
```
ESP32 GPIO34 -> Trykk-sensor signal (ADC)
ESP32 3.3V -> Trykk-sensor VCC
ESP32 GND -> Trykk-sensor GND
```

### Status LED
```
ESP32 GPIO2 -> Built-in LED (automatisk)
```

### Hardware-knapper
```
ESP32 GPIO26 -> Knapp 1 (Default profil 1)
ESP32 GPIO27 -> Knapp 2 (Default profil 2)
```

## Installasjon

1. **Installer Arduino IDE** med ESP32-støtte
2. **Installer biblioteker**:
   - `BLEDevice` (included with ESP32)
   - `ArduinoJson` (via Library Manager)
3. **Last opp firmware** til ESP32
4. **Åpne Serial Monitor** (115200 baud) for debugging

## Bluetooth-kommunikasjon

### Service UUID
```
4fafc201-1fb5-459e-8fcc-c5c9c331914b
```

### Characteristic UUID
```
beb5483e-36e1-4688-b7f5-ea07361b26a8
```

### Kommandoer

#### Start profil
```json
{
  "command": "start_profile",
  "profile": {
    "segments": [
      {
        "startTime": 0,
        "endTime": 8,
        "startPressure": 2,
        "endPressure": 2
      }
    ]
  }
}
```

#### Stopp profil
```json
{
  "command": "stop_profile"
}
```

#### Sett dim-level
```json
{
  "command": "set_dim_level",
  "level": 75
}
```

#### Start kalibrering
```json
{
  "command": "start_calibration"
}
```

#### Sett kalibreringspunkt
```json
{
  "command": "set_calibration_point",
  "step": 5,
  "pressure": 6.2
}
```

#### Sett default profil
```json
{
  "command": "set_default_profile",
  "button": 1,
  "profileId": "profile-123"
}
```

## Kalibrering

1. **Start kalibrering** via webapp
2. **Sett dim-level** (10%, 20%, ..., 100%)
3. **Les av trykk** for hver setting
4. **Lagre kalibreringsdata**

## Hardware-knapper

### Kobling
- **Knapp 1** (GPIO26): Start default profil 1
- **Knapp 2** (GPIO27): Start default profil 2

### Funksjon
- Knappene bruker intern pull-up motstand
- Trykk på knappen starter den tildelte profilen
- Kun én profil kan kjøre om gangen
- Knappene fungerer kun når ingen profil kjører

## Trykk-sensor kalibrering

For å kalibrere trykk-sensoren:

```cpp
// I setup() eller via kommando
pressureOffset = 0.5;  // Offset i volt
pressureScale = 2.0;   // Skalering (bar/volt)
```

## Feilsøking

### Bluetooth kobler ikke
- Sjekk at ESP32 har Bluetooth LE-støtte
- Restart ESP32
- Sjekk UUID-er i webapp

### Dimmer fungerer ikke
- Sjekk kobling til GPIO25
- Verifiser PWM-frekvens (50Hz)
- Sjekk at dimmer er kompatibel

### Trykk-lesing er feil
- Kalibrer trykk-sensor
- Sjekk spenningsforsyning
- Verifiser ADC-kobling

## Utvikling

### Legg til ny kommando
1. Oppdater `handleCommand()` funksjon
2. Implementer håndtering
3. Oppdater webapp API

### Endre pin-konfigurasjon
Oppdater `#define` statements øverst i filen:
```cpp
#define DIMMER_PIN 25
#define PRESSURE_SENSOR_PIN 34
```

## Sikkerhet

⚠️ **ADVARSEL**: AC-dimmer håndterer høye spenninger. 
- Bruk riktig isolasjon
- Test i sikker omgivelse
- Følg elektriske sikkerhetsregler
