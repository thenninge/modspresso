#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>

// Pin definitions
#define ZERO_CROSS_PIN 33   // GPIO33 (D33) for zero-cross detection (RobotDyn Mod-Dimmer-5A-1L)
#define DIMMER_PIN 25       // GPIO25 (D25) for AC dimmer control (gate pin - PWM output)
#define LED_PIN 2           // GPIO2 for status LED (built-in LED)
#define BUTTON_1_PIN 18     // GPIO18 (D18) for hardware button 1 (Program 1)
#define BUTTON_2_PIN 19     // GPIO19 (D19) for hardware button 2 (Program 2)
// Note: No pressure sensor pin - using manual manometer reading

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

// Zero-cross dimmer configuration (RobotDyn Mod-Dimmer-5A-1L)
volatile int dimLevel = 0;  // Current dim level (0-100)
volatile unsigned long zeroCrossTime = 0;  // Time of last zero-cross detection
hw_timer_t* dimmerTimer = NULL;  // Hardware timer for phase-angle control
const int AC_FREQ = 50;  // 50Hz AC frequency
const unsigned long HALF_WAVE_TIME = 1000000 / AC_FREQ / 2;  // Time for half wave in microseconds (10000us for 50Hz)

// ISR for zero-cross detection
void IRAM_ATTR zeroCrossISR() {
  zeroCrossTime = micros();
  
  if (dimLevel > 0 && dimLevel < 100) {
    // Calculate delay based on dim level
    // At 0%: delay = half wave (10000us), at 100%: delay = 0
    unsigned long delay = HALF_WAVE_TIME - ((dimLevel * HALF_WAVE_TIME) / 100);
    
    // Start hardware timer to trigger TRIAC after delay
    timerWrite(dimmerTimer, 0);  // Reset timer
    timerAlarmWrite(dimmerTimer, delay, false);  // Set alarm with delay
    timerAlarmEnable(dimmerTimer);
  } else if (dimLevel >= 100) {
    // 100% - turn on immediately (no phase cutting)
    // Note: For 100%, we can use a simple digitalWrite pulse
    // The TRIAC will latch and remain on for the full cycle
    digitalWrite(DIMMER_PIN, HIGH);
    // Use timer to turn off after short pulse (100us)
    timerWrite(dimmerTimer, 0);
    timerAlarmWrite(dimmerTimer, 100, false);  // 100 microseconds
    timerAlarmEnable(dimmerTimer);
  }
  // If dimLevel == 0, do nothing (remain off)
}

// ISR for timer - triggers TRIAC gate or turns it off after pulse
void IRAM_ATTR triggerTRIAC() {
  static bool pulseOn = false;
  
  if (!pulseOn) {
    // Turn on TRIAC gate
    digitalWrite(DIMMER_PIN, HIGH);
    pulseOn = true;
    
    // Schedule turn-off after 100us
    timerWrite(dimmerTimer, 0);
    timerAlarmWrite(dimmerTimer, 100, false);
  } else {
    // Turn off TRIAC gate (pulse complete)
    digitalWrite(DIMMER_PIN, LOW);
    pulseOn = false;
    timerAlarmDisable(dimmerTimer);  // Disable until next zero-cross
  }
}

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
void sendResponse(DynamicJsonDocument& doc);
void sendLogMessage(const char* message, const char* level = "info");

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Device connected");
      digitalWrite(LED_PIN, HIGH);
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

