#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>
#include "rbdimmerESP32.h"

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
// Using RBDimmer library for proper zero-cross detection and phase-angle control
#define PHASE_NUM 0  // Phase number (0 for single phase)
rbdimmer_channel_t* dimmer_channel = NULL;  // Dimmer channel object

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

void setup() {
  Serial.begin(115200);
  Serial.println("Starting Espresso Profiler ESP32...");

  // Initialize pins
  pinMode(LED_PIN, OUTPUT);
  // Button pins with internal pull-up (button connects to GND when pressed)
  pinMode(BUTTON_1_PIN, INPUT_PULLUP);  // GPIO18 - Button 1 (LOW = pressed, HIGH = not pressed)
  pinMode(BUTTON_2_PIN, INPUT_PULLUP);  // GPIO19 - Button 2 (LOW = pressed, HIGH = not pressed)
  digitalWrite(LED_PIN, LOW);

  // Initialize RBDimmer library for RobotDyn Mod-Dimmer-5A-1L
  Serial.println("Initializing RBDimmer library...");
  
  if (rbdimmer_init() != RBDIMMER_OK) {
    Serial.println("ERROR: Failed to initialize RBDimmer library");
    sendLogMessage("ERROR: Failed to initialize RBDimmer library", "error");
  } else {
    Serial.println("RBDimmer library initialized");
  }
  
  // Register zero-cross detector
  if (rbdimmer_register_zero_cross(ZERO_CROSS_PIN, PHASE_NUM, 0) != RBDIMMER_OK) {
    Serial.println("ERROR: Failed to register zero-cross detector on GPIO" + String(ZERO_CROSS_PIN));
    sendLogMessage("ERROR: Failed to register zero-cross detector", "error");
  } else {
    Serial.println("Zero-cross detector registered on GPIO" + String(ZERO_CROSS_PIN));
  }
  
  // Create dimmer channel configuration
  rbdimmer_config_t dimmer_config = {
    .gpio_pin = DIMMER_PIN,
    .phase = PHASE_NUM,
    .initial_level = 0,  // Start with 0% (off)
    .curve_type = RBDIMMER_CURVE_RMS  // RMS curve for smooth dimming (good for resistive loads)
  };
  
  if (rbdimmer_create_channel(&dimmer_config, &dimmer_channel) != RBDIMMER_OK) {
    Serial.println("ERROR: Failed to create dimmer channel on GPIO" + String(DIMMER_PIN));
    sendLogMessage("ERROR: Failed to create dimmer channel", "error");
  } else {
    Serial.println("Dimmer channel created on GPIO" + String(DIMMER_PIN));
    Serial.println("Zero-cross dimmer initialized successfully:");
    Serial.println("  Zero-cross pin: GPIO" + String(ZERO_CROSS_PIN));
    Serial.println("  Gate pin: GPIO" + String(DIMMER_PIN));
    Serial.println("  Phase: " + String(PHASE_NUM));
    Serial.println("  Curve type: RMS");
    sendLogMessage("Zero-cross dimmer initialized successfully", "info");
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

  // Support both "command" and "cmd" (optimized format)
  String cmd = doc["command"] | doc["cmd"] | "";
  
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
  
  String profileName = profile["name"] | "Unnamed";
  String logMsg = "Brew profile started: \"" + profileName + "\" (" + String(totalSegments) + " segments)";
  Serial.println(logMsg);
  sendLogMessage(logMsg.c_str(), "info");
  
  // Send confirmation
  DynamicJsonDocument response(256);
  response["status"] = "profile_started";
  response["segments"] = totalSegments;
  sendResponse(response);
}

void stopProfile() {
  isRunning = false;
  setDimLevel(0);
  
  unsigned long duration = (millis() - startTime) / 1000; // Duration in seconds
  String logMsg = "Brew profile finished (duration: " + String(duration) + "s)";
  Serial.println(logMsg);
  sendLogMessage(logMsg.c_str(), "info");
  
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
  
  unsigned long currentTime = (millis() - startTime) / 1000; // Convert to seconds
  
  // Safety check: ensure currentSegment is valid
  if (!profileSegments || currentSegment >= profileSegments.size()) {
    Serial.println("ERROR: Invalid segment index");
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
  if (currentSegment != lastLoggedSegment && currentTime >= segmentStartTime) {
    String msg = "Profile segment " + String(currentSegment + 1) + "/" + String(totalSegments) + 
                 ": " + String(segmentStartTime) + "s-" + String(segmentEndTime) + "s, " + 
                 String(startPressure, 1) + "→" + String(endPressure, 1) + " bar";
    Serial.println(msg);
    sendLogMessage(msg.c_str(), "info");
    lastLoggedSegment = currentSegment;
  }
  
  if (currentTime >= segmentStartTime && currentTime <= segmentEndTime) {
    // Calculate target pressure for current time
    int segmentDuration = segmentEndTime - segmentStartTime;
    if (segmentDuration <= 0) {
      // Safety check: avoid division by zero
      Serial.println("ERROR: Segment duration is zero or negative");
      stopProfile();
      return;
    }
    
    float progress = (float)(currentTime - segmentStartTime) / (float)segmentDuration;
    // Clamp progress between 0 and 1
    if (progress < 0.0f) progress = 0.0f;
    if (progress > 1.0f) progress = 1.0f;
    
    float targetPressure = startPressure + (endPressure - startPressure) * progress;
    
    // Safety check: ensure targetPressure is valid
    if (isnan(targetPressure) || isinf(targetPressure)) {
      Serial.println("ERROR: Invalid target pressure calculated");
      targetPressure = 0.0f;
    }
    
    // Convert pressure to dim level and set
    int dimLevel = pressureToDimLevel(targetPressure);
    
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
      String msg = "Brew: " + String(currentTime) + "s | Target: " + String(targetPressure, 1) + " bar | Dim: " + String(dimLevel) + "%";
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
  } else if (currentTime > segmentEndTime) {
    // Move to next segment
    currentSegment++;
    lastLoggedSegment = currentSegment - 1; // Reset so new segment gets logged
  }
}

void setDimLevel(int level) {
  // Clamp level between 0 and 100
  level = constrain(level, 0, 100);
  
  // Set dim level using RBDimmer library (handles zero-cross and phase-angle control automatically)
  if (dimmer_channel != NULL) {
    rbdimmer_err_t result = rbdimmer_set_level(dimmer_channel, level);
    if (result == RBDIMMER_OK) {
      String logMsg = "Dim level set to: " + String(level) + "% (RBDimmer controlled)";
      Serial.println(logMsg);
      sendLogMessage(logMsg.c_str(), "info");
    } else {
      String errorMsg = "ERROR: Failed to set dim level to " + String(level) + "%";
      Serial.println(errorMsg);
      sendLogMessage(errorMsg.c_str(), "error");
    }
  } else {
    String errorMsg = "ERROR: Dimmer channel not initialized!";
    Serial.println(errorMsg);
    sendLogMessage(errorMsg.c_str(), "error");
  }
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
  bool button1State = digitalRead(BUTTON_1_PIN);
  bool button2State = digitalRead(BUTTON_2_PIN);
  
  unsigned long currentTime = millis();
  
  // Check button 1 (Profile 1)
  if (button1State != lastButton1State) {
    if (currentTime - lastButton1Time > DEBOUNCE_DELAY) {
      if (button1State == LOW) {
        String msg = "[BUTTON] SW1 (Button 1) pressed (GPIO18)";
        Serial.println(msg);
        sendLogMessage(msg.c_str(), "info");
        
        if (!isRunning && defaultProfile1 != 255) {
          // Button 1 pressed - start default profile 1
          msg = "Starting default profile 1 (ID: " + String(defaultProfile1) + ")";
          Serial.println(msg);
          sendLogMessage(msg.c_str(), "info");
          startDefaultProfile(1);
        } else if (defaultProfile1 == 255) {
          msg = "SW1 (Button 1): No default profile set (set via BLE)";
          Serial.println(msg);
          sendLogMessage(msg.c_str(), "warn");
        } else {
          msg = "SW1 (Button 1): Ignored - profile already running";
          Serial.println(msg);
          sendLogMessage(msg.c_str(), "warn");
        }
      } else {
        String msg = "[BUTTON] SW1 (Button 1) released (GPIO18)";
        Serial.println(msg);
        sendLogMessage(msg.c_str(), "debug");
      }
      lastButton1Time = currentTime;
    }
    lastButton1State = button1State;
  }
  
  // Check button 2 (Profile 2)
  if (button2State != lastButton2State) {
    if (currentTime - lastButton2Time > DEBOUNCE_DELAY) {
      if (button2State == LOW) {
        String msg = "[BUTTON] SW2 (Button 2) pressed (GPIO19)";
        Serial.println(msg);
        sendLogMessage(msg.c_str(), "info");
        
        if (!isRunning && defaultProfile2 != 255) {
          // Button 2 pressed - start default profile 2
          msg = "Starting default profile 2 (ID: " + String(defaultProfile2) + ")";
          Serial.println(msg);
          sendLogMessage(msg.c_str(), "info");
          startDefaultProfile(2);
        } else if (defaultProfile2 == 255) {
          msg = "SW2 (Button 2): No default profile set (set via BLE)";
          Serial.println(msg);
          sendLogMessage(msg.c_str(), "warn");
        } else {
          msg = "SW2 (Button 2): Ignored - profile already running";
          Serial.println(msg);
          sendLogMessage(msg.c_str(), "warn");
        }
      } else {
        String msg = "[BUTTON] SW2 (Button 2) released (GPIO19)";
        Serial.println(msg);
        sendLogMessage(msg.c_str(), "debug");
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
