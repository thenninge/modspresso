#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <esp_timer.h>

// Pin definitions
#define ZERO_CROSS_PIN 33   // GPIO33 (D33) for zero-cross detection (RobotDyn Mod-Dimmer-5A-1L)
#define DIMMER_PIN 25       // GPIO25 (D25) for AC dimmer control (gate pin - PWM output)
#define LED_PIN 2           // GPIO2 for status LED (built-in LED)
#define BUTTON_1_PIN 18     // GPIO18 (D18) for hardware button 1 (Program 1)
#define BUTTON_2_PIN 19     // GPIO19 (D19) for hardware button 2 (Program 2)

// ============================================================================
// TRIAC DRIVE CONFIGURATION (Custom implementation - replaces RBDimmer)
// ============================================================================

// Debug mode
#define DIM_DEBUG 1

// Pulse timing constants (for 50Hz AC)
#define PULSE_WIDTH_US 300      // Trigger pulse width
#define DELAY_FULL_US 200       // Delay for full power (100%)
#define DELAY_OFF_US 10500      // Delay for OFF (never fires within half-cycle)

// AC frequency
#define AC_FREQ_HZ 50

// Triac drive state
enum DimmerMode {
  DIM_OFF = 0,
  DIM_ON = 1
};

volatile bool zcFlag = false;
volatile unsigned long zcTimestamp = 0;
volatile unsigned long lastZcTimestamp = 0;
volatile unsigned long zcInterval = 0;
DimmerMode dimmerMode = DIM_OFF;
int dimmerLevel = 0;
unsigned long pulseDelayUs = DELAY_OFF_US;

// PWM test mode (bypasses zero-cross, direct LEDC PWM)
bool pwmTestMode = false;

// Instrumentation
unsigned long pulseCount = 0;
unsigned long offModeStartTime = 0;
bool zcEnabled = true;

// Timer handle
esp_timer_handle_t pulseTimerHandle = NULL;

// Bluetooth service and characteristic UUIDs
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// Global variables
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Profile execution variables
bool isRunning = false;
unsigned long startTime = 0;
int currentSegment = 0;
DynamicJsonDocument* profileDoc = NULL; // Document to hold profile segments
JsonArray profileSegments;
int totalSegments = 0;

// Compact profile structure
struct CompactSegment {
  uint8_t startTime;
  uint8_t endTime;
  uint8_t startPressure;
  uint8_t endPressure;
};

struct CompactProfile {
  uint8_t id;
  char name[16];
  uint8_t segmentCount;
  CompactSegment segments[10];
  uint8_t totalDuration;
  uint8_t checksum;
};

// Profile storage (10 profiles)
CompactProfile storedProfiles[10];
uint8_t profileCount = 0;

// Default profiles for hardware buttons (0-9, 255 = none)
uint8_t defaultProfile1 = 255;  // Profile ID for button 1
uint8_t defaultProfile2 = 255;  // Profile ID for button 2

// Button state tracking
bool lastButton1State = HIGH;
bool lastButton2State = HIGH;
unsigned long lastButton1Time = 0;
unsigned long lastButton2Time = 0;
const unsigned long DEBOUNCE_DELAY = 50; // 50ms debounce

// Emergency stop initialization flags (reset when profile stops)
bool button1StateInitialized = false;
bool button2StateInitialized = false;

// Power-up safety: Prevents auto-start if switch is ON at boot
bool powerUpSafetyActive = false;  // True = switch was ON at boot, waiting for OFF

// Calibration data
int dimLevelToPressure[11] = {0}; // 0%, 10%, 20%, ..., 100%
bool isCalibrated = false;

// Pressure sensor calibration
float pressureOffset = 0.0;
float pressureScale = 1.0;

// WiFi and OTA configuration
char wifiSSID[64] = "";  // WiFi SSID (set via BLE command)
char wifiPassword[64] = "";  // WiFi password (set via BLE command)
bool wifiConfigured = false;
bool wifiConnected = false;

// Dimmer state is now managed by inline triac driver (see top of file)
// No RBDimmer library needed

// Preferences for non-volatile storage (NVS)
Preferences preferences;

// Function declarations
void handleCommand(const char* command);
void setupWiFi();
void performOTAUpdate(const char* firmwareUrl);
void setWiFiCredentials(const char* ssid, const char* password);
void startProfile(JsonObject profile);
void stopProfile();
void executeProfile();
void setDimLevel(int level);
float getCurrentPressure();
int pressureToDimLevel(float pressure);
void startCalibration();
void setCalibrationPoint(int step, float pressure);
void setCalibrationData(JsonObject calibration);
void sendCalibrationStatus();
void sendProfileStatus();
void sendStatusUpdate();
void checkHardwareButtons();
uint8_t calculateChecksum(CompactProfile& profile);
bool storeProfile(uint8_t id, JsonObject profileData);
void setDefaultProfile(int button, uint8_t profileId);
void startDefaultProfile(int button);
void startProfileById(uint8_t profileId);
void saveCalibrationData();
void loadCalibrationData();
void saveProfiles();
void loadProfiles();
void saveDefaultProfiles();
void loadDefaultProfiles();
void sendResponse(DynamicJsonDocument& doc);
void sendLogMessage(const char* message, const char* level = "info");

// Triac drive function declarations
void IRAM_ATTR zeroCrossISR();
void IRAM_ATTR pulseTimerCallback(void* arg);
void initTriacDrive();
void setTriacLevel(int level);
void processZeroCross();
void printTriacStats();

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Device connected");
      digitalWrite(LED_PIN, HIGH);
      // Don't send messages here - wait for loop() to handle it after notifications are ready
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("Device disconnected");
      digitalWrite(LED_PIN, LOW);
    }
};

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string rxValue = pCharacteristic->getValue();
      
      if (rxValue.length() > 0) {
        Serial.println("Received Value: " + String(rxValue.c_str()));
        handleCommand(rxValue.c_str());
      }
    }
};

// ============================================================================
// ZERO-CROSS ISR (Keep minimal!)
// ============================================================================
void IRAM_ATTR zeroCrossISR() {
  unsigned long now = micros();
  if (lastZcTimestamp > 0) {
    zcInterval = now - lastZcTimestamp;
  }
  lastZcTimestamp = now;
  zcFlag = true;
  zcTimestamp = now;
}

// ============================================================================
// PULSE TIMER CALLBACK
// ============================================================================
void IRAM_ATTR pulseTimerCallback(void* arg) {
  if (dimmerMode == DIM_ON) {
    digitalWrite(DIMMER_PIN, HIGH);
    delayMicroseconds(PULSE_WIDTH_US);
    digitalWrite(DIMMER_PIN, LOW);
    pulseCount++;
  }
}

// ============================================================================
// TRIAC DRIVE INITIALIZATION
// ============================================================================
void initTriacDrive() {
  pinMode(DIMMER_PIN, OUTPUT);
  digitalWrite(DIMMER_PIN, LOW);
  
  pinMode(ZERO_CROSS_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ZERO_CROSS_PIN), zeroCrossISR, FALLING);
  
  dimmerMode = DIM_OFF;
  dimmerLevel = 0;
  pulseDelayUs = DELAY_OFF_US;
  
  esp_timer_create_args_t timerArgs = {
    .callback = &pulseTimerCallback,
    .arg = NULL,
    .dispatch_method = ESP_TIMER_TASK,
    .name = "triac_pulse"
  };
  esp_timer_create(&timerArgs, &pulseTimerHandle);
  
  Serial.println("[TRIAC] Drive initialized: DIM pin LOW, ZC interrupt attached");
  Serial.println("[DIMMER] System initialized - OFF mode, ZC enabled");
}