void setup() {
  Serial.begin(115200);
  Serial.println("Starting Espresso Profiler ESP32...");

  // Initialize pins
  pinMode(LED_PIN, OUTPUT);
  pinMode(ZERO_CROSS_PIN, INPUT_PULLUP);  // Zero-cross input from dimmer module (pull-up for safety)
  pinMode(DIMMER_PIN, OUTPUT);  // Gate pin for TRIAC control
  // Button pins with internal pull-up (button connects to GND when pressed)
  pinMode(BUTTON_1_PIN, INPUT_PULLUP);  // GPIO18 - Button 1 (LOW = pressed, HIGH = not pressed)
  pinMode(BUTTON_2_PIN, INPUT_PULLUP);  // GPIO19 - Button 2 (LOW = pressed, HIGH = not pressed)
  digitalWrite(LED_PIN, LOW);
  digitalWrite(DIMMER_PIN, LOW);  // Start with gate off

  // Initialize zero-cross interrupt for phase-angle dimming
  attachInterrupt(digitalPinToInterrupt(ZERO_CROSS_PIN), zeroCrossISR, RISING);  // RISING edge on zero-cross
  
  // Initialize hardware timer for phase-angle delay
  dimmerTimer = timerBegin(0, 80, true);  // Timer 0, prescaler 80 (1MHz = 1 microsecond per tick), count up
  timerAttachInterrupt(dimmerTimer, &triggerTRIAC, true);  // Attach ISR (edge = true for edge-triggered)
  timerAlarmWrite(dimmerTimer, 10000, false);  // Initial delay (will be updated dynamically)
  timerAlarmDisable(dimmerTimer);  // Disabled until needed
  
  dimLevel = 0;  // Start with 0% (off)
  
  Serial.println("Zero-cross dimmer initialized:");
  Serial.println("  Zero-cross pin: GPIO" + String(ZERO_CROSS_PIN));
  Serial.println("  Gate pin: GPIO" + String(DIMMER_PIN));
  Serial.println("  AC frequency: " + String(AC_FREQ) + "Hz");
  Serial.println("  Half-wave time: " + String(HALF_WAVE_TIME) + " microseconds");

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
  
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // Handle profile execution
  if (isRunning) {
    executeProfile();
  }

  // Check hardware buttons
  checkHardwareButtons();

  // Send status updates every second
  static unsigned long lastStatusUpdate = 0;
  if (deviceConnected && millis() - lastStatusUpdate > 1000) {
    sendStatusUpdate();
    lastStatusUpdate = millis();
  }

  delay(10);
}

void handleCommand(const char* command) {
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, command);
  
  if (error) {
    Serial.println("JSON parsing failed");
    return;
  }

  String cmd = doc["command"];
  
  if (cmd == "start_profile") {
    startProfile(doc["profile"]);
  } else if (cmd == "stop_profile") {
    stopProfile();
  } else if (cmd == "set_dim_level") {
    int level = doc["level"];
    setDimLevel(level);
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
  } else if (cmd == "store_profile") {
    uint8_t id = doc["id"];
    storeProfile(id, doc["profile"]);
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
  }
}

void startProfile(JsonObject profile) {
  if (isRunning) {
    stopProfile();
  }
  
  profileSegments = profile["segments"];
  totalSegments = profileSegments.size();
  currentSegment = 0;
  startTime = millis();
  isRunning = true;
  
  Serial.println("Profile started with " + String(totalSegments) + " segments");
  
  // Send confirmation
  DynamicJsonDocument response(256);
  response["status"] = "profile_started";
  response["segments"] = totalSegments;
  sendResponse(response);
}

void stopProfile() {
  isRunning = false;
  setDimLevel(0);
  
  Serial.println("Profile stopped");
  
  DynamicJsonDocument response(256);
  response["status"] = "profile_stopped";
  sendResponse(response);
}

void executeProfile() {
  if (currentSegment >= totalSegments) {
    stopProfile();
    return;
  }
  
  unsigned long currentTime = (millis() - startTime) / 1000; // Convert to seconds
  JsonObject segment = profileSegments[currentSegment];
  
  int startTime = segment["startTime"];
  int endTime = segment["endTime"];
  float startPressure = segment["startPressure"];
  float endPressure = segment["endPressure"];
  
  if (currentTime >= startTime && currentTime <= endTime) {
    // Calculate target pressure for current time
    float progress = (float)(currentTime - startTime) / (endTime - startTime);
    float targetPressure = startPressure + (endPressure - startPressure) * progress;
    
    // Convert pressure to dim level and set
    int dimLevel = pressureToDimLevel(targetPressure);
    setDimLevel(dimLevel);
    
    // Send pressure update
    DynamicJsonDocument update(256);
    update["type"] = "pressure_update";
    update["current_pressure"] = getCurrentPressure();
    update["target_pressure"] = targetPressure;
    update["current_time"] = currentTime;
    sendResponse(update);
  } else if (currentTime > endTime) {
    // Move to next segment
    currentSegment++;
  }
}

