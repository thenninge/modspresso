#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>

// Pin definitions
#define DIMMER_PIN 25        // GPIO25 for AC dimmer control
#define LED_PIN 2           // Built-in LED for status
#define BUTTON_1_PIN 26     // GPIO26 for hardware button 1 (Profile 1)
#define BUTTON_2_PIN 27     // GPIO27 for hardware button 2 (Profile 2)
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

// PWM configuration for dimmer
const int pwmChannel = 0;
const int pwmFreq = 50;  // 50Hz for AC dimmer
const int pwmResolution = 8; // 8-bit resolution (0-255)

// Function declarations
void handleCommand(const char* command);
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
  pinMode(DIMMER_PIN, OUTPUT);
  pinMode(BUTTON_1_PIN, INPUT_PULLUP);  // Internal pull-up resistor
  pinMode(BUTTON_2_PIN, INPUT_PULLUP);  // Internal pull-up resistor
  digitalWrite(LED_PIN, LOW);
  digitalWrite(DIMMER_PIN, LOW);

  // Configure PWM for dimmer
  ledcSetup(pwmChannel, pwmFreq, pwmResolution);
  ledcAttachPin(DIMMER_PIN, pwmChannel);
  ledcWrite(pwmChannel, 0); // Start with 0% duty cycle

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
  
  // Convert percentage to PWM value (0-255)
  int pwmValue = map(level, 0, 100, 0, 255);
  ledcWrite(pwmChannel, pwmValue);
  
  Serial.println("Dim level set to: " + String(level) + "% (PWM: " + String(pwmValue) + ")");
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
      if (button1State == LOW && !isRunning && defaultProfile1 != 255) {
        // Button 1 pressed - start default profile 1
        Serial.println("Button 1 pressed - starting default profile 1");
        startDefaultProfile(1);
      }
      lastButton1Time = currentTime;
    }
    lastButton1State = button1State;
  }
  
  // Check button 2 (Profile 2)
  if (button2State != lastButton2State) {
    if (currentTime - lastButton2Time > DEBOUNCE_DELAY) {
      if (button2State == LOW && !isRunning && defaultProfile2 != 255) {
        // Button 2 pressed - start default profile 2
        Serial.println("Button 2 pressed - starting default profile 2");
        startDefaultProfile(2);
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