// ============================================================================
// SET TRIAC LEVEL
// ============================================================================
void setTriacLevel(int level) {
  level = constrain(level, 0, 100);
  dimmerLevel = level;
  
  if (pwmTestMode) {
    // Direct PWM output (bypasses ZC)
    int pwmValue = map(level, 0, 100, 0, 255);
    ledcWrite(0, pwmValue);
    
    Serial.print("[DIMMER] PWM test mode - Level: ");
    Serial.print(level);
    Serial.print("%, PWM value: ");
    Serial.println(pwmValue);
    return;
  }
  
  // TRIAC mode (normal operation)
  if (level == 0) {
    if (pulseTimerHandle != NULL) {
      esp_timer_stop(pulseTimerHandle);
    }
    dimmerMode = DIM_OFF;
    digitalWrite(DIMMER_PIN, LOW);
    pulseDelayUs = DELAY_OFF_US;
    offModeStartTime = millis();
    
    Serial.println("[DIMMER] Level 0% - OFF mode (no pulses, pin LOW)");
  } else {
    // Linear mapping: 100% = DELAY_FULL_US (200µs), 1% = near DELAY_OFF_US
    pulseDelayUs = map(level, 1, 100, 9300, DELAY_FULL_US);
    dimmerMode = DIM_ON;
    
    Serial.print("[DIMMER] Level ");
    Serial.print(level);
    Serial.print("% - TRIAC mode (delay: ");
    Serial.print(pulseDelayUs);
    Serial.println("µs)");
  }
}

// Wrapper for compatibility
void setDimLevel(int level) {
  setTriacLevel(level);
}

// ============================================================================
// PROCESS ZERO-CROSS (call from loop)
// ============================================================================
void processZeroCross() {
  if (zcFlag) {
    zcFlag = false;
    
    if (dimmerMode == DIM_ON && pulseTimerHandle != NULL) {
      esp_timer_stop(pulseTimerHandle);
      esp_timer_start_once(pulseTimerHandle, pulseDelayUs);
    }
  }
}

// ============================================================================
// PRINT TRIAC STATS
// ============================================================================
void printTriacStats() {
  static unsigned long lastPrint = 0;
  static unsigned long lastPulseCount = 0;
  
  if (millis() - lastPrint < 2000) return;
  
  float pps = (pulseCount - lastPulseCount) / 2.0f;
  lastPulseCount = pulseCount;
  lastPrint = millis();
  
  String modeStr = pwmTestMode ? "PWM_TEST" : (dimmerMode == DIM_OFF ? "OFF" : "TRIAC");
  
  Serial.print("[DIMMER STATS] Mode: ");
  Serial.print(modeStr);
  Serial.print(", Level: ");
  Serial.print(dimmerLevel);
  Serial.print("%, Pulses: ");
  Serial.print(pulseCount);
  Serial.print(", Pulses/sec: ");
  Serial.print(pps, 1);
  Serial.print(", ZC: ");
  Serial.print(zcEnabled ? "ON" : "OFF");
  if (zcEnabled && zcInterval > 0) {
    Serial.print(", ZC interval: ");
    Serial.print(zcInterval);
    Serial.print("µs");
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  Serial.println("Starting Espresso Profiler ESP32...");

  // CRITICAL: Initialize triac drive FIRST
  initTriacDrive();

  // Initialize Preferences (NVS) for persistent storage
  preferences.begin("modspresso", false);
  Serial.println("NVS (Preferences) initialized");
  
  // Load saved data from NVS
  loadCalibrationData();
  loadProfiles();
  loadDefaultProfiles();
  Serial.println("Data loaded from NVS");

  // Initialize pins
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_1_PIN, INPUT_PULLUP);
  pinMode(BUTTON_2_PIN, INPUT_PULLUP);
  digitalWrite(LED_PIN, LOW);
  
  // Initialize button states with power-up safety
  delay(10);
  lastButton1State = digitalRead(BUTTON_1_PIN);
  lastButton2State = digitalRead(BUTTON_2_PIN);
  lastButton1Time = millis();
  lastButton2Time = millis();
  button1StateInitialized = false;
  button2StateInitialized = false;
  
  // Power-up safety check: Is switch ON at boot?
  if (lastButton1State == LOW || lastButton2State == LOW) {
    powerUpSafetyActive = true;
    Serial.println("[SWITCH] WARNING: Switch is ON at boot - waiting for OFF position");
    Serial.println("[SWITCH] Move switch to OFF position, then ON to start program");
    Serial.println("[SWITCH] Power-up safety ACTIVE");
  } else {
    powerUpSafetyActive = false;
    Serial.println("[SWITCH] Switch is OFF at boot - normal operation");
  }

  // Initialize Bluetooth
  BLEDevice::init("EspressoProfiler-ESP32");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // Create BLE service
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Create BLE characteristic
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ |
                      BLECharacteristic::PROPERTY_WRITE |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  pCharacteristic->setCallbacks(new MyCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());

  // Start the service
  pService->start();

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // Functions that help with iPhone connections issue
  pAdvertising->setMaxPreferred(0x12);
  
  // Set device name for advertising
  BLEAdvertisementData advertisementData;
  advertisementData.setName("EspressoProfiler-ESP32");
  advertisementData.setCompleteServices(BLEUUID(SERVICE_UUID));
  pAdvertising->setAdvertisementData(advertisementData);
  
  BLEDevice::startAdvertising();
  
  Serial.println("Waiting for client connection to notify...");
}

void loop() {
  // Handle Serial input for testing (read JSON commands from Serial Monitor)
  static String serialBuffer = "";
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      // End of command
      if (serialBuffer.length() > 0) {
        serialBuffer.trim();
        String logMsg = ">>> [SERIAL] Received: " + serialBuffer;
        Serial.println();
        Serial.println(logMsg);
        sendLogMessage(logMsg.c_str(), "debug");
        handleCommand(serialBuffer.c_str());
        Serial.println(">>> [SERIAL] Done");
        sendLogMessage(">>> [SERIAL] Done", "debug");
        serialBuffer = "";
      }
    } else {
      serialBuffer += c;
    }
  }

  // Handle Bluetooth connection
  if (!deviceConnected && oldDeviceConnected) {
    delay(500); // Give the Bluetooth stack the chance to get things ready
    pServer->startAdvertising(); // Restart advertising
    Serial.println("Start advertising");
    oldDeviceConnected = deviceConnected;
  }
  
  // New connection detected - send initial messages after delay to ensure notifications are ready
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    
    // Wait a bit to ensure Web Bluetooth has fully set up notifications
    delay(800); // Give Web Bluetooth time to complete startNotifications()
    
    Serial.println("Sending initial messages after connection...");
    sendStatusUpdate();
    delay(100);
    sendLogMessage("ESP32 connected and ready", "info");
    delay(100);
    sendLogMessage("Serial Monitor ready - you can send commands via Serial or BLE", "info");
    
    Serial.println("Initial messages sent");
  }

  // CRITICAL: Process zero-cross events (schedule triac pulses)
  processZeroCross();

  // Handle profile execution
  if (isRunning) {
    executeProfile();
  } else {
    // Ensure dimmer is in OFF mode when no profile is running
    if (dimmerMode != DIM_OFF) {
      setDimLevel(0);
    }
  }

  // Check hardware buttons
  checkHardwareButtons();

  // Print triac stats periodically
  printTriacStats();

  // Send status updates every second
  static unsigned long lastStatusUpdate = 0;
  if (deviceConnected && millis() - lastStatusUpdate > 1000) {
    sendStatusUpdate();
    lastStatusUpdate = millis();
  }

  delay(10);
}

// Save calibration data to NVS
void saveCalibrationData() {
  preferences.putBool("calibrated", isCalibrated);
  if (isCalibrated) {
    // Save calibration data array (11 values: 0-100% in steps of 10)
    size_t dataSize = sizeof(int) * 11;
    preferences.putBytes("calib_data", dimLevelToPressure, dataSize);
    Serial.println("Calibration data saved to NVS");
  } else {
    preferences.remove("calib_data");
    Serial.println("Calibration data cleared from NVS");
  }
}

// Load calibration data from NVS
void loadCalibrationData() {
  isCalibrated = preferences.getBool("calibrated", false);
  if (isCalibrated) {
    // Load calibration data array
    size_t dataSize = sizeof(int) * 11;
    if (preferences.getBytesLength("calib_data") == dataSize) {
      preferences.getBytes("calib_data", dimLevelToPressure, dataSize);
      Serial.println("Calibration data loaded from NVS:");
      for (int i = 0; i <= 10; i++) {
        if (dimLevelToPressure[i] > 0) {
          Serial.println("  " + String(i * 10) + "% -> " + String(dimLevelToPressure[i]) + " bar");
        }
      }
    } else {
      Serial.println("WARNING: Calibration data size mismatch, clearing...");
      isCalibrated = false;
      preferences.remove("calib_data");
    }
  } else {
    Serial.println("No calibration data found in NVS");
  }
}

