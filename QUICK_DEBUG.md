# Quick Debug Reference - Modspresso ESP32

## Serial Monitor (115200 baud)

### Essential Commands (copy-paste ready)

```json
{"command":"get_status"}
```

```json
{"command":"set_dim_level","level":0}
```

```json
{"command":"set_dim_level","level":50}
```

```json
{"command":"set_dim_level","level":100}
```

```json
{"command":"set_pwm_test_mode","enable":true}
```

```json
{"command":"set_pwm_test_mode","enable":false}
```

```json
{"command":"set_zc_enabled","enabled":false}
```

```json
{"command":"set_zc_enabled","enabled":true}
```

```json
{"command":"sanity_test"}
```

---

## Expected Serial Output (Good)

### Boot sequence:
```
Starting Espresso Profiler ESP32...
========================================
[DIMMER] Initializing dimmer system...
[DIMMER STATE] Initialized - OFF mode, level 0%
[TRIAC] Initialized - pin LOW (safe state)
[ZC] Initialized - GPIO33, FALLING edge
[ZC] Zero-cross detection enabled
[DIMMER] System initialized - OFF mode, ZC enabled
========================================

[SWITCH] 3-Position Toggle Switch Initialized:
  Button 1 (SW1): GPIO18
  Button 2 (SW2): GPIO19
  Boot position: OFF
  Power-up safety: inactive

[SAFETY] Watchdog timer initialized (10s timeout)
```

### Normal operation (2-second stats):
```
[DIMMER STATS] Mode: OFF, Level: 0%, Pulses: 0, Pulses/sec: 0.0, ZC: ON
[DIMMER STATS] Mode: TRIAC, Level: 50%, Pulses: 1543, Pulses/sec: 100.2, ZC: ON, ZC interval: 10000µs
```

### Switch transitions:
```
[SWITCH] Transition: OFF -> ON1 (Program 1)
[SWITCH] OFF -> ON1: Starting Program 1
Starting default profile 1 (ID: 1)

[SWITCH] Transition: ON1 (Program 1) -> OFF
[SWITCH] -> OFF: Stopping program
[SAFETY] Stopping profile - setting dimmer to OFF
[DIMMER] Force OFF executed
```

---

## Red Flags (Bad)

### 🔴 CRITICAL: Dimmer not OFF at boot
```
[DIMMER] System initialized - TRIAC mode, ZC enabled  ← WRONG! Should be OFF
```
→ **ACTION:** Immediately power off, check dimmer_state_init()

### 🔴 CRITICAL: No zero-cross pulses
```
[DIMMER STATS] Pulses/sec: 0.0, ZC: ON
```
→ **ACTION:** Check GPIO33 wiring, try RISING edge in config

### 🔴 CRITICAL: 100% gives low power
```
[DIMMER] Level 100% - TRIAC mode (delay: 200µs)
[DIMMER STATS] Pulses/sec: 100.2
// But light barely glows
```
→ **ACTION:** Zero-cross edge is inverted, change ZC_INTERRUPT_EDGE

### 🔴 CRITICAL: Power-up safety not working
```
[SWITCH] Boot position: ON1 (Program 1)
[SWITCH] Power-up safety: inactive  ← WRONG! Should be ACTIVE
```
→ **ACTION:** Fix dimmer_buttons_init()

### ⚠️ WARNING: Unstable ZC interval
```
[DIMMER STATS] ZC interval: 5243µs  ← Wrong! Should be ~10000µs
[DIMMER STATS] ZC interval: 15832µs ← Unstable
```
→ **ACTION:** Check AC power, check debounce setting

### ⚠️ WARNING: Memory leak
```
RAM:   [====      ]  35.2% (used 115392 bytes)
RAM:   [=====     ]  42.8% (used 140288 bytes)  ← Growing
RAM:   [======    ]  51.3% (used 168192 bytes)  ← Still growing
```
→ **ACTION:** Profile memory, check for document leaks

---

## Quick Diagnostic Flow

```
1. Boot ESP32
   ↓
2. Check Serial Monitor
   ├─ "DIMMER] System initialized - OFF mode" → OK
   └─ Anything else → PROBLEM
   ↓
3. Check ZC detection
   ├─ "Pulses/sec: ~100.0" (for 50Hz) → OK
   └─ "Pulses/sec: 0.0" → PROBLEM
   ↓
4. Test PWM mode (isolated)
   Send: {"command":"set_pwm_test_mode","enable":true}
   Send: {"command":"set_dim_level","level":100}
   ├─ Full power → OK
   └─ Low/no power → Triac/wiring problem
   ↓
5. Test TRIAC mode (with ZC)
   Send: {"command":"set_pwm_test_mode","enable":false}
   Send: {"command":"set_dim_level","level":100}
   ├─ Full power → OK
   └─ Low power → ZC edge inverted
   ↓
6. Test switch
   Toggle: OFF → ON1 → OFF
   ├─ Program starts/stops → OK
   └─ No response → Switch wiring problem
```

---

## Hardware Verification Checklist

### With Multimeter:
- [ ] GPIO25 to DIM: <100Ω resistance
- [ ] GPIO33 to ZC: <100Ω resistance
- [ ] GPIO18 to SW1: <100Ω resistance
- [ ] GPIO19 to SW2: <100Ω resistance
- [ ] VCC to RobotDyn: ~3.3V or 5V
- [ ] GND to RobotDyn: 0V (common ground)

### With Oscilloscope (if available):
- [ ] ZC pin: Square wave, ~10ms period (50Hz)
- [ ] DIM pin: Short pulses (300µs) at 100Hz when active
- [ ] DIM pin: 0V when OFF

---

## Config Tweaks (dimmer_config.h)

### If 100% = weak glow:
```cpp
#define ZC_INTERRUPT_EDGE RISING  // Try opposite edge
```

### If unstable ZC detection:
```cpp
#define ZC_DEBOUNCE_US 1000  // Increase debounce
```

### If 60Hz AC (USA):
```cpp
#define AC_FREQ_HZ 60
```

### If triac needs longer trigger:
```cpp
#define TRIAC_PULSE_WIDTH_US 500  // Increase from 300
```

---

## Emergency Commands

### STOP EVERYTHING:
```json
{"command":"stop_profile"}
```

### FORCE DIMMER OFF:
```json
{"command":"set_dim_level","level":0}
```

### DISABLE ZERO-CROSS (safety):
```json
{"command":"set_zc_enabled","enabled":false}
```

### RESTART ESP32:
Press RST button or:
```
unplug + replug USB
```

---

## Performance Targets

| Metric | Target | Acceptable | Bad |
|--------|--------|------------|-----|
| ZC Pulses/sec (50Hz) | 100.0 | 98-102 | <95 or >105 |
| ZC interval (50Hz) | 10000µs | 9900-10100µs | outside range |
| Pulse count growth | +100/sec | ±5/sec | Erratic |
| RAM usage | <25% | <40% | >50% |
| Response time (command) | <100ms | <500ms | >1s |

---

**LYKKE TIL!** 🎯
