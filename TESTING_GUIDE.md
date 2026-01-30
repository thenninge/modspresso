# Modspresso ESP32 - Test Guide for Stabil Dimming

## Pre-Test Sjekkliste

### Hardware
- [ ] ESP32 koblet til USB
- [ ] RobotDyn dimmer koblet til
  - DIM pin → GPIO25
  - ZC pin → GPIO33
  - VCC/GND tilkoblet
- [ ] AC Last (pumpe/lyspære) tilkoblet dimmer
- [ ] Bryter tilkoblet:
  - SW1 → GPIO18
  - SW2 → GPIO19
- [ ] Serial Monitor åpen (115200 baud)

### Software
- [ ] Firmware bygd og lastet opp
- [ ] WebApp kjører på http://localhost:3000
- [ ] Bluetooth tilkoblet i webapp

---

## Test 1: Boot & Safety (KRITISK)

### 1.1 Power-Up Safety Test
**Formål:** Sikre at pumpe IKKE starter automatisk ved oppstart

**Prosedyre:**
1. Sett bryter i ON1 eller ON2 posisjon (IKKE OFF)
2. Koble til strøm til ESP32
3. Observer Serial Monitor

**Forventet:**
```
[SWITCH] WARNING: Switch is ON at boot - waiting for OFF position
[SWITCH] Move switch to OFF position, then ON to start program
[SWITCH] Power-up safety ACTIVE
```

**Resultat:** Pumpe starter IKKE ⬜ PASS / ⬜ FAIL

**Hvis FAIL:** Kritisk sikkerhetsfeil - må fikses før videre testing!

---

### 1.2 Watchdog Test
**Formål:** Verifisere at watchdog resetter ESP32 hvis firmware henger

**Prosedyre:**
```json
{"command":"test_watchdog"}
```
(Denne kommandoen finnes ikke, men hvis vi implementerer en som henger loop(), skal watchdog trigge)

**Forventet:** ESP32 resetter etter 10 sekunder

---

## Test 2: Dimmer OFF State (KRITISK)

### 2.1 OFF ved oppstart
**Prosedyre:**
1. Boot med bryter i OFF
2. Observe Serial Monitor

**Forventet:**
```
[DIMMER] System initialized - OFF mode, ZC enabled
```

**Måle med multimeter på AC-last:** 0V AC ⬜ PASS / ⬜ FAIL

---

### 2.2 OFF etter stopp
**Prosedyre:**
1. Start program via webapp/bryter
2. La det kjøre 5 sekunder
3. Stopp via bryter → OFF
4. Observe Serial Monitor

**Forventet:**
```
[SWITCH] -> OFF: Stopping program
[SAFETY] Stopping profile - setting dimmer to OFF
[DIMMER] Force OFF executed
```

**Måle med multimeter:** 0V AC umiddelbart ⬜ PASS / ⬜ FAIL

---

## Test 3: Zero-Cross Detection (GRUNNLAG FOR DIMMING)

### 3.1 ZC Pulse Rate
**Prosedyre:**
1. Boot ESP32
2. Observer Serial Monitor stats (printet hvert 2. sekund)

**Forventet for 50Hz:**
```
[DIMMER STATS] ZC interval: 10000µs
```
→ 10ms = 100 ZC pulses/sekund = 50Hz (korrekt!)

**Resultat:** ZC interval = _______ µs ⬜ PASS / ⬜ FAIL

**Hvis ZC interval = 0 eller feil:**
- Sjekk fysisk tilkobling ZC pin
- Sjekk at ZC-signal går LOW ved zero-cross (med oscilloskop)
- Prøv endre `ZC_INTERRUPT_EDGE` fra `FALLING` til `RISING` i `dimmer_config.h`

---

### 3.2 ZC Enable/Disable
**Serial kommandoer:**
```json
{"command":"set_zc_enabled","enabled":false}
{"command":"set_zc_enabled","enabled":true}
```

**Forventet:** 
- Disable: `Pulses/sec: 0.0`
- Enable: `Pulses/sec: ~100.0` (for 50Hz)

⬜ PASS / ⬜ FAIL

---

## Test 4: Triac Trigger Pulser (KJERNE-FUNKSJON)

### 4.1 PWM Test Mode (isolert test)
**Formål:** Teste triac uten zero-cross, ren PWM

**Serial kommandoer:**
```json
{"command":"set_pwm_test_mode","enable":true}
{"command":"set_dim_level","level":50}
{"command":"set_dim_level","level":100}
{"command":"set_dim_level","level":0}
{"command":"set_pwm_test_mode","enable":false}
```

**Forventet:**
- 50%: Pumpe/lys på medium styrke
- 100%: Full effekt
- 0%: OFF

**Resultat:** 
- 50% ⬜ PASS / ⬜ FAIL
- 100% ⬜ PASS / ⬜ FAIL
- 0% ⬜ PASS / ⬜ FAIL

---

### 4.2 Phase-Angle Dimming (ZC mode)
**Formål:** Teste triac med zero-cross triggering