// Save all profiles to NVS
void saveProfiles() {
  preferences.putUChar("profile_count", profileCount);
  
  // Save each profile (up to 10 profiles)
  for (uint8_t i = 0; i < 10; i++) {
    String key = "prof_" + String(i);
    CompactProfile& profile = storedProfiles[i];
    
    if (profile.id != 255 && profile.segmentCount > 0) {
      // Profile exists - save it
      size_t profileSize = sizeof(CompactProfile);
      preferences.putBytes(key.c_str(), &profile, profileSize);
    } else {
      // Profile slot empty - remove it
      preferences.remove(key.c_str());
    }
  }
  
  Serial.println("Profiles saved to NVS (count: " + String(profileCount) + ")");
}

// Load all profiles from NVS
void loadProfiles() {
  profileCount = preferences.getUChar("profile_count", 0);
  
  int loadedCount = 0;
  for (uint8_t i = 0; i < 10; i++) {
    String key = "prof_" + String(i);
    
    if (preferences.isKey(key.c_str())) {
      // Profile exists in NVS - load it
      size_t profileSize = sizeof(CompactProfile);
      if (preferences.getBytesLength(key.c_str()) == profileSize) {
        preferences.getBytes(key.c_str(), &storedProfiles[i], profileSize);
        
        // Validate checksum
        uint8_t calculatedChecksum = calculateChecksum(storedProfiles[i]);
        if (calculatedChecksum == storedProfiles[i].checksum && storedProfiles[i].id != 255) {
          loadedCount++;
          Serial.println("Profile " + String(i) + " loaded: \"" + String(storedProfiles[i].name) + "\" (" + 
                        String(storedProfiles[i].segmentCount) + " segments)");
        } else {
          Serial.println("WARNING: Profile " + String(i) + " checksum mismatch, skipping...");
          storedProfiles[i].id = 255;  // Mark as empty
          storedProfiles[i].segmentCount = 0;
        }
      } else {
        Serial.println("WARNING: Profile " + String(i) + " size mismatch, skipping...");
        storedProfiles[i].id = 255;  // Mark as empty
        storedProfiles[i].segmentCount = 0;
      }
    } else {
      // Profile slot empty
      storedProfiles[i].id = 255;
      storedProfiles[i].segmentCount = 0;
    }
  }
  
  // Update profileCount to match actual loaded profiles
  profileCount = loadedCount;
  Serial.println("Profiles loaded from NVS (count: " + String(profileCount) + ")");
}

// Save default profiles (button assignments) to NVS
void saveDefaultProfiles() {
  preferences.putUChar("default_prof1", defaultProfile1);
  preferences.putUChar("default_prof2", defaultProfile2);
  Serial.println("Default profiles saved to NVS: Button1=" + String(defaultProfile1) + ", Button2=" + String(defaultProfile2));
}

// Load default profiles (button assignments) from NVS
void loadDefaultProfiles() {
  defaultProfile1 = preferences.getUChar("default_prof1", 255);
  defaultProfile2 = preferences.getUChar("default_prof2", 255);
  
  // Validate default profile IDs
  if (defaultProfile1 != 255 && defaultProfile1 >= 10) {
    Serial.println("WARNING: Invalid default profile 1 ID (" + String(defaultProfile1) + "), clearing...");
    defaultProfile1 = 255;
  }
  if (defaultProfile2 != 255 && defaultProfile2 >= 10) {
    Serial.println("WARNING: Invalid default profile 2 ID (" + String(defaultProfile2) + "), clearing...");
    defaultProfile2 = 255;
  }
  
  Serial.println("Default profiles loaded from NVS: Button1=" + String(defaultProfile1) + ", Button2=" + String(defaultProfile2));
}

void handleCommand(const char* command) {
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, command);
  
  if (error) {
    Serial.println("JSON parsing failed");
    return;
  }

  // Support both "command" and "cmd" (optimized format)
  String cmd = doc["command"] | doc["cmd"] | "";
  
  if (cmd == "start_profile") {
    startProfile(doc["profile"]);
  } else if (cmd == "start_profile_by_id") {
    uint8_t profileId = doc["profile_id"] | doc["id"] | 255;
    if (profileId != 255) {
      startProfileById(profileId);
    } else {
      Serial.println("ERROR: profile_id not provided");
      DynamicJsonDocument response(256);
      response["status"] = "error";
      response["error"] = "profile_id not provided";
      sendResponse(response);
    }
  } else if (cmd == "stop_profile") {
    stopProfile();
  } else if (cmd == "start_calibration") {
    startCalibration();
  } else if (cmd == "set_calibration_point") {
    int step = doc["step"];
    float pressure = doc["pressure"];
    setCalibrationPoint(step, pressure);
  } else if (cmd == "get_status") {
    sendStatusUpdate();
  } else if (cmd == "set_default_profile") {
    int button = doc["button"];
    uint8_t profileId = doc["profileId"];
    setDefaultProfile(button, profileId);
  } else if (cmd == "set_calibration_data") {
    setCalibrationData(doc["calibration"]);
  } else if (cmd == "get_calibration_status") {
    sendCalibrationStatus();
  } else if (cmd == "store_profile" || cmd == "") {
    // Handle both full and optimized (shortened) command format
    uint8_t id;
    JsonObject profile;
    
    // Check for optimized format (cmd = "", id directly in root)
    if (cmd == "" && doc.containsKey("id") && doc.containsKey("p")) {
      id = doc["id"];
      profile = doc["p"];
    } else {
      // Standard format
      id = doc["id"];
      profile = doc["profile"];
    }
    
    storeProfile(id, profile);
  } else if (cmd == "set_default_profile") {
    int button = doc["button"];
    uint8_t profileId = doc["profileId"];
    setDefaultProfile(button, profileId);
  } else if (cmd == "get_profile_status") {
    sendProfileStatus();
  } else if (cmd == "set_wifi_credentials") {
    const char* ssid = doc["ssid"];
    const char* password = doc["password"];
    setWiFiCredentials(ssid, password);
  } else if (cmd == "ota_update") {
    const char* firmwareUrl = doc["firmware_url"];
    if (firmwareUrl) {
      performOTAUpdate(firmwareUrl);
    } else {
      Serial.println("ERROR: firmware_url not provided");
      DynamicJsonDocument response(256);
      response["status"] = "ota_error";
      response["error"] = "firmware_url not provided";
      sendResponse(response);
    }
  } else if (cmd == "clear_all_profiles") {
    // Clear all stored profiles
    for (int i = 0; i < 10; i++) {
      storedProfiles[i].id = 255; // Mark as empty
      storedProfiles[i].name[0] = '\0';
      storedProfiles[i].segmentCount = 0;
      storedProfiles[i].totalDuration = 0;
      storedProfiles[i].checksum = 0;
    }
    profileCount = 0;
    
    String logMsg = "All profiles cleared on ESP32";
    Serial.println(logMsg);
    sendLogMessage(logMsg.c_str(), "info");
    
    DynamicJsonDocument response(256);
    response["status"] = "profiles_cleared";
    response["profile_count"] = 0;
    sendResponse(response);
  } else if (cmd == "set_pwm_test_mode") {
    bool enable = doc["enable"] | false;
    
    // First, turn off dimmer
    setDimLevel(0);
    
    pwmTestMode = enable;
    
    if (pwmTestMode) {
      // Disable ZC interrupt, use direct PWM
      detachInterrupt(digitalPinToInterrupt(ZERO_CROSS_PIN));
      zcEnabled = false;
      
      // Setup LEDC PWM channel
      ledcSetup(0, 1000, 8);  // Channel 0, 1kHz, 8-bit
      ledcAttachPin(DIMMER_PIN, 0);
      ledcWrite(0, 0);  // Start at 0
      
      Serial.println("========================================");
      Serial.println("[DIMMER] PWM TEST MODE ENABLED");
      Serial.println("  Zero-cross: DISABLED");
      Serial.println("  Direct PWM output on GPIO25");
      Serial.println("  Use set_dim_level to control");
      Serial.println("========================================");
      sendLogMessage("PWM test mode ENABLED - ZC disabled", "warn");
    } else {
      // Disable PWM, re-enable ZC
      ledcDetachPin(DIMMER_PIN);
      pinMode(DIMMER_PIN, OUTPUT);
      digitalWrite(DIMMER_PIN, LOW);
      
      attachInterrupt(digitalPinToInterrupt(ZERO_CROSS_PIN), zeroCrossISR, FALLING);
      zcEnabled = true;
      
      Serial.println("[DIMMER] PWM test mode DISABLED - TRIAC mode active");
      sendLogMessage("PWM test mode DISABLED - TRIAC mode", "info");
    }
    
    DynamicJsonDocument response(256);
    response["status"] = "pwm_test_mode_set";
    response["enabled"] = pwmTestMode;
    response["zc_enabled"] = zcEnabled;
    sendResponse(response);
  } else if (cmd == "set_dim_level") {
    int level = doc["level"] | 0;
    setDimLevel(level);
    
    DynamicJsonDocument response(256);
    response["status"] = "dim_level_set";
    response["level"] = dimmerLevel;
    response["mode"] = (dimmerMode == DIM_OFF) ? "OFF" : "ON";
    response["delay_us"] = pulseDelayUs;
    sendResponse(response);
  } else if (cmd == "set_zc_enabled") {
    bool enabled = doc["enabled"] | true;
    zcEnabled = enabled;
    
    if (enabled) {
      attachInterrupt(digitalPinToInterrupt(ZERO_CROSS_PIN), zeroCrossISR, FALLING);
      Serial.println("[ZC] Zero-cross detection enabled");
    } else {
      detachInterrupt(digitalPinToInterrupt(ZERO_CROSS_PIN));
      Serial.println("[ZC] Zero-cross detection disabled");
    }
    
    DynamicJsonDocument response(256);
    response["status"] = "zc_enabled_set";
    response["enabled"] = zcEnabled;
    sendResponse(response);
  } else if (cmd == "sanity_test") {
    Serial.println("========================================");
    Serial.println("[SANITY TEST] Starting DIM sanity test");
    Serial.println("  Phase 1: OFF for 2 seconds");
    Serial.println("  Phase 2: 50% for 2 seconds");
    Serial.println("  Phase 3: 100% for 2 seconds");
    Serial.println("  Phase 4: OFF");
    Serial.println("========================================");
    
    setDimLevel(0);
    delay(2000);
    
    setDimLevel(50);
    delay(2000);
    
    setDimLevel(100);
    delay(2000);
    
    setDimLevel(0);
    
    Serial.println("[SANITY TEST] Complete");
    
    DynamicJsonDocument response(256);
    response["status"] = "sanity_test_complete";
    sendResponse(response);
  } else if (cmd == "get_dimmer_stats") {
    DynamicJsonDocument response(512);
    response["status"] = "dimmer_stats";
    response["mode"] = (dimmerMode == DIM_OFF) ? "OFF" : "TRIAC";
    response["level"] = dimmerLevel;
    response["delay_us"] = pulseDelayUs;
    response["pulse_count"] = pulseCount;
    sendResponse(response);
  }
}