void setDimLevel(int level) {
  // Clamp level between 0 and 100
  level = constrain(level, 0, 100);
  
  // Set dim level (zero-cross ISR will handle phase-angle control)
  // dimLevel is volatile to ensure safe access from ISR
  noInterrupts();  // Disable interrupts briefly to safely update dimLevel
  dimLevel = level;
  interrupts();    // Re-enable interrupts
  
  String logMsg = "Dim level set to: " + String(level) + "% (zero-cross controlled)";
  Serial.println(logMsg);
  sendLogMessage(logMsg.c_str(), "info");
}

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
    Serial.println("Calibration data set successfully with " + String(validPoints) + " valid points");
    
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
  DynamicJsonDocument status(512);
  status["type"] = "status_update";
  status["current_pressure"] = getCurrentPressure();
  status["is_running"] = isRunning;
  status["current_segment"] = currentSegment;
  status["total_segments"] = totalSegments;
  status["uptime"] = millis() / 1000;
  status["is_calibrated"] = isCalibrated;
  
  sendResponse(status);
}

void checkHardwareButtons() {
  // Read button states
  bool button1State = digitalRead(BUTTON_1_PIN);
  bool button2State = digitalRead(BUTTON_2_PIN);
  
  unsigned long currentTime = millis();
  
  // Check button 1 (Profile 1)
  if (button1State != lastButton1State) {
    if (currentTime - lastButton1Time > DEBOUNCE_DELAY) {
      if (button1State == LOW) {
        Serial.println("[BUTTON] Button 1 pressed (GPIO18)");
        if (!isRunning && defaultProfile1 != 255) {
          // Button 1 pressed - start default profile 1
          Serial.println("Starting default profile 1 (ID: " + String(defaultProfile1) + ")");
          startDefaultProfile(1);
        } else if (defaultProfile1 == 255) {
          Serial.println("No default profile set for button 1 (set via BLE)");
        } else {
          Serial.println("Button ignored - profile already running");
        }
      } else {
        Serial.println("[BUTTON] Button 1 released (GPIO18)");
      }
      lastButton1Time = currentTime;
    }
    lastButton1State = button1State;
  }
  
  // Check button 2 (Profile 2)
  if (button2State != lastButton2State) {
    if (currentTime - lastButton2Time > DEBOUNCE_DELAY) {
      if (button2State == LOW) {
        Serial.println("[BUTTON] Button 2 pressed (GPIO19)");
        if (!isRunning && defaultProfile2 != 255) {
          // Button 2 pressed - start default profile 2
          Serial.println("Starting default profile 2 (ID: " + String(defaultProfile2) + ")");
          startDefaultProfile(2);
        } else if (defaultProfile2 == 255) {
          Serial.println("No default profile set for button 2 (set via BLE)");
        } else {
          Serial.println("Button ignored - profile already running");
        }
      } else {
        Serial.println("[BUTTON] Button 2 released (GPIO19)");
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
  
  // Copy name (truncate if too long)
  String name = profileData["name"];
  strncpy(profile.name, name.c_str(), 15);
  profile.name[15] = '\0';
  
  // Process segments
  JsonArray segments = profileData["segments"];
  profile.segmentCount = min(segments.size(), (size_t)10);
  profile.totalDuration = 0;
  
  for (int i = 0; i < profile.segmentCount; i++) {
    JsonObject segment = segments[i];
    
    // Convert to compact format
    profile.segments[i].startTime = segment["startTime"];
    profile.segments[i].endTime = segment["endTime"];
    profile.segments[i].startPressure = (uint8_t)(segment["startPressure"].as<float>() * 10); // Convert to 0-120
    profile.segments[i].endPressure = (uint8_t)(segment["endPressure"].as<float>() * 10);
    
    profile.totalDuration = max(profile.totalDuration, (uint8_t)segment["endTime"]);
  }
  
  // Calculate checksum
  profile.checksum = calculateChecksum(profile);
  
  // Update profile count
  if (id >= profileCount) {
    profileCount = id + 1;
  }
  
  Serial.println("Profile " + String(id) + " stored: " + String(profile.name));
  return true;
}

void setDefaultProfile(int button, uint8_t profileId) {
  if (profileId >= 10) {
    Serial.println("Invalid profile ID: " + String(profileId));
    return;
  }
  
  if (button == 1) {
    defaultProfile1 = profileId;
    Serial.println("Default profile 1 set to: " + String(profileId));
  } else if (button == 2) {
    defaultProfile2 = profileId;
    Serial.println("Default profile 2 set to: " + String(profileId));
  }
  
  // Send confirmation
  DynamicJsonDocument response(256);
  response["status"] = "default_profile_set";
  response["button"] = button;
  response["profileId"] = profileId;
  sendResponse(response);
}

void startDefaultProfile(int button) {
  uint8_t profileId = (button == 1) ? defaultProfile1 : defaultProfile2;
  
  if (profileId == 255) {
    Serial.println("No default profile set for button " + String(button));
    return;
  }
  
  if (profileId >= profileCount) {
    Serial.println("Invalid profile ID: " + String(profileId));
    return;
  }
  
  // Validate checksum
  CompactProfile& profile = storedProfiles[profileId];
  if (calculateChecksum(profile) != profile.checksum) {
    Serial.println("Profile checksum validation failed for ID: " + String(profileId));
    return;
  }
  
  // Start the stored profile
  Serial.println("Starting stored profile: " + String(profile.name));
  
  // Convert compact format back to execution format
  profileSegments.clear();
  totalSegments = profile.segmentCount;
  
  for (int i = 0; i < profile.segmentCount; i++) {
    JsonObject segment = profileSegments.createNestedObject();
    segment["startTime"] = profile.segments[i].startTime;
    segment["endTime"] = profile.segments[i].endTime;
    segment["startPressure"] = profile.segments[i].startPressure / 10.0;
    segment["endPressure"] = profile.segments[i].endPressure / 10.0;
  }
  
  // Start profile execution
  currentSegment = 0;
  startTime = millis();
  isRunning = true;
  
  // Send confirmation
  DynamicJsonDocument response(256);
  response["status"] = "profile_started";
  response["profile_id"] = profileId;
  response["profile_name"] = profile.name;
  response["segments"] = profile.segmentCount;
  sendResponse(response);
}

void sendResponse(DynamicJsonDocument& doc) {
  if (deviceConnected) {
    String jsonString;
    serializeJson(doc, jsonString);
    
    pCharacteristic->setValue(jsonString.c_str());
    pCharacteristic->notify();
    
    Serial.println("Sent: " + jsonString);
  }
}

// Send log message via BLE (for Serial Monitor in webapp)
void sendLogMessage(const char* message, const char* level) {
  if (deviceConnected) {
    DynamicJsonDocument logDoc(512);
    logDoc["type"] = "serial_log";
    logDoc["message"] = message;
    logDoc["level"] = level;  // "info", "warn", "error", "debug"
    logDoc["timestamp"] = millis();
    
    String jsonString;
    serializeJson(logDoc, jsonString);
    
    pCharacteristic->setValue(jsonString.c_str());
    pCharacteristic->notify();
  }
  // Always print to Serial as well
  Serial.println(message);
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