**Serial kommandoer:**
```json
{"command":"set_dim_level","level":0}
{"command":"set_dim_level","level":10}
{"command":"set_dim_level","level":50}
{"command":"set_dim_level","level":100}
```

**Observe Serial Monitor:**
```
[DIMMER] Level 10% - TRIAC mode (delay: 9300µs)
[DIMMER STATS] Pulses: X, Pulses/sec: ~100.0
```

**Forventet timing (50Hz):**
| Level | Delay (µs) | Effekt |
|-------|------------|--------|
| 0%    | >10000     | OFF    |
| 10%   | ~9300      | Svak   |
| 50%   | ~4900      | Medium |
| 100%  | ~200       | Full   |

**Resultat:**
- 10%: Pumpe kjører svakt, Pulses/sec ≈ 100 ⬜ PASS / ⬜ FAIL
- 50%: Medium styrke ⬜ PASS / ⬜ FAIL
- 100%: Full styrke, lys lyser sterkt ⬜ PASS / ⬜ FAIL

**Hvis 100% gir bare svak glød:**
- **PROBLEM:** Zero-cross timing er invertert
- **FIX:** I `dimmer_config.h`, prøv endre:
  ```cpp
  #define ZC_INTERRUPT_EDGE RISING  // var FALLING
  ```

---

## Test 5: Bryter-Kontroll

### 5.1 OFF → ON1 → OFF
**Prosedyre:**
1. Bryter: OFF
2. Bryter: ON1 (venstre)
3. Vent 5 sekunder
4. Bryter: OFF (midt)

**Forventet Serial:**
```
[SWITCH] Transition: OFF -> ON1 (Program 1)
[SWITCH] OFF -> ON1: Starting Program 1
Starting default profile 1 (ID: X)
...
[SWITCH] Transition: ON1 (Program 1) -> OFF
[SWITCH] -> OFF: Stopping program
[SAFETY] Stopping profile - setting dimmer to OFF
```

**Resultat:** ⬜ PASS / ⬜ FAIL

---

### 5.2 OFF → ON2 → OFF
**Samme som 5.1, men med ON2 (høyre)**

**Resultat:** ⬜ PASS / ⬜ FAIL

---

### 5.3 Rask toggling
**Prosedyre:**
1. ON1 → OFF → ON1 → OFF (raskt, <1 sekund mellom)

**Forventet:** Ingen crash, hver transisjon detekteres korrekt

**Resultat:** ⬜ PASS / ⬜ FAIL

---

## Test 6: Webapp Software-Knapper

### 6.1 Start/Stop fra Brew-tab
**Prosedyre:**
1. Velg profil i dropdown
2. Klikk "▶ Start Brew"
3. Observe real-time chart og Serial Monitor
4. Klikk "✕ Stop"

**Forventet:**
- Chart viser live data
- Serial: `Profile started`, `Pulses/sec: ~100`
- Stop: `Profile stopped`, `Triac OFF`

**Resultat:** ⬜ PASS / ⬜ FAIL

---

### 6.2 Start/Stop fra Profiles-tab
**Prosedyre:**
1. Klikk "Kjør" på en profil
2. Observe
3. Klikk "Stop"

**Resultat:** ⬜ PASS / ⬜ FAIL

---

## Test 7: Safety Timeouts

### 7.1 90-sekunder timeout
**Prosedyre:**
1. Start en profil som varer >90 sekunder
2. Observer Serial Monitor ved ~90 sekunder

**Forventet:**
```
[SAFETY] TIMEOUT: Dimmer ON for 90s without activity - emergency stop!
SAFETY TIMEOUT: Dimmer auto-stopped after 90s
```

**Resultat:** ⬜ PASS / ⬜ FAIL

---

## Test 8: Kalibrering & Trykk-Mapping

### 8.1 Manual Dim Level Setting
**Webapp:**
1. Gå til Settings → Calibration
2. Set dim level: 50%
3. Observe trykkmåler

**Forventet:** Trykkavlesning øker når dim øker

**Resultat:** Lineær sammenheng? ⬜ PASS / ⬜ FAIL

---

### 8.2 Full Calibration
**Prosedyre:**
1. Calibrate 0%, 10%, 20%, ..., 100%
2. Noter trykkavlesninger
3. Observe Serial Monitor for monotonicity check

**Forventet:**
```
Calibration data loaded from NVS:
  0% -> 0 bar
  10% -> 2 bar
  20% -> 4 bar
  ...
  100% -> 9 bar
```

**Hvis non-monotonic warning:**
```
WARNING: Non-monotonic calibration detected!
```
→ Kan indikere invertert PWM eller feil kalibrering

**Resultat:** ⬜ PASS / ⬜ FAIL

---

## Test 9: Stress Test (Stabilitet)

### 9.1 Continuous Running
**Prosedyre:**
1. Start et 60-sekunders program
2. La det kjøre til slutt uten avbrudd
3. Observer Serial stats hver 2. sekund

**Forventet:**
- Ingen crashes
- Pulses/sec holder seg stabil ~100
- Ingen "SAFETY" warnings