void startProfile(JsonObject profile) {
  if (isRunning) {
    stopProfile();
  }
  
  // Clean up old document if it exists
  if (profileDoc != NULL) {
    delete profileDoc;
    profileDoc = NULL;
  }
  
  // Create new document to hold profile segments
  profileDoc = new DynamicJsonDocument(4096);
  profileSegments = profileDoc->createNestedArray("segments");
  
  // Copy segments from incoming profile to our document
  JsonArray sourceSegments = profile["segments"];
  totalSegments = sourceSegments.size();
  
  for (int i = 0; i < totalSegments; i++) {
    JsonObject sourceSeg = sourceSegments[i];
    JsonObject destSeg = profileSegments.createNestedObject();
    
    // Copy all fields (support both full and shortened names)
    if (sourceSeg.containsKey("startTime")) {
      destSeg["startTime"] = sourceSeg["startTime"];
    } else if (sourceSeg.containsKey("st")) {
      destSeg["startTime"] = sourceSeg["st"];
    }
    if (sourceSeg.containsKey("endTime")) {
      destSeg["endTime"] = sourceSeg["endTime"];
    } else if (sourceSeg.containsKey("et")) {
      destSeg["endTime"] = sourceSeg["et"];
    }
    if (sourceSeg.containsKey("startPressure")) {
      destSeg["startPressure"] = sourceSeg["startPressure"];
    } else if (sourceSeg.containsKey("sp")) {
      destSeg["startPressure"] = sourceSeg["sp"];
    }
    if (sourceSeg.containsKey("endPressure")) {
      destSeg["endPressure"] = sourceSeg["endPressure"];
    } else if (sourceSeg.containsKey("ep")) {
      destSeg["endPressure"] = sourceSeg["ep"];
    }
  }
  
  currentSegment = 0;
  startTime = millis();
  isRunning = true;
  
  // IMPORTANT: Update button state tracking to match actual button state when profile starts
  // This prevents false emergency stops right after profile start
  // Note: startProfile() is called from BLE, so we don't know which button triggered it
  // Initialize states based on actual button state - only enable emergency stop if button is pressed
  lastButton1State = digitalRead(BUTTON_1_PIN);  // Read actual state
  lastButton2State = digitalRead(BUTTON_2_PIN);  // Read actual state
  lastButton1Time = millis();
  lastButton2Time = millis();
  
  // Initialize flags based on actual button states
  // Only enable emergency stop check if button is actually pressed (LOW)
  if (lastButton1State == LOW) {
    button1StateInitialized = true;  // Button is pressed - ready for emergency stop check
    Serial.println("DEBUG: Button1 initialized as LOW (pressed) for BLE-started profile");
  } else {
    button1StateInitialized = false;  // Button not pressed - don't check for emergency stop
    Serial.println("DEBUG: Button1 initialized as HIGH (not pressed) - emergency stop disabled");
  }
  
  if (lastButton2State == LOW) {
    button2StateInitialized = true;  // Button is pressed - ready for emergency stop check
    Serial.println("DEBUG: Button2 initialized as LOW (pressed) for BLE-started profile");
  } else {
    button2StateInitialized = false;  // Button not pressed - don't check for emergency stop
    Serial.println("DEBUG: Button2 initialized as HIGH (not pressed) - emergency stop disabled");
  }
  
  String profileName = profile["name"] | "Unnamed";
  String logMsg = "Brew profile started: \"" + profileName + "\" (" + String(totalSegments) + " segments)";
  Serial.println(logMsg);
  sendLogMessage(logMsg.c_str(), "info");
  
  // Debug: Log segment data
  Serial.println("DEBUG startProfile: totalSegments=" + String(totalSegments) + ", startTime=" + String(startTime));
  for (int i = 0; i < totalSegments && i < 5; i++) {
    JsonObject seg = profileSegments[i];
    int st = seg.containsKey("startTime") ? seg["startTime"] : (seg.containsKey("st") ? seg["st"] : 0);
    int et = seg.containsKey("endTime") ? seg["endTime"] : (seg.containsKey("et") ? seg["et"] : 0);
    float sp = seg.containsKey("startPressure") ? seg["startPressure"].as<float>() : (seg.containsKey("sp") ? seg["sp"].as<float>() : 0.0f);
    float ep = seg.containsKey("endPressure") ? seg["endPressure"].as<float>() : (seg.containsKey("ep") ? seg["ep"].as<float>() : 0.0f);
    Serial.println("  Segment " + String(i) + ": " + String(st) + "s-" + String(et) + "s, " + String(sp, 1) + "→" + String(ep, 1) + " bar");
  }
  
  // Send confirmation
  DynamicJsonDocument response(256);
  response["status"] = "profile_started";
  response["profile_id"] = 255; // Unknown for ad-hoc BLE profile
  response["profile_name"] = profileName;
  response["segments"] = totalSegments;
  response["start_time"] = startTime; // millis since boot
  sendResponse(response);
}

void stopProfile() {
  if (!isRunning) {
    // Already stopped, nothing to do
    return;
  }
  
  isRunning = false;
  setDimLevel(0);
  Serial.println("[DIMMER] Force OFF executed");
  
  unsigned long duration = 0;
  if (startTime > 0) {
    duration = (millis() - startTime) / 1000; // Duration in seconds
  }
  
  String logMsg = "Brew profile finished (duration: " + String(duration) + "s)";
  Serial.println(logMsg);
  sendLogMessage(logMsg.c_str(), "info");
  
  // IMPORTANT: Reset emergency stop initialization flags
  // This prevents false emergency stops when starting a new profile
  button1StateInitialized = false;
  button2StateInitialized = false;
  Serial.println("DEBUG: Reset button state initialization flags");
  
  // Clean up profile document
  if (profileDoc != NULL) {
    delete profileDoc;
    profileDoc = NULL;
  }
  
  // Reset startTime to prevent reuse
  startTime = 0;
  currentSegment = 0;
  totalSegments = 0;
  
  DynamicJsonDocument response(256);
  response["status"] = "profile_stopped";
  response["duration"] = duration;
  sendResponse(response);
}

void executeProfile() {
  if (currentSegment >= totalSegments) {
    stopProfile();
    return;
  }
  
  // Calculate current time with 1 decimal precision
  float currentTime = (float)(millis() - startTime) / 1000.0f; // Convert to seconds with 1 decimal
  
  // Safety check: ensure currentSegment is valid
  if (!profileDoc || !profileSegments || profileSegments.size() == 0 || currentSegment >= profileSegments.size()) {
    Serial.println("ERROR: Invalid segment index - profileDoc=" + String(profileDoc != NULL ? "OK" : "NULL") + 
                   ", profileSegments.size()=" + String(profileSegments.size()) + 
                   ", currentSegment=" + String(currentSegment) + 
                   ", totalSegments=" + String(totalSegments));
    stopProfile();
    return;
  }
  
  JsonObject segment = profileSegments[currentSegment];
  
  // Read segment data with proper fallback values - support both full and shortened field names
  int segmentStartTime = segment.containsKey("startTime") ? segment["startTime"] : (segment.containsKey("st") ? segment["st"] : 0);
  int segmentEndTime = segment.containsKey("endTime") ? segment["endTime"] : (segment.containsKey("et") ? segment["et"] : 0);
  
  float startPressure = 0.0f;
  if (segment.containsKey("startPressure")) {
    startPressure = segment["startPressure"].as<float>();
  } else if (segment.containsKey("sp")) {
    startPressure = segment["sp"].as<float>();
  }
  
  float endPressure = 0.0f;
  if (segment.containsKey("endPressure")) {
    endPressure = segment["endPressure"].as<float>();
  } else if (segment.containsKey("ep")) {
    endPressure = segment["ep"].as<float>();
  }
  
  // Safety check: ensure valid time range
  if (segmentEndTime <= segmentStartTime) {
    // Invalid segment, move to next
    Serial.println("WARNING: Invalid segment time range, skipping");
    currentSegment++;
    return;
  }
  
  // Log when entering a new segment
  static int lastLoggedSegment = -1;
  if (currentSegment != lastLoggedSegment && currentTime >= (float)segmentStartTime) {
    String msg = "[" + String(currentTime, 1) + "s] Profile segment " + String(currentSegment + 1) + "/" + String(totalSegments) + 
                 ": " + String(segmentStartTime) + "s-" + String(segmentEndTime) + "s, " + 
                 String(startPressure, 1) + "→" + String(endPressure, 1) + " bar";
    Serial.println(msg);
    sendLogMessage(msg.c_str(), "info");
    lastLoggedSegment = currentSegment;
  }
  
  // Debug: Log current time and segment info every 5 seconds
  static unsigned long lastDebugTime = 0;
  if (millis() - lastDebugTime >= 5000) {
    String debugMsg = "[" + String(currentTime, 1) + "s] DEBUG: currentTime=" + String(currentTime, 1) + "s, segment=" + String(currentSegment) + 
                      ", startTime=" + String(segmentStartTime) + "s, endTime=" + String(segmentEndTime) + 
                      "s, isRunning=" + String(isRunning) + ", totalSegments=" + String(totalSegments);
    Serial.println(debugMsg);
    lastDebugTime = millis();
  }
  
  // Check if we're before the segment starts
  if (currentTime < (float)segmentStartTime) {
    // Not yet time for this segment, wait
    // Set dim level to 0 while waiting
    if (currentSegment == 0) {
      setDimLevel(0);
    }
    return;
  }
  
  if (currentTime >= (float)segmentStartTime && currentTime <= (float)segmentEndTime) {
    // Calculate target pressure for current time
    int segmentDuration = segmentEndTime - segmentStartTime;
    if (segmentDuration <= 0) {
      // Safety check: avoid division by zero
      Serial.println("[" + String(currentTime, 1) + "s] ERROR: Segment duration is zero or negative (start=" + String(segmentStartTime) + ", end=" + String(segmentEndTime) + ")");
      stopProfile();
      return;
    }
    
    float progress = (currentTime - (float)segmentStartTime) / (float)segmentDuration;
    // Clamp progress between 0 and 1
    if (progress < 0.0f) progress = 0.0f;
    if (progress > 1.0f) progress = 1.0f;
    
    float targetPressure = startPressure + (endPressure - startPressure) * progress;
    
    // Safety check: ensure targetPressure is valid
    if (isnan(targetPressure) || isinf(targetPressure)) {
      Serial.println("ERROR: Invalid target pressure calculated (start=" + String(startPressure, 2) + ", end=" + String(endPressure, 2) + ", progress=" + String(progress, 3) + ")");
      targetPressure = 0.0f;
    }
    
    // Convert pressure to dim level and set
    int dimLevel = pressureToDimLevel(targetPressure);
    
    // Debug: Log pressure to dim level conversion
    static float lastTargetPressure = -1.0f;
    if (abs(targetPressure - lastTargetPressure) > 0.1f) {
      Serial.println("DEBUG: pressureToDimLevel(" + String(targetPressure, 2) + " bar) = " + String(dimLevel) + "%, isCalibrated=" + String(isCalibrated));
      lastTargetPressure = targetPressure;
    }
    
    // Log dim level changes (every second or when level changes significantly)
    static int lastLoggedDimLevel = -1;
    static unsigned long lastLogTime = 0;
    bool shouldLog = false;
    
    if (dimLevel != lastLoggedDimLevel) {
      shouldLog = true; // Always log when dim level changes
    } else if (millis() - lastLogTime >= 1000) {
      shouldLog = true; // Log at least once per second
    }
    
    if (shouldLog) {
      String msg = "[" + String(currentTime, 1) + "s] Brew: Target: " + String(targetPressure, 1) + " bar | Dim: " + String(dimLevel) + "%";
      Serial.println(msg);
      sendLogMessage(msg.c_str(), "info");
      lastLoggedDimLevel = dimLevel;
      lastLogTime = millis();
    }
    
    setDimLevel(dimLevel);
    
    // Send pressure update
    DynamicJsonDocument update(256);
    update["type"] = "pressure_update";
    update["current_pressure"] = getCurrentPressure();
    update["target_pressure"] = targetPressure;
    update["current_time"] = currentTime;
    sendResponse(update);
  } else if (currentTime > (float)segmentEndTime) {
    // Move to next segment
    Serial.println("[" + String(currentTime, 1) + "s] Moving to next segment: " + String(currentTime, 1) + "s > " + String(segmentEndTime) + "s");
    currentSegment++;
    lastLoggedSegment = currentSegment - 1; // Reset so new segment gets logged
  }
}

// setDimLevel is defined above (wrapper to setTriacLevel)

float getCurrentPressure() {
  // Manual pressure reading - user reads from manometer
  // This function is called during calibration to get user input
  // For now, return 0 as placeholder
  return 0.0;
}

int pressureToDimLevel(float pressure) {
  if (!isCalibrated) {
    // Fallback: linear mapping assuming 0-12 bar range
    return map(pressure * 100, 0, 1200, 0, 100);
  }
  
  // Use calibration data to find closest dim level
  int bestLevel = 0;
  float bestDiff = 999.0;
  
  for (int i = 0; i <= 10; i++) {
    float calibPressure = dimLevelToPressure[i];
    float diff = abs(pressure - calibPressure);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = i * 10;
    }
  }
  
  return bestLevel;
}

void startCalibration() {
  Serial.println("Starting calibration...");
  
  DynamicJsonDocument response(256);
  response["status"] = "calibration_started";
  response["steps"] = 10;
  sendResponse(response);
}