**Resultat:** ⬜ PASS / ⬜ FAIL

---

### 9.2 Rapid Start/Stop
**Prosedyre:**
1. Start profil → vent 2s → stop
2. Gjenta 10 ganger raskt

**Forventet:** 
- Ingen memory leaks
- Ingen crashes
- Dimmer alltid OFF mellom programs

**Resultat:** ⬜ PASS / ⬜ FAIL

---

## Test 10: Edge Cases

### 10.1 BLE disconnect under brewing
**Prosedyre:**
1. Start profil fra webapp
2. Disconnect bluetooth mens den kjører
3. Observer ESP32

**Forventet:** Profil fortsetter å kjøre (autonomt)

**Resultat:** ⬜ PASS / ⬜ FAIL

---

### 10.2 Power cycle under brewing
**Prosedyre:**
1. Start profil
2. Trekk ut USB-kabel (kutt strøm)
3. Koble til igjen

**Forventet:** 
- Boot med dimmer OFF
- Power-up safety aktiveres hvis bryter er ON

**Resultat:** ⬜ PASS / ⬜ FAIL

---

## Feilsøking

### Problem: 100% gir bare svak glød

**Diagnose:**
```
[DIMMER] Level 100% - TRIAC mode (delay: 200µs)
[DIMMER STATS] Pulses: X, Pulses/sec: ~100
```
Pulser sendes, men lav effekt.

**Root cause:** Zero-cross edge detection er invertert

**Fix 1:** I `src/dimmer/dimmer_config.h`:
```cpp
#define ZC_INTERRUPT_EDGE RISING  // prøv motsatt edge
```

**Fix 2:** Hvis det ikke hjelper, inverter delay-logikken i `dimmer_state.cpp`:
```cpp
uint32_t calculate_pulse_delay(uint8_t level) {
  if (level == 0) return TRIAC_DELAY_OFF_US;
  // Inverter: mindre level = kortere delay (mer effekt)
  uint32_t delay = TRIAC_DELAY_MAX_US - 
    ((TRIAC_DELAY_MAX_US - TRIAC_DELAY_MIN_US) * level) / 100;
  return delay;
}
```

---

### Problem: Ingen zero-cross pulser (Pulses/sec = 0)

**Sjekk:**
1. Fysisk tilkobling GPIO33 → ZC pin
2. ZC-signal med oscilloskop (går LOW ved zero-cross?)
3. AC-strøm tilkoblet RobotDyn dimmer

**Serial debug:**
```json
{"command":"set_zc_enabled","enabled":true}
```

---

### Problem: Pumpe starter ved boot (KRITISK!)

**Diagnose:** Power-up safety fungerer ikke

**Sjekk:**
1. Serial output: `Power-up safety ACTIVE`?
2. Bryter-tilkobling GPIO18/GPIO19

**Hvis det fortsatt starter:**
- UMIDDELBART trekk strøm
- Sjekk `dimmer_buttons.cpp`: `powerUpSafetyActive` initialisering

---

## Debug-Kommandoer

### Status query
```json
{"command":"get_status"}
```

### Dim level (0-100)
```json
{"command":"set_dim_level","level":50}
```

### ZC enable/disable
```json
{"command":"set_zc_enabled","enabled":true}
```

### PWM test mode
```json
{"command":"set_pwm_test_mode","enable":true}
{"command":"set_pwm_test_mode","enable":false}
```

### Sanity test (auto OFF→FULL→OFF)
```json
{"command":"sanity_test"}
```

---

## Success Criteria

### Minimum Requirements (MUST PASS)
- [ ] Test 1.1: Power-up safety
- [ ] Test 2: OFF state (0V AC)
- [ ] Test 3.1: Zero-cross detection (~100 pulses/sec @ 50Hz)
- [ ] Test 4.2: Phase-angle dimming (100% = full effekt)
- [ ] Test 5: Bryter-kontroll (OFF→ON→OFF)
- [ ] Test 6: Webapp software-knapper

### Nice-to-Have (SHOULD PASS)
- [ ] Test 7: Safety timeouts
- [ ] Test 8: Kalibrering
- [ ] Test 9: Stress tests
- [ ] Test 10: Edge cases

---

## Test Log

**Dato:** _______________  
**Firmware versjon:** _______________  
**Tester:** _______________

**Kritiske feil:**
```
(noter her)
```

**Observasjoner:**
```
(noter her)
```

**Konklusjon:**
- [ ] PASS - Klar for produksjon
- [ ] FAIL - Må fikses før videre bruk
- [ ] PARTIAL - Fungerer, men trenger tuning

---

## Neste Steg Etter Testing

### Hvis alt går bra:
1. Fine-tune timing-parametre i `dimmer_config.h`
2. Kalibrér trykk-mapping
3. Optimaliser profiler
4. Long-term stability test (flere timer)

### Hvis problemer:
1. Dokumenter serial output
2. Oscilloskop-måling av ZC og DIM signaler
3. Juster `dimmer_config.h` parametre
4. Re-test

---

**LYKKE TIL MED TESTINGEN!** ☕️🔧