void setCalibrationPoint(int step, float pressure) {
  if (step >= 0 && step <= 10) {
    dimLevelToPressure[step] = pressure;
    Serial.println("Calibration point " + String(step) + ": " + String(pressure) + " bar");
    
    if (step == 10) {
      isCalibrated = true;
      Serial.println("Calibration completed");
    }
  }
}

void setCalibrationData(JsonObject calibration) {
  // Validate input
  if (calibration.size() == 0) {
    Serial.println("Error: No calibration data received");
    DynamicJsonDocument response(256);
    response["status"] = "calibration_error";
    response["error"] = "No data received";
    sendResponse(response);
    return;
  }
  
  // Clear existing calibration data
  for (int i = 0; i <= 10; i++) {
    dimLevelToPressure[i] = 0;
  }
  
  int validPoints = 0;
  int totalPoints = calibration.size();
  
  // Fill in calibration data from JSON
  for (JsonPair kv : calibration) {
    int dimLevel = atoi(kv.key().c_str());
    float pressure = kv.value().as<float>();
    
    if (dimLevel >= 0 && dimLevel <= 100 && pressure >= 0 && pressure <= 12) {
      int index = dimLevel / 10;
      dimLevelToPressure[index] = pressure;
      validPoints++;
      Serial.println("Calibration: " + String(dimLevel) + "% -> " + String(pressure) + " bar");
    } else {
      Serial.println("Invalid calibration point: " + String(dimLevel) + "% -> " + String(pressure) + " bar");
    }
  }
  
  if (validPoints > 0) {
    isCalibrated = true;
    
    // Save calibration data to NVS
    saveCalibrationData();
    
    String logMsg = "Calibration data saved: " + String(validPoints) + " valid points (" + String(totalPoints) + " total)";
    Serial.println(logMsg);
    sendLogMessage(logMsg.c_str(), "info");
    
    // Send detailed confirmation
    DynamicJsonDocument response(512);
    response["status"] = "calibration_data_set";
    response["total_points"] = totalPoints;
    response["valid_points"] = validPoints;
    response["is_calibrated"] = true;
    response["timestamp"] = millis();
    
    // Include the actual calibration data for verification
    JsonObject calibData = response.createNestedObject("calibration_data");
    for (int i = 0; i <= 10; i++) {
      if (dimLevelToPressure[i] > 0) {
        calibData[String(i * 10)] = dimLevelToPressure[i];
      }
    }
    
    sendResponse(response);
  } else {
    Serial.println("Error: No valid calibration points received");
    DynamicJsonDocument response(256);
    response["status"] = "calibration_error";
    response["error"] = "No valid points";
    response["total_points"] = totalPoints;
    response["valid_points"] = 0;
    sendResponse(response);
  }
}

void sendCalibrationStatus() {
  DynamicJsonDocument response(512);
  response["type"] = "calibration_status";
  response["is_calibrated"] = isCalibrated;
  
  if (isCalibrated) {
    JsonObject calibData = response.createNestedObject("calibration_data");
    for (int i = 0; i <= 10; i++) {
      if (dimLevelToPressure[i] > 0) {
        calibData[String(i * 10)] = dimLevelToPressure[i];
      }
    }
  }
  
  sendResponse(response);
}

void sendProfileStatus() {
  DynamicJsonDocument response(1024);
  response["type"] = "profile_status";
  response["profile_count"] = profileCount;
  response["default_profile1"] = defaultProfile1;
  response["default_profile2"] = defaultProfile2;
  
  JsonArray profiles = response.createNestedArray("profiles");
  for (int i = 0; i < profileCount; i++) {
    JsonObject profile = profiles.createNestedObject();
    profile["id"] = storedProfiles[i].id;
    profile["name"] = storedProfiles[i].name;
    profile["segment_count"] = storedProfiles[i].segmentCount;
    profile["total_duration"] = storedProfiles[i].totalDuration;
    profile["checksum_valid"] = (calculateChecksum(storedProfiles[i]) == storedProfiles[i].checksum);
  }
  
  sendResponse(response);
}

void sendStatusUpdate() {
  DynamicJsonDocument status(1024);
  status["type"] = "status_update";
  status["current_pressure"] = getCurrentPressure();
  status["is_running"] = isRunning;
  status["current_segment"] = currentSegment;
  status["total_segments"] = totalSegments;
  status["uptime"] = millis() / 1000;
  status["is_calibrated"] = isCalibrated;
  
  // Add profile information
  status["profile_count"] = profileCount;
  status["default_profile1"] = defaultProfile1;
  status["default_profile2"] = defaultProfile2;
  
  // Add default profile names if set
  if (defaultProfile1 != 255 && defaultProfile1 < profileCount) {
    status["default_profile1_name"] = storedProfiles[defaultProfile1].name;
  } else {
    status["default_profile1_name"] = "";
  }
  
  if (defaultProfile2 != 255 && defaultProfile2 < profileCount) {
    status["default_profile2_name"] = storedProfiles[defaultProfile2].name;
  } else {
    status["default_profile2_name"] = "";
  }
  
  sendResponse(status);
}

void checkHardwareButtons() {
  // Read button states
  // Note: INPUT_PULLUP means LOW = pressed, HIGH = not pressed (0 = button off)
  bool button1State = digitalRead(BUTTON_1_PIN);
  bool button2State = digitalRead(BUTTON_2_PIN);
  
  unsigned long currentTime = millis();
  
  // Power-up safety: Clear when switch goes to OFF
  if (powerUpSafetyActive) {
    if (button1State == HIGH && button2State == HIGH) {
      powerUpSafetyActive = false;
      Serial.println("[SWITCH] Power-up safety cleared - switch moved to OFF");
      Serial.println("[SWITCH] You can now toggle ON to start program");
    }
    // Don't process button presses while power-up safety is active
    lastButton1State = button1State;
    lastButton2State = button2State;
    return;
  }
  
  // Check button 1 (Profile 1)
  if (button1State != lastButton1State) {
    if (currentTime - lastButton1Time > DEBOUNCE_DELAY) {
      if (button1State == LOW) {
        Serial.println("[SWITCH] Transition: OFF -> ON1 (Program 1)");
        sendLogMessage("[SWITCH] OFF -> ON1: Starting Program 1", "info");
        
        if (isRunning) {
          Serial.println("[SWITCH] -> OFF: Stopping program");
          sendLogMessage("[SAFETY] Stopping profile - setting dimmer to OFF", "warn");
          stopProfile();
          lastButton1Time = currentTime;
          lastButton1State = button1State;
          return;
        }

        if (defaultProfile1 != 255) {
          Serial.println("Starting default profile 1 (ID: " + String(defaultProfile1) + ")");
          startDefaultProfile(1);
        } else {
          Serial.println("[SWITCH] SW1: No default profile set");
          sendLogMessage("[SWITCH] SW1: No default profile set", "warn");
        }
      } else {
        Serial.println("[SWITCH] Transition: ON1 (Program 1) -> OFF");
        if (isRunning) {
          Serial.println("[SWITCH] -> OFF: Stopping program");
          sendLogMessage("[SAFETY] Stopping profile - setting dimmer to OFF", "warn");
          stopProfile();
        }
      }
      lastButton1Time = currentTime;
    }
    lastButton1State = button1State;
  }
  
  // Check button 2 (Profile 2)
  if (button2State != lastButton2State) {
    if (currentTime - lastButton2Time > DEBOUNCE_DELAY) {
      if (button2State == LOW) {
        Serial.println("[SWITCH] Transition: OFF -> ON2 (Program 2)");
        sendLogMessage("[SWITCH] OFF -> ON2: Starting Program 2", "info");
        
        if (isRunning) {
          Serial.println("[SWITCH] -> OFF: Stopping program");
          sendLogMessage("[SAFETY] Stopping profile - setting dimmer to OFF", "warn");
          stopProfile();
          lastButton2Time = currentTime;
          lastButton2State = button2State;
          return;
        }

        if (defaultProfile2 != 255) {
          Serial.println("Starting default profile 2 (ID: " + String(defaultProfile2) + ")");
          startDefaultProfile(2);
        } else {
          Serial.println("[SWITCH] SW2: No default profile set");
          sendLogMessage("[SWITCH] SW2: No default profile set", "warn");
        }
      } else {
        Serial.println("[SWITCH] Transition: ON2 (Program 2) -> OFF");
        if (isRunning) {
          Serial.println("[SWITCH] -> OFF: Stopping program");
          sendLogMessage("[SAFETY] Stopping profile - setting dimmer to OFF", "warn");
          stopProfile();
        }
      }
      lastButton2Time = currentTime;
    }
    lastButton2State = button2State;
  }
}

// Calculate checksum for profile validation
uint8_t calculateChecksum(CompactProfile& profile) {
  uint8_t sum = 0;
  uint8_t* data = (uint8_t*)&profile;
  for (int i = 0; i < sizeof(CompactProfile) - 1; i++) {
    sum += data[i];
  }
  return sum;
}

// Store profile in compact format
bool storeProfile(uint8_t id, JsonObject profileData) {
  if (id >= 10) return false;
  
  CompactProfile& profile = storedProfiles[id];
  profile.id = id;
  
  // Copy name (truncate if too long) - support both "name" and "n" (optimized)
  String name = profileData["name"] | profileData["n"] | "";
  strncpy(profile.name, name.c_str(), 15);
  profile.name[15] = '\0';
  
  // Process segments - support both "segments" and "s" (optimized)
  JsonArray segments;
  if (profileData.containsKey("segments")) {
    segments = profileData["segments"];
  } else if (profileData.containsKey("s")) {
    segments = profileData["s"];
  } else {
    return false; // No segments found
  }
  
  profile.segmentCount = min(segments.size(), (size_t)10);
  profile.totalDuration = 0;
  
  for (int i = 0; i < profile.segmentCount; i++) {
    JsonObject segment = segments[i];
    
    // Convert to compact format - support both full and shortened field names
    profile.segments[i].startTime = segment.containsKey("startTime") ? segment["startTime"] : segment["st"] | 0;
    profile.segments[i].endTime = segment.containsKey("endTime") ? segment["endTime"] : segment["et"] | 0;
    
    float startPress = segment.containsKey("startPressure") ? segment["startPressure"].as<float>() : (segment.containsKey("sp") ? segment["sp"].as<float>() : 0.0f);
    float endPress = segment.containsKey("endPressure") ? segment["endPressure"].as<float>() : (segment.containsKey("ep") ? segment["ep"].as<float>() : 0.0f);
    
    profile.segments[i].startPressure = (uint8_t)(startPress * 10); // Convert to 0-120
    profile.segments[i].endPressure = (uint8_t)(endPress * 10);
    
    profile.totalDuration = max(profile.totalDuration, (uint8_t)profile.segments[i].endTime);
  }
  
  // Calculate checksum
  profile.checksum = calculateChecksum(profile);
  
  // Update profile count
  if (id >= profileCount) {
    profileCount = id + 1;
  }
  
  String logMsg = "Profile synced: ID " + String(id) + " - \"" + String(profile.name) + "\" (" + String(profile.segmentCount) + " segments, " + String(profile.totalDuration) + "s)";
  Serial.println(logMsg);
  sendLogMessage(logMsg.c_str(), "info");
  
  // Save profiles to NVS
  saveProfiles();
  
  return true;
}

void setDefaultProfile(int button, uint8_t profileId) {
  String buttonName = (button == 1) ? "SW1" : "SW2";
  
  // Allow profileId 255 (no profile) or 0-9
  if (profileId != 255 && profileId >= 10) {
    String errorMsg = "Invalid profile ID: " + String(profileId);
    Serial.println(errorMsg);
    sendLogMessage(errorMsg.c_str(), "error");
    return;
  }
  
  if (button == 1) {
    defaultProfile1 = profileId;
    if (profileId == 255) {
      String logMsg = "Cleared: " + buttonName + " (Button 1) - no profile assigned";
      Serial.println(logMsg);
      sendLogMessage(logMsg.c_str(), "info");
    } else {
      String logMsg = "Synced: " + buttonName + " (Button 1) -> Profile ID " + String(profileId);
      Serial.println(logMsg);
      sendLogMessage(logMsg.c_str(), "info");
    }
  } else if (button == 2) {
    defaultProfile2 = profileId;
    if (profileId == 255) {
      String logMsg = "Cleared: " + buttonName + " (Button 2) - no profile assigned";
      Serial.println(logMsg);
      sendLogMessage(logMsg.c_str(), "info");
    } else {
      String logMsg = "Synced: " + buttonName + " (Button 2) -> Profile ID " + String(profileId);
      Serial.println(logMsg);
      sendLogMessage(logMsg.c_str(), "info");
    }
  }
  
  // Save default profiles to NVS
  saveDefaultProfiles();
  
  // Send confirmation
  DynamicJsonDocument response(256);
  response["status"] = "default_profile_set";
  response["button"] = button;
  response["profileId"] = profileId;
  sendResponse(response);
}

void startDefaultProfile(int button) {
  uint8_t profileId = (button == 1) ? defaultProfile1 : defaultProfile2;
  String buttonName = (button == 1) ? "SW1" : "SW2";
  
  if (profileId == 255) {
    String msg = "No default profile set for " + buttonName;
    Serial.println(msg);
    sendLogMessage(msg.c_str(), "warn");
    return;
  }
  
  if (profileId >= profileCount) {
    String msg = "Invalid profile ID: " + String(profileId) + " for " + buttonName;
    Serial.println(msg);
    sendLogMessage(msg.c_str(), "error");
    return;
  }
  
  // Validate checksum
  CompactProfile& profile = storedProfiles[profileId];
  if (calculateChecksum(profile) != profile.checksum) {
    String msg = "Profile checksum validation failed for ID: " + String(profileId) + " (triggered by " + buttonName + ")";
    Serial.println(msg);
    sendLogMessage(msg.c_str(), "error");
    return;
  }
  
  // Start the stored profile
  String msg = buttonName + " triggered: Starting profile \"" + String(profile.name) + "\" (ID: " + String(profileId) + ")";
  Serial.println(msg);
  sendLogMessage(msg.c_str(), "info");
  
  // Clean up old document if it exists
  if (profileDoc != NULL) {
    delete profileDoc;
    profileDoc = NULL;
  }
  
  // Create new document to hold profile segments
  profileDoc = new DynamicJsonDocument(4096);
  profileSegments = profileDoc->createNestedArray("segments");
  totalSegments = profile.segmentCount;
  
  Serial.println("DEBUG startDefaultProfile: Converting profile ID " + String(profileId) + " with " + String(profile.segmentCount) + " segments");
  
  for (int i = 0; i < profile.segmentCount; i++) {
    JsonObject segment = profileSegments.createNestedObject();
    segment["startTime"] = profile.segments[i].startTime;
    segment["endTime"] = profile.segments[i].endTime;
    segment["startPressure"] = profile.segments[i].startPressure / 10.0;
    segment["endPressure"] = profile.segments[i].endPressure / 10.0;
    
    Serial.println("  Segment " + String(i) + ": " + String(profile.segments[i].startTime) + "s-" + 
                   String(profile.segments[i].endTime) + "s, " + 
                   String(profile.segments[i].startPressure / 10.0, 1) + "→" + 
                   String(profile.segments[i].endPressure / 10.0, 1) + " bar");
  }
  
  // Verify segments were created
  Serial.println("DEBUG startDefaultProfile: profileSegments.size()=" + String(profileSegments.size()) + ", totalSegments=" + String(totalSegments));
  
  // Start profile execution
  currentSegment = 0;
  startTime = millis();
  isRunning = true;
  
  // IMPORTANT: Update button state tracking to match actual button state when profile starts
  // This prevents false emergency stops right after profile start
  if (button == 1) {
    lastButton1State = digitalRead(BUTTON_1_PIN);  // Read actual state
    lastButton1Time = millis();
    // Initialize flag based on actual button state
    if (lastButton1State == LOW) {
      button1StateInitialized = true;  // Button is pressed - ready for emergency stop check
      Serial.println("DEBUG: Button1 initialized as LOW (pressed) for this profile");
    } else {
      button1StateInitialized = false;  // Button not pressed - don't check for emergency stop
      Serial.println("DEBUG: Button1 initialized as HIGH (not pressed) - emergency stop disabled");
    }
  } else if (button == 2) {
    lastButton2State = digitalRead(BUTTON_2_PIN);  // Read actual state
    lastButton2Time = millis();
    // Initialize flag based on actual button state
    if (lastButton2State == LOW) {
      button2StateInitialized = true;  // Button is pressed - ready for emergency stop check
      Serial.println("DEBUG: Button2 initialized as LOW (pressed) for this profile");
    } else {
      button2StateInitialized = false;  // Button not pressed - don't check for emergency stop
      Serial.println("DEBUG: Button2 initialized as HIGH (not pressed) - emergency stop disabled");
    }
  }
  
  Serial.println("DEBUG startDefaultProfile: startTime=" + String(startTime) + ", totalSegments=" + String(totalSegments) + ", isRunning=" + String(isRunning));
  
  // Send confirmation
  DynamicJsonDocument response(256);
  response["status"] = "profile_started";
  response["profile_id"] = profileId;
  response["profile_name"] = profile.name;
  response["segments"] = profile.segmentCount;
  response["start_time"] = startTime; // millis since boot
  sendResponse(response);
}

void startProfileById(uint8_t profileId) {
  if (profileId >= profileCount) {
    String msg = "Invalid profile ID: " + String(profileId);
    Serial.println(msg);
    sendLogMessage(msg.c_str(), "error");
    return;
  }
  
  CompactProfile& profile = storedProfiles[profileId];
  if (calculateChecksum(profile) != profile.checksum) {
    String msg = "Profile checksum validation failed for ID: " + String(profileId);
    Serial.println(msg);
    sendLogMessage(msg.c_str(), "error");
    return;
  }
  
  String msg = "Starting profile \"" + String(profile.name) + "\" (ID: " + String(profileId) + ")";
  Serial.println(msg);
  sendLogMessage(msg.c_str(), "info");
  
  if (profileDoc != NULL) {
    delete profileDoc;
    profileDoc = NULL;
  }
  
  profileDoc = new DynamicJsonDocument(4096);
  profileSegments = profileDoc->createNestedArray("segments");
  totalSegments = profile.segmentCount;
  
  for (int i = 0; i < profile.segmentCount; i++) {
    JsonObject segment = profileSegments.createNestedObject();
    segment["startTime"] = profile.segments[i].startTime;
    segment["endTime"] = profile.segments[i].endTime;
    segment["startPressure"] = profile.segments[i].startPressure / 10.0;
    segment["endPressure"] = profile.segments[i].endPressure / 10.0;
  }
  
  currentSegment = 0;
  startTime = millis();
  isRunning = true;
  
  DynamicJsonDocument response(256);
  response["status"] = "profile_started";
  response["profile_id"] = profileId;
  response["profile_name"] = profile.name;
  response["segments"] = profile.segmentCount;
  sendResponse(response);
}

void sendResponse(DynamicJsonDocument& doc) {
  if (deviceConnected && pCharacteristic) {
    String jsonString;
    serializeJson(doc, jsonString);
    
    // Check if message is too long (BLE MTU is typically 20-23 bytes for notifications)
    if (jsonString.length() > 500) {
      Serial.println("WARNING: Message too long, truncating: " + String(jsonString.length()) + " bytes");
      jsonString = jsonString.substring(0, 500);
    }
    
    pCharacteristic->setValue(jsonString.c_str());
    pCharacteristic->notify();
    Serial.println("Sent (" + String(jsonString.length()) + " bytes): " + jsonString);
  } else {
    Serial.println("WARNING: Cannot send response - device not connected or characteristic not initialized");
  }
}

// Send log message via BLE (for Serial Monitor in webapp)
void sendLogMessage(const char* message, const char* level) {
  // Always print to Serial as well
  Serial.println("[LOG] " + String(message));
  
  if (deviceConnected && pCharacteristic) {
    DynamicJsonDocument logDoc(512);
    logDoc["type"] = "serial_log";
    logDoc["message"] = message;
    logDoc["level"] = level;  // "info", "warn", "error", "debug"
    logDoc["timestamp"] = millis();
    
    String jsonString;
    serializeJson(logDoc, jsonString);
    
    // Check if message is too long
    if (jsonString.length() > 500) {
      Serial.println("WARNING: Log message too long, truncating");
      jsonString = jsonString.substring(0, 500);
    }
    
    pCharacteristic->setValue(jsonString.c_str());
    pCharacteristic->notify();
    Serial.println("Log sent via BLE (" + String(jsonString.length()) + " bytes): " + String(message));
  } else {
    Serial.println("DEBUG: Device not connected, skipping BLE log");
  }
}

// WiFi and OTA functions
void setWiFiCredentials(const char* ssid, const char* password) {
  if (ssid && strlen(ssid) > 0) {
    strncpy(wifiSSID, ssid, sizeof(wifiSSID) - 1);
    wifiSSID[sizeof(wifiSSID) - 1] = '\0';
    
    if (password) {
      strncpy(wifiPassword, password, sizeof(wifiPassword) - 1);
      wifiPassword[sizeof(wifiPassword) - 1] = '\0';
    } else {
      wifiPassword[0] = '\0';
    }
    
    wifiConfigured = true;
    Serial.println("WiFi credentials set: SSID=" + String(wifiSSID));
    
    // Send confirmation
    DynamicJsonDocument response(256);
    response["status"] = "wifi_credentials_set";
    response["ssid"] = wifiSSID;
    sendResponse(response);
    
    // Try to connect
    setupWiFi();
  } else {
    Serial.println("ERROR: Invalid WiFi SSID");
    DynamicJsonDocument response(256);
    response["status"] = "wifi_error";
    response["error"] = "Invalid SSID";
    sendResponse(response);
  }
}

void setupWiFi() {
  if (!wifiConfigured || strlen(wifiSSID) == 0) {
    Serial.println("WiFi not configured");
    return;
  }
  
  Serial.println("Connecting to WiFi: " + String(wifiSSID));
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSSID, strlen(wifiPassword) > 0 ? wifiPassword : NULL);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("");
    Serial.println("WiFi connected!");
    Serial.println("IP address: " + WiFi.localIP().toString());
    
    DynamicJsonDocument response(256);
    response["status"] = "wifi_connected";
    response["ip"] = WiFi.localIP().toString();
    sendResponse(response);
  } else {
    wifiConnected = false;
    Serial.println("");
    Serial.println("WiFi connection failed!");
    
    DynamicJsonDocument response(256);
    response["status"] = "wifi_error";
    response["error"] = "Connection failed";
    sendResponse(response);
  }
}

void performOTAUpdate(const char* firmwareUrl) {
  Serial.println("Starting OTA update from: " + String(firmwareUrl));
  
  // Ensure WiFi is connected
  if (!wifiConnected) {
    if (wifiConfigured) {
      setupWiFi();
      if (!wifiConnected) {
        Serial.println("ERROR: WiFi not connected. Cannot perform OTA update.");
        DynamicJsonDocument response(256);
        response["status"] = "ota_error";
        response["error"] = "WiFi not connected";
        sendResponse(response);
        return;
      }
    } else {
      Serial.println("ERROR: WiFi not configured. Cannot perform OTA update.");
      DynamicJsonDocument response(256);
      response["status"] = "ota_error";
      response["error"] = "WiFi not configured";
      sendResponse(response);
      return;
    }
  }
  
  // Send status update
  DynamicJsonDocument response(256);
  response["status"] = "ota_started";
  response["url"] = firmwareUrl;
  sendResponse(response);
  
  // Perform OTA update
  httpUpdate.setLedPin(LED_PIN, LOW);
  
  // Check if URL is HTTPS
  String urlStr = String(firmwareUrl);
  t_httpUpdate_return ret;
  
  if (urlStr.startsWith("https://")) {
    // For HTTPS, use WiFiClientSecure (disable certificate validation for simplicity)
    WiFiClientSecure secureClient;
    secureClient.setInsecure();  // Not recommended for production, but simpler for OTA
    ret = httpUpdate.update(secureClient, firmwareUrl);
  } else {
    // For HTTP, use regular WiFiClient
    WiFiClient client;
    ret = httpUpdate.update(client, firmwareUrl);
  }
  
  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.println("OTA update failed: " + httpUpdate.getLastErrorString());
      // Note: Can't send response here as device may have rebooted
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("OTA update: No updates available");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("OTA update successful! Device will reboot.");
      // Device will reboot automatically
      break;
  }
}
