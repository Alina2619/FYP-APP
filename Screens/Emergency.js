import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Alert,
  Modal,
  Image,
  ActivityIndicator,
  Linking,
  Platform,
  Animated
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Audio } from "expo-av";
import { Gyroscope, Accelerometer } from "expo-sensors";
import { db } from "../firebaseConfig";
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  doc, 
  getDoc, 
  updateDoc,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useTrip } from "../contexts/TripContext";
import { useFocusEffect } from "@react-navigation/native";
import { WebView } from 'react-native-webview';
import * as Speech from 'expo-speech';
import voiceCommandService from '../src/voice/VoiceCommandService';

const { width } = Dimensions.get("window");

// ✅ GLOBAL EMERGENCY STATE
export let globalEmergencyState = {
  isActive: false,
  emergencyType: null,
  countdown: 10,
  countdownInterval: null,
  subscribers: [],
  sensorData: {
    speed: 0,
    gForce: 1.0,
    soundLevel: 0,
    orientation: { x: 0, y: 0, z: 0 },
    coords: null,
    address: "Fetching location..."
  }
};

// Subscribe to global emergency events
export const subscribeToEmergency = (callback) => {
  globalEmergencyState.subscribers.push(callback);
  return () => {
    const index = globalEmergencyState.subscribers.indexOf(callback);
    if (index > -1) {
      globalEmergencyState.subscribers.splice(index, 1);
    }
  };
};

// Trigger emergency globally
export const triggerGlobalEmergency = (emergency) => {
  if (globalEmergencyState.isActive) return;
  
  globalEmergencyState.isActive = true;
  globalEmergencyState.emergencyType = emergency;
  globalEmergencyState.countdown = 10;
  
  globalEmergencyState.subscribers.forEach(callback => {
    callback({
      type: 'EMERGENCY_TRIGGERED',
      emergency: emergency,
      countdown: 10
    });
  });
  
  globalEmergencyState.countdownInterval = setInterval(() => {
    globalEmergencyState.countdown--;
    
    globalEmergencyState.subscribers.forEach(callback => {
      callback({
        type: 'COUNTDOWN_UPDATE',
        countdown: globalEmergencyState.countdown
      });
    });
    
    if (globalEmergencyState.countdown <= 0) {
      clearInterval(globalEmergencyState.countdownInterval);
      
      globalEmergencyState.subscribers.forEach(callback => {
        callback({
          type: 'EMERGENCY_EXPIRED',
          emergency: globalEmergencyState.emergencyType
        });
      });
      
      globalEmergencyState.isActive = false;
    }
  }, 1000);
};

// Cancel emergency globally
export const cancelGlobalEmergency = () => {
  if (globalEmergencyState.countdownInterval) {
    clearInterval(globalEmergencyState.countdownInterval);
  }
  
  globalEmergencyState.isActive = false;
  globalEmergencyState.emergencyType = null;
  globalEmergencyState.countdown = 10;
  
  globalEmergencyState.subscribers.forEach(callback => {
    callback({
      type: 'EMERGENCY_CANCELLED'
    });
  });
};

// Update sensor data globally
export const updateGlobalSensorData = (data) => {
  globalEmergencyState.sensorData = { ...globalEmergencyState.sensorData, ...data };
};

// Enhanced Emergency Detection
const detectEmergencyType = ({ gForce, speed, soundLevel, orientation, speedHistory }) => {
  const emergencies = [];
  
  // 1. Sudden Impact Detection
  if (gForce > 5.0) {
    emergencies.push({
      type: "SUDDEN_IMPACT",
      severity: "HIGH",
      message: "Sudden impact detected - possible collision",
      score: gForce * 20
    });
  }
  
  // 2. Hard Braking Detection
  if (speedHistory.length >= 3) {
    const recentSpeeds = speedHistory.slice(-3);
    const speedDrop = recentSpeeds[0] - recentSpeeds[2];
    if (speedDrop > 30 && recentSpeeds[0] > 20) {
      emergencies.push({
        type: "HARD_BRAKING",
        severity: "MEDIUM",
        message: "Hard braking detected",
        score: speedDrop * 2
      });
    }
  }
  
  // 3. Vehicle Rollover Detection
  if (Math.abs(orientation.x) > 0.8 || Math.abs(orientation.y) > 0.8) {
    emergencies.push({
      type: "VEHICLE_ROLLOVER",
      severity: "CRITICAL",
      message: "Possible vehicle rollover detected",
      score: 100
    });
  }
  
  // 4. Loud Crash Detection
  if (soundLevel > 90) {
    emergencies.push({
      type: "LOUD_CRASH",
      severity: "HIGH",
      message: "Loud crash sound detected",
      score: soundLevel
    });
  }
  
  // 5. Sudden Rotation/Spin Detection
  if (Math.abs(orientation.z) > 0.7 && speed > 20) {
    emergencies.push({
      type: "SUDDEN_ROTATION",
      severity: "HIGH",
      message: "Sudden vehicle rotation detected",
      score: Math.abs(orientation.z) * 100
    });
  }
  
  // 6. Excessive Speed + Impact
  if (speed > 80 && gForce > 3.5) {
    emergencies.push({
      type: "HIGH_SPEED_ACCIDENT",
      severity: "CRITICAL",
      message: "High-speed impact detected",
      score: (speed * gForce) / 10
    });
  }
  
  if (emergencies.length === 0) return null;
  
  const severityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  emergencies.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
  
  return emergencies[0];
};

// Normalize sound level
const normalizeDB = (metering) => {
  const minDb = -60, maxDb = 0;
  return Math.max(0, Math.min(120, Math.round(((metering - minDb) / (maxDb - minDb)) * 120)));
};

// Helper function to map emergency types to alert types
const mapEmergencyToAlertType = (emergencyType) => {
  switch (emergencyType) {
    case 'SUDDEN_IMPACT':
    case 'VEHICLE_ROLLOVER':
    case 'LOUD_CRASH':
    case 'HIGH_SPEED_ACCIDENT':
    case 'SUDDEN_ROTATION':
      return 'impact';
    case 'HARD_BRAKING':
      return 'speed';
    case 'MANUAL_TRIGGER':
    case 'VOICE_COMMAND':
      return 'emergency';
    default:
      return 'emergency';
  }
};

export default function DriveMateDashboard({ navigation, route }) {
  // Sensor states
  const [speed, setSpeed] = useState(0);
  const [speedHistory, setSpeedHistory] = useState([]);
  const [orientation, setOrientation] = useState({ x: 0, y: 0, z: 0 });
  const [soundLevel, setSoundLevel] = useState(0);
  const [coords, setCoords] = useState(null);
  const [address, setAddress] = useState("Fetching location...");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [timeAgo, setTimeAgo] = useState("Just now");
  const [lastGForce, setLastGForce] = useState(1.0);
  const [localImpact, setLocalImpact] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);

  // Sensor availability states
  const [gpsAvailable, setGpsAvailable] = useState(false);
  const [gyroAvailable, setGyroAvailable] = useState(false);
  const [accelAvailable, setAccelAvailable] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState("Unknown");
  
  // Map state
  const [mapReady, setMapReady] = useState(false);
  const webViewRef = useRef(null);
  
  // Emergency states
  const [emergencyDetected, setEmergencyDetected] = useState(false);
  const [currentEmergencyType, setCurrentEmergencyType] = useState(null);
  const [emergencyAlertVisible, setEmergencyAlertVisible] = useState(false);
  const [emergencyCountdown, setEmergencyCountdown] = useState(10);
  
  // Success state after emergency is stored
  const [emergencyStored, setEmergencyStored] = useState(false);
  const [emergencyStoredMessage, setEmergencyStoredMessage] = useState("");
  
  // User data
  const [userData, setUserData] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Trip context
  const { isLogging, tripData, impactDetected, distance = 0, avgSpeed = 0 } = useTrip();
  
  // VOICE COMMAND STATES
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [voiceConfidence, setVoiceConfidence] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isVoiceModelLoaded, setIsVoiceModelLoaded] = useState(false);
  const [voiceServiceStatus, setVoiceServiceStatus] = useState('initializing');
  const [voiceCommandHistory, setVoiceCommandHistory] = useState([]);
  
  // Refs for cleanup and data smoothing
  const isMounted = useRef(true);
  const locationSubRef = useRef(null);
  const recordingRef = useRef(null);
  const gyroSubscriptionRef = useRef(null);
  const accelSubscriptionRef = useRef(null);
  
  // VOICE COMMAND REFS
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimerRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const isHoldingMicRef = useRef(false);
  const pulseAnimationRef = useRef(null);
  const micButtonRef = useRef(null);
  
  // Data smoothing buffers
  const gForceBuffer = useRef([]);
  const locationBuffer = useRef([]);
  
  // Emergency detection buffer
  const emergencyBuffer = useRef([]);
  const emergencyConfirmationsNeeded = 2;

  // Generate map HTML
  const getMapHTML = useCallback(() => {
    if (!coords) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              margin: 0; 
              padding: 0;
              font-family: Arial, sans-serif;
              background-color: #f5f5f5;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
            }
            .no-location {
              text-align: center;
              color: #666;
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <div class="no-location">
            <h3>📍 Location Not Available</h3>
            <p>Waiting for GPS signal...</p>
          </div>
        </body>
        </html>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { width: 100vw; height: 100vh; background: #f0f0f0; }
          .custom-marker {
            background: #1d807c;
            border: 3px solid white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
          }
          .custom-marker::after {
            content: '📍';
            position: absolute;
            top: -20px;
            left: -5px;
            font-size: 16px;
          }
          .accuracy-circle {
            stroke: rgba(29, 128, 124, 0.2);
            stroke-width: 2;
            fill: rgba(29, 128, 124, 0.1);
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          try {
            // Initialize map
            var map = L.map('map', {
              center: [${coords.latitude}, ${coords.longitude}],
              zoom: 16,
              zoomControl: true,
              attributionControl: true
            });
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap contributors',
              maxZoom: 19
            }).addTo(map);

            // Add zoom control to bottom right
            L.control.zoom({
              position: 'bottomright'
            }).addTo(map);

            // Add custom marker for current location
            var customIcon = L.divIcon({
              className: 'custom-marker',
              iconSize: [20, 20],
              popupAnchor: [0, -10]
            });

            var marker = L.marker([${coords.latitude}, ${coords.longitude}], {
              icon: customIcon,
              zIndexOffset: 1000
            }).addTo(map);
            
            marker.bindPopup('<b>Your Location</b><br>${address.replace(/'/g, "\\'")}').openPopup();

            // Add accuracy circle if available
            ${coords.accuracy ? `
              var circle = L.circle([${coords.latitude}, ${coords.longitude}], {
                radius: ${coords.accuracy},
                color: '#1d807c',
                weight: 1,
                fillColor: 'rgba(29, 128, 124, 0.1)',
                fillOpacity: 0.2
              }).addTo(map);
            ` : ''}

            // Send ready message
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MAP_READY',
              center: [${coords.latitude}, ${coords.longitude}]
            }));

          } catch (error) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MAP_ERROR',
              error: error.toString()
            }));
          }
        </script>
      </body>
      </html>
    `;
  }, [coords, address]);

  // Handle WebView messages
  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'MAP_READY') {
        setMapReady(true);
      } else if (data.type === 'MAP_ERROR') {
        console.error('Map error:', data.error);
      }
    } catch (error) {
      console.error('Error parsing WebView message:', error);
    }
  };

  // ✅ Function to log alerts for family members
  const logAlertForFamily = useCallback(async (emergency, emergencyId) => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) return;

      // Get driver's linked families
      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const linkedFamilies = userData.linkedFamilies || [];
        
        // Create alert for each linked family
        const alertPromises = linkedFamilies.map(async (family) => {
          const alertData = {
            driverId: user.uid,
            driverName: userData.fullName || userData.name || userData.email?.split('@')[0] || 'Driver',
            type: mapEmergencyToAlertType(emergency.type),
            message: emergency.message || 'Emergency detected',
            severity: emergency.severity || 'HIGH',
            emergencyId: emergencyId,
            location: coords,
            address: address,
            speed: speed,
            gForce: lastGForce.toFixed(2),
            soundLevel: soundLevel,
            userResponse: "no_response",
            timestamp: serverTimestamp(),
            read: false,
            driverProfileImage: userData.profileImage || null
          };

          return addDoc(collection(db, "alerts"), alertData);
        });

        await Promise.all(alertPromises);
        console.log('Alerts created for linked families');
      }
    } catch (error) {
      console.error('Error creating alerts for families:', error);
    }
  }, [coords, address, speed, lastGForce, soundLevel]);

  // ✅ Function to log emergency to emergency_logs
  const logEmergencyToLogs = useCallback(async (emergency, emergencyId, userResponse = "no_response") => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) return;

      await addDoc(collection(db, "emergency_logs"), {
        userId: user.uid,
        driverName: userData?.fullName || userData?.name || userData?.email?.split('@')[0] || 'Driver',
        type: emergency.type,
        severity: emergency.severity,
        message: emergency.message,
        gForce: lastGForce.toFixed(2),
        speed: speed,
        soundLevel: soundLevel,
        orientation: orientation,
        coords: coords,
        address: address,
        userResponse: userResponse,
        emergencyId: emergencyId,
        timestamp: serverTimestamp(),
        triggeredBy: emergency.triggeredBy || 'auto_detection'
      });
      
      console.log('Emergency logged to emergency_logs');
    } catch (error) {
      console.error('Error logging to emergency_logs:', error);
    }
  }, [userData, lastGForce, speed, soundLevel, orientation, coords, address]);

  // ✅ Listen to global emergency events
  useEffect(() => {
    const unsubscribe = subscribeToEmergency((event) => {
      if (!isMounted.current) return;
      
      switch (event.type) {
        case 'EMERGENCY_TRIGGERED':
          setEmergencyDetected(true);
          setCurrentEmergencyType(event.emergency);
          setEmergencyCountdown(event.countdown);
          setEmergencyAlertVisible(true);
          
          if (isVoiceEnabled) {
            speakFeedback(`Emergency detected: ${event.emergency.message}. You have 10 seconds to cancel.`);
          }
          break;
          
        case 'COUNTDOWN_UPDATE':
          setEmergencyCountdown(event.countdown);
          break;
          
        case 'EMERGENCY_EXPIRED':
          handleEmergencyAutoTrigger(event.emergency);
          break;
          
        case 'EMERGENCY_CANCELLED':
          setEmergencyAlertVisible(false);
          setEmergencyDetected(false);
          setCurrentEmergencyType(null);
          break;
      }
    });
    
    return unsubscribe;
  }, [isVoiceEnabled]);

  // Initialize voice command service
  const initializeVoiceCommandService = useCallback(async () => {
    try {
      console.log('Initializing voice command service...');
      setVoiceServiceStatus('initializing');
      
      const initialized = await voiceCommandService.initialize();
      setIsVoiceModelLoaded(initialized);
      
      const connectionTest = await voiceCommandService.testConnection();
      setVoiceServiceStatus(connectionTest.success ? 'ready' : 'failed');
      
      return initialized;
    } catch (error) {
      console.error('Voice command service initialization failed:', error);
      setVoiceServiceStatus('failed');
      setIsVoiceModelLoaded(false);
      return false;
    }
  }, []);

  // Voice feedback function
  const speakFeedback = useCallback((message) => {
    if (!isVoiceEnabled) return;
    
    Speech.speak(message, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.9,
    });
  }, [isVoiceEnabled]);

  // Quick voice alert function
  const speakQuickAlert = useCallback((message) => {
    if (!isVoiceEnabled) return;
    
    Speech.stop();
    
    Speech.speak(message, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.9,
    });
  }, [isVoiceEnabled]);

  // Check for emergency trigger from voice command
  useEffect(() => {
    if (route.params?.triggerEmergency) {
      triggerManualEmergency('VOICE_COMMAND');
    }
  }, [route.params]);

  // Start pulse animation
  const startPulseAnimation = useCallback(() => {
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
    }
    
    pulseAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(voicePulseAnim, {
          toValue: 1.2,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(voicePulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    
    pulseAnimationRef.current.start();
  }, [voicePulseAnim]);

  // Stop pulse animation
  const stopPulseAnimation = useCallback(() => {
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    voicePulseAnim.setValue(1);
  }, [voicePulseAnim]);

  // Cleanup timers
  const cleanupTimers = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }, []);

  // Handle voice command execution
  const executeVoiceCommand = useCallback(async (command, confidence, transcription = '', source = 'assemblyai') => {
    if (!command) return false;
    
    const commandLower = command.toLowerCase();
    let response = '';
    let action = null;
    let success = false;
    
    switch (commandLower) {
      case 'emergency':
      case 'call emergency':
      case 'help':
      case '911':
      case 'emergency now':
      case 'trigger emergency':
        response = 'Emergency triggered. Stand by for assistance.';
        action = () => {
          triggerManualEmergency('VOICE_COMMAND');
        };
        success = true;
        break;
        
      case 'cancel emergency':
      case 'i\'m safe':
      case 'safe':
      case 'cancel':
        if (!emergencyDetected && !globalEmergencyState.isActive) {
          response = 'No emergency is currently active.';
          success = false;
        } else {
          response = 'Emergency cancelled. We\'re glad you\'re safe!';
          action = () => {
            handleUserSafe();
          };
          success = true;
        }
        break;
        
      case 'go to dashboard':
      case 'open dashboard':
      case 'dashboard':
        response = 'Navigating to Dashboard.';
        action = () => {
          if (navigation) {
            setTimeout(() => {
              navigation.navigate('DriverDashboard');
            }, 800);
          }
        };
        success = true;
        break;
        
      case 'go to trip logger':
      case 'open trip logger':
      case 'trip logger':
        response = 'Navigating to Trip Logger.';
        action = () => {
          if (navigation) {
            setTimeout(() => {
              navigation.navigate('TripLogger');
            }, 800);
          }
        };
        success = true;
        break;
        
      case 'go to settings':
      case 'open settings':
      case 'settings':
        response = 'Navigating to Settings.';
        action = () => {
          if (navigation) {
            setTimeout(() => {
              navigation.navigate('DriverSettings');
            }, 800);
          }
        };
        success = true;
        break;
        
      case 'refresh location':
      case 'update location':
      case 'get location':
        response = 'Refreshing your location.';
        action = () => {
          refreshLocation();
        };
        success = true;
        break;
        
      case 'simulate emergency':
      case 'test emergency':
      case 'test accident':
        response = 'Simulating emergency for testing.';
        action = () => {
          simulateAccident();
        };
        success = true;
        break;
        
      default:
        response = `Command "${command}" not recognized. Try: emergency, cancel emergency, or dashboard.`;
        success = false;
    }
    
    // Add to voice command history
    const historyItem = {
      command,
      transcription: transcription || command,
      response,
      confidence,
      timestamp: new Date().toLocaleTimeString(),
      success,
      source
    };
    
    setVoiceCommandHistory(prev => [historyItem, ...prev.slice(0, 4)]);
    
    // Speak response
    if (isVoiceEnabled && success) {
      speakQuickAlert(response);
    }
    
    // Execute action if defined
    if (action && success) {
      setTimeout(() => {
        try {
          action();
        } catch (error) {
          console.error('Action execution error:', error);
          if (isVoiceEnabled) {
            speakQuickAlert('Action could not be completed.');
          }
        }
      }, 800);
    } else if (!success && isVoiceEnabled) {
      speakQuickAlert(response);
    }
    
    return { success, response };
  }, [navigation, isVoiceEnabled, speakQuickAlert, emergencyDetected]);

  // Process voice command
  const processVoiceCommand = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    
    try {
      cleanupTimers();
      
      setIsVoiceListening(false);
      setIsProcessingVoice(true);
      setVoiceTranscription('Processing...');
      
      const result = await voiceCommandService.stopRecordingAndTranscribe();
      
      if (result.transcription) {
        setVoiceTranscription(result.transcription);
      }
      
      if (result.confidence) {
        setVoiceConfidence(result.confidence);
      }
      
      if (result.success && result.command) {
        const execResult = await executeVoiceCommand(
          result.command,
          result.confidence || 0,
          result.transcription || '',
          result.source || 'unknown'
        );
        
        if (execResult.success) {
          setVoiceTranscription(prev => prev + ' → ' + execResult.response);
        }
      } else if (result.error) {
        setVoiceTranscription('Error: ' + result.error);
      }
      
      setTimeout(() => {
        setShowVoiceModal(false);
        setIsProcessingVoice(false);
        stopPulseAnimation();
        setRecordingTime(0);
        isProcessingRef.current = false;
      }, 2000);
      
    } catch (error) {
      console.error('Error processing voice command:', error);
      setVoiceTranscription('Error: ' + error.message);
      
      setTimeout(() => {
        setShowVoiceModal(false);
        setIsProcessingVoice(false);
        stopPulseAnimation();
        setRecordingTime(0);
        isProcessingRef.current = false;
      }, 2000);
    }
  }, [executeVoiceCommand, stopPulseAnimation, cleanupTimers]);

  // Start voice recording
  const startVoiceRecording = useCallback(async () => {
    if (isVoiceListening || isProcessingVoice || !isVoiceModelLoaded || isProcessingRef.current || isHoldingMicRef.current) {
      return;
    }
    
    isHoldingMicRef.current = true;
    
    try {
      setIsVoiceListening(true);
      setShowVoiceModal(true);
      setRecordingTime(0);
      setVoiceTranscription('');
      setVoiceConfidence(0);
      startPulseAnimation();
      
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 10) {
            stopVoiceRecording();
            return 10;
          }
          return prev + 1;
        });
      }, 1000);
      
      const startResult = await voiceCommandService.startRecording();
      
      if (!startResult.success) {
        throw new Error(startResult.error || 'Failed to start recording');
      }
      
      recordingTimeoutRef.current = setTimeout(() => {
        stopVoiceRecording();
      }, 8000);
      
    } catch (error) {
      console.error('Error starting voice recording:', error);
      
      cleanupTimers();
      stopPulseAnimation();
      voiceCommandService.stopRecording();
      
      setShowVoiceModal(false);
      setIsVoiceListening(false);
      setRecordingTime(0);
      isHoldingMicRef.current = false;
      
      Alert.alert(
        'Voice Recording Error', 
        error.message || 'Failed to start voice recording.',
        [{ text: 'OK' }]
      );
    }
  }, [
    isVoiceListening, 
    isProcessingVoice, 
    isVoiceModelLoaded, 
    startPulseAnimation,
    cleanupTimers,
    stopPulseAnimation
  ]);

  // Stop voice recording manually
  const stopVoiceRecording = useCallback(async () => {
    if (!isVoiceListening || !isHoldingMicRef.current) return;
    
    isHoldingMicRef.current = false;
    await processVoiceCommand();
  }, [isVoiceListening, processVoiceCommand]);

  // Cancel voice recording
  const cancelVoiceRecording = useCallback(() => {
    cleanupTimers();
    stopPulseAnimation();
    voiceCommandService.stopRecording();
    
    setShowVoiceModal(false);
    setIsVoiceListening(false);
    setIsProcessingVoice(false);
    setRecordingTime(0);
    setVoiceTranscription('');
    setVoiceConfidence(0);
    isProcessingRef.current = false;
    isHoldingMicRef.current = false;
  }, [cleanupTimers, stopPulseAnimation]);

  // Handle mic button press in and out
  const handleMicPressIn = useCallback(() => {
    if (!isVoiceListening && !isProcessingVoice && isVoiceModelLoaded) {
      startVoiceRecording();
    }
  }, [isVoiceListening, isProcessingVoice, isVoiceModelLoaded, startVoiceRecording]);

  const handleMicPressOut = useCallback(() => {
    if (isVoiceListening && isHoldingMicRef.current) {
      stopVoiceRecording();
    }
  }, [isVoiceListening, stopVoiceRecording]);

  // Enhanced Emergency detection logic
  const checkForEmergency = useCallback(() => {
    if (!isMounted.current || emergencyAlertVisible || emergencyStored || globalEmergencyState.isActive) return;
    
    const emergency = detectEmergencyType({
      gForce: lastGForce,
      speed,
      soundLevel,
      orientation,
      speedHistory
    });
    
    if (emergency) {
      emergencyBuffer.current.push({
        type: emergency.type,
        timestamp: Date.now()
      });
      
      const now = Date.now();
      emergencyBuffer.current = emergencyBuffer.current.filter(
        entry => now - entry.timestamp < 3000
      );
      
      const sameTypeCount = emergencyBuffer.current.filter(
        entry => entry.type === emergency.type
      ).length;
      
      if (sameTypeCount >= emergencyConfirmationsNeeded) {
        emergencyBuffer.current = [];
        
        updateGlobalSensorData({
          speed,
          gForce: lastGForce,
          soundLevel,
          orientation,
          coords,
          address
        });
        
        triggerGlobalEmergency(emergency);
      }
    }
  }, [lastGForce, speed, soundLevel, orientation, speedHistory, emergencyAlertVisible, emergencyStored, coords, address]);

  // ✅ Log emergency to database
  const logEmergencyToDatabase = useCallback(async (triggerSource = 'manual', emergency = null) => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) return null;
      
      const emergencyData = {
        userId: user.uid,
        driverName: userData?.fullName || userData?.name || userData?.email?.split('@')[0] || 'Driver',
        triggerSource,
        emergencyType: emergency?.type || 'MANUAL_TRIGGER',
        severity: emergency?.severity || 'HIGH',
        message: emergency?.message || 'Manual emergency triggered',
        location: coords,
        address,
        speed: speed,
        gForce: lastGForce.toFixed(2),
        soundLevel,
        orientation,
        status: 'stored',
        timestamp: serverTimestamp(),
        userResponse: 'no_response'
      };
      
      const docRef = await addDoc(collection(db, "emergencies"), emergencyData);
      
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        emergencyStatus: 'stored',
        lastEmergencyTime: serverTimestamp(),
        currentEmergencyId: docRef.id,
        updatedAt: serverTimestamp()
      });
      
      console.log('Emergency logged to database:', docRef.id);
      return docRef.id;
      
    } catch (error) {
      console.error('Error logging emergency to database:', error);
      throw error;
    }
  }, [userData, coords, address, speed, lastGForce, soundLevel, orientation]);

  // Handle emergency auto-trigger
  const handleEmergencyAutoTrigger = useCallback(async (emergency) => {
    setEmergencyAlertVisible(false);
    
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) {
        console.error("No authenticated user found");
        showEmergencyStoredConfirmation(emergency);
        return;
      }
      
      // 1. Log emergency to emergencies collection
      const emergencyId = await logEmergencyToDatabase('auto_detection', emergency);
      
      // 2. Log alert for family members
      await logAlertForFamily(emergency, emergencyId);
      
      // 3. Log to emergency_logs
      await logEmergencyToLogs(emergency, emergencyId);
      
      // 4. Update trip data if available
      if (tripData?.tripId) {
        await updateDoc(doc(db, "trips", tripData.tripId), {
          emergencyDetected: true,
          emergencyType: emergency.type,
          emergencySeverity: emergency.severity,
          lastGForce: lastGForce.toFixed(2),
          soundLevel,
          coords,
          address,
          emergencyId,
          updatedAt: serverTimestamp(),
        });
      }
      
      showEmergencyStoredConfirmation(emergency);
      
    } catch (err) {
      console.error("❌ Error saving emergency:", err);
      showEmergencyStoredConfirmation(emergency);
    }
  }, [logEmergencyToDatabase, logAlertForFamily, logEmergencyToLogs, tripData, lastGForce, soundLevel, coords, address]);

  // Show emergency stored confirmation
  const showEmergencyStoredConfirmation = useCallback((emergency) => {
    setEmergencyStored(true);
    setEmergencyStoredMessage(`Emergency logged: ${emergency.message}`);
    
    setTimeout(() => {
      if (isMounted.current) {
        setEmergencyStored(false);
        setEmergencyStoredMessage("");
        setEmergencyDetected(false);
      }
    }, 10000);
  }, []);

  // ✅ Handle user confirming they're safe
  const handleUserSafe = useCallback(async () => {
    cancelGlobalEmergency();
    
    setEmergencyAlertVisible(false);
    setEmergencyDetected(false);
    setLocalImpact(false);
    
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) return;
      
      // 1. Update user's emergency status
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        emergencyStatus: 'cancelled',
        updatedAt: serverTimestamp()
      });
      
      // 2. Update any pending alerts for this driver
      const alertsRef = collection(db, "alerts");
      const alertsQuery = query(
        alertsRef,
        where("driverId", "==", user.uid),
        where("read", "==", false),
        where("userResponse", "==", "no_response")
      );

      const alertsSnapshot = await getDocs(alertsQuery);
      const updatePromises = [];
      alertsSnapshot.forEach((docSnap) => {
        updatePromises.push(updateDoc(doc(db, "alerts", docSnap.id), {
          userResponse: "safe",
          resolvedAt: serverTimestamp(),
          read: true
        }));
      });

      await Promise.all(updatePromises);
      
      // 3. Log safe response to emergency_logs
      await logEmergencyToLogs(
        { 
          type: 'CANCELLED', 
          severity: 'LOW', 
          message: 'User cancelled emergency' 
        }, 
        'cancelled_' + Date.now(),
        "safe"
      );
      
      // 4. Update trip data
      if (tripData?.tripId) {
        await updateDoc(doc(db, "trips", tripData.tripId), {
          emergencyCancelled: true,
          userResponse: "safe",
          responseTime: new Date(),
          updatedAt: serverTimestamp(),
        });
      }
      
      if (isVoiceEnabled) {
        speakFeedback("Emergency cancelled. We're glad you're safe!");
      }
      
      setEmergencyStored(true);
      setEmergencyStoredMessage("Emergency cancelled. We're glad you're safe!");
      
      setTimeout(() => {
        if (isMounted.current) {
          setEmergencyStored(false);
          setEmergencyStoredMessage("");
        }
      }, 5000);
      
    } catch (err) {
      console.error("❌ Error saving safe response:", err);
      Alert.alert("Error", "Failed to save response. Please try again.");
    }
  }, [isVoiceEnabled, speakFeedback, tripData, logEmergencyToLogs]);

  // ✅ Manual Emergency Button
  const triggerManualEmergency = useCallback(async (source = 'manual') => {
    try {
      const emergencyData = {
        type: 'MANUAL_TRIGGER',
        severity: 'HIGH',
        message: source === 'VOICE_COMMAND' ? 'Voice command emergency triggered' : 'Manual emergency triggered by user',
        triggeredBy: source
      };
      
      updateGlobalSensorData({
        speed,
        gForce: lastGForce,
        soundLevel,
        orientation,
        coords,
        address
      });
      
      triggerGlobalEmergency(emergencyData);
      
      // Also log immediately for manual triggers
      const emergencyId = await logEmergencyToDatabase(source.toLowerCase(), emergencyData);
      await logAlertForFamily(emergencyData, emergencyId);
      await logEmergencyToLogs(emergencyData, emergencyId);
      
    } catch (error) {
      console.error('Error triggering manual emergency:', error);
      Alert.alert('Error', 'Failed to trigger emergency. Please try again.');
    }
  }, [speed, lastGForce, soundLevel, orientation, coords, address, logEmergencyToDatabase, logAlertForFamily, logEmergencyToLogs]);

  // 👤 Fetch user info
  useEffect(() => {
    isMounted.current = true;
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (isMounted.current) setLoadingUser(false);
        return;
      }
      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists() && isMounted.current) {
          const data = userSnap.data();
          setUserData({ uid: user.uid, ...data });
          setIsVoiceEnabled(data.driveModeSettings?.voiceEnabled ?? true);
        } else if (isMounted.current) {
          setUserData({ uid: user.uid, email: user.email });
        }
      } catch (e) {
        console.error("❌ Error fetching user data:", e);
      } finally {
        if (isMounted.current) setLoadingUser(false);
      }
    });
    return () => {
      isMounted.current = false;
      unsub();
    };
  }, []);

  // Initialize voice assistant
  useEffect(() => {
    const initializeVoiceAssistant = async () => {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        if (status === 'granted') {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            shouldDuckAndroid: true,
            staysActiveInBackground: false,
            playThroughEarpieceAndroid: false,
          });
        }
      } catch (error) {
        console.log('Voice initialization:', error.message);
      }
    };

    initializeVoiceAssistant();
    initializeVoiceCommandService();
  }, [initializeVoiceCommandService]);

  // Cleanup effect
  useEffect(() => {
    return () => {
      isMounted.current = false;
      
      if (locationSubRef.current) locationSubRef.current.remove();
      if (gyroSubscriptionRef.current) gyroSubscriptionRef.current.remove();
      if (accelSubscriptionRef.current) accelSubscriptionRef.current.remove();
      
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(e => console.error('Error stopping recording:', e));
        recordingRef.current = null;
      }

      voiceCommandService.cleanup();
      
      cleanupTimers();
      stopPulseAnimation();
    };
  }, [cleanupTimers, stopPulseAnimation]);

  // ✅ Enhanced mic recording
  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        console.warn("Mic permission denied");
        setMicPermissionDenied(true);
        setMicAvailable(false);
        return;
      }

      setMicPermissionDenied(false);
      setMicAvailable(true);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch (e) {}
        recordingRef.current = null;
      }

      const newRec = new Audio.Recording();
      await newRec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        android: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
          isMeteringEnabled: true,
        },
        ios: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
          isMeteringEnabled: true,
        },
      });

      newRec.setProgressUpdateInterval(300);

      newRec.setOnRecordingStatusUpdate((status) => {
        if (status && typeof status.metering === "number" && isMounted.current) {
          const db = normalizeDB(status.metering);
          if (db >= 0 && db <= 120) {
            setSoundLevel(db);
          }
        }
      });

      await newRec.startAsync();
      recordingRef.current = newRec;
      setIsRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
      if (isMounted.current) setMicAvailable(false);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch (e) {}
        recordingRef.current = null;
      }
      if (isMounted.current) setIsRecording(false);
    } catch (err) {
      console.error("Stop error:", err);
    }
  }, []);

  // Audio recording management
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      
      const initializeRecording = async () => {
        if (!cancelled) {
          await startRecording();
        }
      };

      initializeRecording();

      return () => {
        cancelled = true;
        stopRecording();
      };
    }, [startRecording, stopRecording])
  );

  // ✅ Enhanced Location tracking
  const startLocationTracking = useCallback(async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (isMounted.current) setGpsAvailable(false);
        return;
      }
      
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        if (isMounted.current) setGpsAvailable(false);
        Alert.alert("Location Services Disabled", "Please enable location services for accurate tracking");
        return;
      }

      if (isMounted.current) setGpsAvailable(true);
      
      const initialLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        timeout: 10000,
      });
      
      if (isMounted.current && initialLocation.coords) {
        updateLocationData(initialLocation.coords);
      }

      const sub = await Location.watchPositionAsync(
        { 
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 1,
        },
        (location) => {
          if (isMounted.current && location.coords) {
            updateLocationData(location.coords);
          }
        }
      );
      
      locationSubRef.current = sub;
      
    } catch (error) {
      console.error("Error setting up location tracking:", error);
      if (isMounted.current) setGpsAvailable(false);
    }
  }, []);

  // Update location data with accurate speed
  const updateLocationData = useCallback(async (coords) => {
    if (!isMounted.current) return;
    
    locationBuffer.current.push(coords);
    if (locationBuffer.current.length > 5) {
      locationBuffer.current.shift();
    }
    
    const latestCoord = locationBuffer.current[locationBuffer.current.length - 1];
    
    setCoords({
      latitude: latestCoord.latitude,
      longitude: latestCoord.longitude,
      accuracy: latestCoord.accuracy
    });
    
    let processedSpeed = 0;
    if (latestCoord.speed !== null && latestCoord.speed >= 0) {
      processedSpeed = Math.max(0, (latestCoord.speed * 3.6));
      
      if (processedSpeed > 200) {
        processedSpeed = speed;
      }
    }
    
    setSpeed(parseFloat(processedSpeed.toFixed(1)));
    
    setSpeedHistory(prev => {
      const newHistory = [...prev, processedSpeed];
      if (newHistory.length > 10) newHistory.shift();
      return newHistory;
    });
    
    if (latestCoord.accuracy) {
      if (latestCoord.accuracy < 10) setLocationAccuracy("High");
      else if (latestCoord.accuracy < 25) setLocationAccuracy("Medium");
      else setLocationAccuracy("Low");
    }
    
    if (Date.now() - (lastUpdated?.getTime() || 0) > 30000) {
      try {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: latestCoord.latitude,
          longitude: latestCoord.longitude,
        });
        
        if (geocode.length > 0 && isMounted.current) {
          const place = geocode[0];
          const newAddress = `${place.street || place.name || ""} ${place.city || place.region || ""}, ${place.country || ""}`.trim();
          if (newAddress) setAddress(newAddress);
        }
      } catch (error) {
        console.error("Error getting address:", error);
      }
    }
    
    setLastUpdated(new Date());
    
    updateGlobalSensorData({
      speed: processedSpeed,
      coords: {
        latitude: latestCoord.latitude,
        longitude: latestCoord.longitude,
        accuracy: latestCoord.accuracy
      },
      address: address
    });
  }, [speed, lastUpdated, address]);

  // Start location tracking
  useEffect(() => {
    startLocationTracking();
    
    return () => {
      if (locationSubRef.current) {
        locationSubRef.current.remove();
      }
    };
  }, [startLocationTracking]);

  // Update time ago
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastUpdated && isMounted.current) {
        const diff = Math.floor((new Date() - lastUpdated) / 1000);
        if (diff < 10) setTimeAgo("Just now");
        else if (diff < 60) setTimeAgo(`${diff}s ago`);
        else if (diff < 3600) setTimeAgo(`${Math.floor(diff / 60)}m ago`);
        else if (diff < 86400) setTimeAgo(`${Math.floor(diff / 3600)}h ago`);
        else setTimeAgo(`${Math.floor(diff / 86400)}d ago`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  // Gyroscope setup
  useEffect(() => {
    Gyroscope.isAvailableAsync().then(result => {
      if (isMounted.current) setGyroAvailable(result);
    }).catch(error => {
      console.error("Gyroscope not available:", error);
      if (isMounted.current) setGyroAvailable(false);
    });
  }, []);

  useEffect(() => {
    let sub;
    if (isMounted.current && gyroAvailable) {
      try {
        sub = Gyroscope.addListener((data) => {
          if (isMounted.current && Math.abs(data.x) <= 1 && Math.abs(data.y) <= 1 && Math.abs(data.z) <= 1) {
            setOrientation(data);
            updateGlobalSensorData({ orientation: data });
          }
        });
        Gyroscope.setUpdateInterval(500);
        gyroSubscriptionRef.current = sub;
      } catch (error) {
        console.error("Error setting up gyroscope:", error);
        if (isMounted.current) setGyroAvailable(false);
      }
    }
    return () => {
      if (sub) sub.remove();
    };
  }, [gyroAvailable]);

  // Accelerometer setup
  useEffect(() => {
    Accelerometer.isAvailableAsync().then(result => {
      if (isMounted.current) setAccelAvailable(result);
    }).catch(error => {
      console.error("Accelerometer not available:", error);
      if (isMounted.current) setAccelAvailable(false);
    });
  }, []);

  useEffect(() => {
    let sub;
    if (isMounted.current && accelAvailable) {
      try {
        sub = Accelerometer.addListener((data) => {
          const rawGForce = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2) / 9.81;
          
          gForceBuffer.current.push(rawGForce);
          if (gForceBuffer.current.length > 5) gForceBuffer.current.shift();
          const smoothedGForce = gForceBuffer.current.reduce((sum, val) => sum + val, 0) / gForceBuffer.current.length;
          
          if (isMounted.current) {
            setLastGForce(parseFloat(smoothedGForce.toFixed(2)));
            updateGlobalSensorData({ gForce: smoothedGForce });
            
            if (smoothedGForce > 3.5 && !localImpact) {
              setLocalImpact(true);
              setTimeout(() => {
                if (isMounted.current) setLocalImpact(false);
              }, 5000);
            }
          }
        });
        Accelerometer.setUpdateInterval(100);
        accelSubscriptionRef.current = sub;
      } catch (error) {
        console.error("Error setting up accelerometer:", error);
        if (isMounted.current) setAccelAvailable(false);
      }
    }
    return () => {
      if (sub) sub.remove();
    };
  }, [accelAvailable, localImpact]);

  // Emergency detection interval
  useEffect(() => {
    const interval = setInterval(() => {
      checkForEmergency();
    }, 1000);
    
    return () => {
      clearInterval(interval);
    };
  }, [checkForEmergency]);

  // 🧪 Test Accident Button
  const simulateAccident = useCallback(() => {
    if (!isMounted.current) return;
    
    setLocalImpact(true);
    
    const testEmergency = {
      type: "HARD_BRAKING",
      severity: "MEDIUM",
      message: "Test: Hard braking detected",
      score: 75
    };
    
    updateGlobalSensorData({
      speed: 45,
      gForce: 4.2,
      soundLevel: 98,
      orientation: { x: 0.85, y: 0.3, z: 0.15 }
    });
    
    triggerGlobalEmergency(testEmergency);
  }, []);

  // Refresh location
  const refreshLocation = useCallback(async () => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 10000,
      });
      if (location.coords) {
        updateLocationData(location.coords);
      }
    } catch (error) {
      Alert.alert("Location Error", "Could not refresh location");
    }
  }, [updateLocationData]);

  // Helpers
  const getUserName = () =>
    userData?.username || userData?.name || userData?.email?.split("@")[0] || "Driver";

  const getProfileImage = () =>
    userData?.profileImage || userData?.photoURL || null;

  const systemStatus = gpsAvailable ? "Active" : "Checking...";

  // Render map
  const renderMap = () => {
    if (!coords) {
      return (
        <View style={styles.mapPlaceholder}>
          <ActivityIndicator size="large" color="#1d807c" />
          <Text style={styles.placeholderText}>Fetching location...</Text>
          <TouchableOpacity style={styles.refreshButton} onPress={refreshLocation}>
            <Text style={styles.refreshButtonText}>Refresh Location</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.mapContainer}
        onPress={() => {
          const { latitude, longitude } = coords;
          const url =
            Platform.OS === "ios"
              ? `http://maps.apple.com/?ll=${latitude},${longitude}`
              : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
          Linking.openURL(url);
        }}
      >
        <WebView
          ref={webViewRef}
          source={{ html: getMapHTML() }}
          style={styles.map}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          onMessage={handleWebViewMessage}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('WebView error: ', nativeEvent);
          }}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.mapPlaceholder}>
              <ActivityIndicator size="large" color="#1d807c" />
              <Text style={styles.placeholderText}>Loading map...</Text>
            </View>
          )}
        />

        <View style={styles.mapOverlay}>
          <Text style={styles.boxTitle}> Current Location</Text>
          <Text style={styles.mapAddress} numberOfLines={2}>{address}</Text>
          <View style={styles.mapInfoRow}>
            <Text style={styles.timeText}> {timeAgo}</Text>
            <Text style={[
              styles.accuracyText,
              { color: locationAccuracy === "High" ? "#10b981" : locationAccuracy === "Medium" ? "#f59e0b" : "#ef4444" }
            ]}>
              Accuracy: {locationAccuracy}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.mainContainer}>
      {/* TOP BAR EMERGENCY ALERT */}
      {globalEmergencyState.isActive && (
        <View style={styles.topEmergencyAlert}>
          <Ionicons name="alert-circle" size={20} color="#fff" />
          <View style={styles.topAlertContent}>
            <Text style={styles.topAlertTitle}>🚨 EMERGENCY DETECTED</Text>
            <Text style={styles.topAlertMessage} numberOfLines={1}>
              {globalEmergencyState.emergencyType?.message || "Emergency alert"}
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.topAlertCancelButton}
            onPress={handleUserSafe}
          >
            <Text style={styles.topAlertCancelText}>Cancel ({globalEmergencyState.countdown}s)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Header */}
      <View style={[styles.headerWrapper, { marginTop: globalEmergencyState.isActive ? 44 : 0 }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>DriveMate</Text>
            <Text style={styles.subTitle}>Emergency Dashboard</Text>
          </View>
          <View style={styles.profileWrapper}>
            {loadingUser ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.profileName} numberOfLines={1}>{getUserName()}</Text>
                {getProfileImage() ? (
                  <Image source={{ uri: getProfileImage() }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="person" size={20} color="#1d807c" />
                  </View>
                )}
              </>
            )}
          </View>
        </View>
        <View style={styles.curve}></View>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Emergency Alert Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={emergencyAlertVisible}
          onRequestClose={() => {
            setEmergencyAlertVisible(false);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Ionicons name="warning" size={40} color="#e63946" />
                <Text style={styles.modalTitle}>Emergency Detected</Text>
              </View>
              <Text style={styles.modalText}>{currentEmergencyType?.message}</Text>
              <View style={styles.countdownContainer}>
                <View style={styles.countdownCircle}>
                  <Text style={styles.countdownText}>{emergencyCountdown}s</Text>
                </View>
                <Text style={styles.countdownLabel}>Time remaining to cancel</Text>
              </View>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.safeButton]}
                  onPress={handleUserSafe}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.buttonText}>I'm Safe</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={styles.modalNote}>
                If no response in {emergencyCountdown}s, emergency will be logged
              </Text>
            </View>
          </View>
        </Modal>

        {/* Voice Command Modal */}
        <Modal
          visible={showVoiceModal}
          transparent
          animationType="fade"
          onRequestClose={cancelVoiceRecording}
        >
          <View style={styles.voiceModalOverlay}>
            <View style={styles.voiceModalContent}>
              <Animated.View style={[
                styles.voicePulseCircle,
                { 
                  transform: [{ scale: voicePulseAnim }],
                  backgroundColor: isProcessingVoice ? '#1d807c20' : '#1d807c20'
                }
              ]}>
                <Ionicons 
                  name={isProcessingVoice ? "cloud-upload" : "mic"} 
                  size={64} 
                  color="#1d807c" 
                />
              </Animated.View>
              
              <Text style={[styles.voiceModalTitle, { color: '#1d807c' }]}>
                {isProcessingVoice ? 'PROCESSING...' : 'LISTENING...'}
              </Text>
              
              <View style={styles.recordingStatus}>
                <View style={styles.recordingIndicator}>
                  <View style={[
                    styles.recordingDot,
                    { backgroundColor: isProcessingVoice ? '#1d807c' : '#1d807c' }
                  ]} />
                  <Text style={[
                    styles.recordingText,
                    { color: '#1d807c' }
                  ]}>
                    {isProcessingVoice ? '● PROCESSING' : '● RECORDING'}
                  </Text>
                </View>
                <Text style={styles.recordingTime}>
                  {isProcessingVoice 
                    ? 'Analyzing your voice...' 
                    : `Recording... ${recordingTime}s (Release mic button to stop)`}
                </Text>
              </View>
              
              {voiceTranscription && (
                <View style={styles.transcriptionContainer}>
                  <Text style={styles.transcriptionLabel}>
                    {isProcessingVoice ? 'Processing:' : 'Heard:'}
                  </Text>
                  <Text style={styles.transcriptionText}>"{voiceTranscription}"</Text>
                </View>
              )}
              
              {voiceConfidence > 0 && (
                <Text style={styles.confidenceText}>
                  Confidence: {(voiceConfidence * 100).toFixed(0)}%
                </Text>
              )}
              
              <Text style={styles.voiceModalSubtitle}>
                {isProcessingVoice 
                  ? 'Please wait while we process your voice...' 
                  : 'Speak clearly into the microphone'}
              </Text>
              
              {!isProcessingVoice && (
                <View style={styles.commandExamples}>
                  <Text style={styles.examplesTitle}>Try saying:</Text>
                  <Text style={styles.example}>• "Emergency" or "Call emergency"</Text>
                  <Text style={styles.example}>• "Cancel emergency" or "I'm safe"</Text>
                  <Text style={styles.example}>• "Refresh location"</Text>
                  <Text style={styles.example}>• "Simulate emergency" (for testing)</Text>
                </View>
              )}
              
              <TouchableOpacity
                style={[styles.voiceModalCancelButton, { backgroundColor: '#1d807c' }]}
                onPress={cancelVoiceRecording}
              >
                <Text style={styles.voiceModalCancelText}>
                  {isProcessingVoice ? 'Close' : 'Cancel Recording'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Voice Command History */}
        {voiceCommandHistory.length > 0 && (
          <View style={[styles.fullBox, styles.voiceHistoryBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>VOICE COMMANDS</Text>
              {voiceCommandHistory.map((item, index) => (
                <View key={index} style={styles.voiceHistoryItem}>
                  <Ionicons 
                    name={item.success ? "checkmark-circle" : "close-circle"} 
                    size={14} 
                    color={item.success ? "#1d807c" : "#d32f2f"} 
                  />
                  <View style={styles.voiceHistoryTextContainer}>
                    <Text style={styles.voiceHistoryCommand}>
                      "{item.command}"
                    </Text>
                    <Text style={styles.voiceHistoryTranscription}>
                      Heard: "{item.transcription}"
                    </Text>
                    <Text style={styles.voiceHistoryTime}>
                      {item.timestamp} • {(item.confidence * 100).toFixed(0)}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <Ionicons name="chatbubbles" size={24} color="#1D807C" />
          </View>
        )}

        {/* Emergency Stored Success Message */}
        {emergencyStored && (
          <View style={[styles.fullBox, styles.successBox]}>
            <Ionicons name="checkmark-circle" size={28} color="#10b981" style={styles.iconLeft} />
            <View style={styles.textPart}>
              <Text style={[styles.boxTitle, { color: "#10b981" }]}>✅ Emergency Logged</Text>
              <Text style={[styles.boxValue, styles.successMessage]}>
                {emergencyStoredMessage}
              </Text>
              <Text style={[styles.boxSubtext, { color: "#10b981" }]}>
                This alert will auto-dismiss in 10 seconds
              </Text>
            </View>
          </View>
        )}

        {/* Active Emergency Alert */}
        {emergencyDetected && !emergencyStored && (
          <View style={[styles.fullBox, styles.emergencyAlertBox]}>
            <Ionicons name="alert-circle" size={28} color="#e63946" style={styles.iconLeft} />
            <View style={styles.textPart}>
              <Text style={[styles.boxTitle, { color: "#e63946" }]}>⚠️ EMERGENCY DETECTED</Text>
              <Text style={[styles.boxValue, { color: "#e63946" }]}>
                {currentEmergencyType?.message || "Emergency triggered"}
              </Text>
              <Text style={[styles.boxSubtext, { color: "#e63946" }]}>
                Time remaining: {emergencyCountdown}s • Tap below if you're safe
              </Text>
              <TouchableOpacity 
                style={[styles.safeButton, styles.inlineSafeButton]}
                onPress={handleUserSafe}
              >
                <Text style={[styles.buttonText, styles.inlineButtonText]}>I'm Safe - Cancel Emergency</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* System Status */}
        <View style={styles.statusSection}>
          <TouchableOpacity
            style={[styles.fullBox, styles.systemStatusBox]}
            onPress={refreshLocation}
          >
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>System Status</Text>
              <Text
                style={[
                  styles.boxValue,
                  { color: systemStatus === "Active" ? "#10b981" : "#f59e0b" },
                ]}
              >
                {systemStatus}
              </Text>
              <Text style={styles.statusDescription}>
                {systemStatus === "Active" ? "Monitoring your journey" : "Sensors initializing"}
              </Text>
              <View style={styles.sensorStatusRow}>
                <View style={styles.sensorStatusItem}>
                  <Text style={styles.sensorLabel}>GPS: </Text>
                  <Ionicons name={gpsAvailable ? "checkmark-circle" : "close-circle"} size={14} color={gpsAvailable ? "#10b981" : "#ef4444"} />
                </View>

                <View style={styles.sensorStatusItem}>
                  <Text style={styles.sensorLabel}>Gyro: </Text>
                  <Ionicons name={gyroAvailable ? "checkmark-circle" : "close-circle"} size={14} color={gyroAvailable ? "#10b981" : "#ef4444"} />
                </View>

                <View style={styles.sensorStatusItem}>
                  <Text style={styles.sensorLabel}>Accel: </Text>
                  <Ionicons name={accelAvailable ? "checkmark-circle" : "close-circle"} size={14} color={accelAvailable ? "#10b981" : "#ef4444"} />
                </View>

                <View style={styles.sensorStatusItem}>
                  <Text style={styles.sensorLabel}>Mic: </Text>
                  <Ionicons 
                    name={micAvailable ? "checkmark-circle" : micPermissionDenied ? "close-circle" : "alert-circle"} 
                    size={14} 
                    color={micAvailable ? "#10b981" : micPermissionDenied ? "#ef4444" : "#f59e0b"} 
                  />
                </View>

                <View style={styles.sensorStatusItem}>
                  <Text style={styles.sensorLabel}>Voice: </Text>
                  <Ionicons 
                    name={isVoiceModelLoaded ? "checkmark-circle" : voiceServiceStatus === 'initializing' ? "alert-circle" : "close-circle"} 
                    size={14} 
                    color={isVoiceModelLoaded ? "#10b981" : voiceServiceStatus === 'initializing' ? "#f59e0b" : "#ef4444"} 
                  />
                </View>
              </View>
              {gpsAvailable && (
                <Text style={styles.locationInfo}>
                   Location Accuracy: {locationAccuracy}
                </Text>
              )}
            </View>
            <Ionicons name="analytics" size={24} color="#1d807c" />
          </TouchableOpacity>
        </View>

        {/* Trip Info */}
        {isLogging && (
          <View style={styles.tripInfoSection}>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.box, styles.distanceBox]}>
                <View style={styles.textPart}>
                  <Text style={styles.boxTitle}>Distance</Text>
                  <Text style={styles.boxValue}>{distance.toFixed(2)} km</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.box, styles.speedBox]}>
                <View style={styles.textPart}>
                  <Text style={styles.boxTitle}>Avg Speed</Text>
                  <Text style={styles.boxValue}>{avgSpeed.toFixed(1)} km/h</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Sensor Data Boxes */}
        <View style={styles.sensorSection}>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.box, styles.speedSensorBox]}>
              <View style={styles.textPart}>
                <Text style={styles.boxTitle}>Current Speed</Text>
                <Text style={[styles.boxValue, styles.speedValue]}>
                  {speed} km/h
                </Text>
                <Text style={styles.sensorSubtext}>
                  {gpsAvailable ? (speed > 5 ? "Moving" : "Stationary") : "GPS unavailable"}
                </Text>
              </View>
              <Ionicons name="speedometer" size={24} color="#1d807c" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.box, (impactDetected || localImpact) ? styles.impactDetectedBox : styles.impactBox]}
            >
              <View style={styles.textPart}>
                <Text style={styles.boxTitle}>Impact</Text>
                <Text
                  style={[
                    styles.boxValue,
                    { color: (impactDetected || localImpact) ? "#ef4444" : "#1d807c" },
                  ]}
                >
                  {(impactDetected || localImpact) ? "Detected" : "None"}
                </Text>
                <Text style={styles.sensorSubtext}>
                  G-force: {lastGForce.toFixed(2)}
                </Text>
              </View>
              <Ionicons 
                name={(impactDetected || localImpact) ? "warning" : "shield-checkmark"} 
                size={24} 
                color={(impactDetected || localImpact) ? "#ef4444" : "#1d807c"} 
              />
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={[styles.box, styles.orientationBox]}>
              <View style={styles.textPart}>
                <Text style={styles.boxTitle}>Orientation</Text>
                <Text style={styles.boxValue}>
                  {gyroAvailable ? 
                    `X:${orientation.x.toFixed(2)}` 
                    : "N/A"}
                </Text>
                <Text style={styles.sensorSubtext}>
                  {gyroAvailable ? "Gyroscope active" : "Gyroscope unavailable"}
                </Text>
              </View>
              <Ionicons name="phone-portrait" size={24} color="#1d807c" />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.box, styles.soundBox]}>
              <View style={styles.textPart}>
                <Text style={styles.boxTitle}>Sound Level</Text>
                <Text style={styles.boxValue}>
                  {soundLevel} dB
                </Text>
                <Text style={styles.sensorSubtext}>
                  {micAvailable ? "Microphone active" : micPermissionDenied ? "Permission denied" : "Microphone unavailable"}
                </Text>
              </View>
              <Ionicons name="mic" size={24} color="#1d807c" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Map Section */}
        <View style={[styles.fullBox, styles.mapSection]}>
          {renderMap()}
        </View>

        {/* Emergency Action Buttons */}
        <View style={styles.emergencyButtonsContainer}>

          <TouchableOpacity
            style={styles.testButton}
            onPress={simulateAccident}
            disabled={emergencyDetected || emergencyStored || globalEmergencyState.isActive}
          >
            <View style={styles.testButtonIcon}>
              <Ionicons name="flask" size={24} color="#fff" />
            </View>
            <View style={styles.testButtonContent}>
              <Text style={styles.testButtonTitle}>TRIGGER EMERGENCY</Text>
              <Text style={styles.testButtonDescription}>The emergency detection system</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
      
      {/* Footer */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity onPress={() => navigation.navigate("DriverDashboard")}>
            <Ionicons name="home" size={28} color="#fff" />
          </TouchableOpacity>
          
          {/* Press-and-hold Mic Button */}
          <TouchableOpacity
            ref={micButtonRef}
            onPressIn={handleMicPressIn}
            onPressOut={handleMicPressOut}
            delayLongPress={300}
            activeOpacity={0.7}
            disabled={isProcessingVoice || !isVoiceModelLoaded}
            style={[
              styles.micButtonContainer,
              isVoiceListening && styles.micButtonActive,
              isProcessingVoice && styles.micButtonProcessing,
              (!isVoiceModelLoaded || isProcessingVoice) && styles.micButtonDisabled
            ]}
          >
            <Ionicons 
              name={isVoiceListening ? "mic" : "mic-outline"} 
              size={32} 
              color={
                !isVoiceModelLoaded ? "#9CA3AF" :
                isVoiceListening ? "#fff" :
                isProcessingVoice ? "#fff" : "#fff"
              }
            />
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => navigation.navigate("DriverSettings")}>
            <Ionicons name="settings" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: "#fff" },
  scrollContainer: { paddingBottom: 120 },
  
  // TOP BAR EMERGENCY ALERT
  topEmergencyAlert: {
    backgroundColor: "#e63946",
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 10,
  },
  topAlertContent: {
    flex: 1,
    marginLeft: 12,
  },
  topAlertTitle: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  topAlertMessage: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    marginTop: 2,
  },
  topAlertCancelButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  topAlertCancelText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: '600',
  },
  
  // Header Styles
  headerWrapper: { 
    position: "relative", 
    backgroundColor: "#1d807c",
  },
  headerContent: {
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  curve: {
    width: width,
    height: 30,
    backgroundColor: "#fff",
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    marginTop: -10,
  },
  headerTitle: { fontSize: 24, fontWeight: "bold", color: "#fff" },
  subTitle: { fontSize: 14, color: "#fff", marginTop: 2 },
  profileWrapper: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "40%",
  },
  profileName: {
    color: "#fff",
    marginRight: 8,
    fontSize: 14,
    fontWeight: "600",
    maxWidth: 100,
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#fff",
  },
  profileImagePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  
  // Voice Modal Styles
  voiceModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  voiceModalContent: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 32,
    width: '90%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  voicePulseCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  voiceModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  recordingStatus: {
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  recordingText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  recordingTime: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  transcriptionContainer: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  transcriptionLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
    fontWeight: '600',
  },
  transcriptionText: {
    fontSize: 16,
    color: '#1F2937',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  confidenceText: {
    fontSize: 12,
    color: '#1d807c',
    fontWeight: '600',
    marginBottom: 16,
  },
  voiceModalSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 16,
    textAlign: 'center',
  },
  commandExamples: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
  },
  examplesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
    marginBottom: 8,
  },
  example: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 8,
    marginBottom: 4,
  },
  voiceModalCancelButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  voiceModalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  
  // Voice History Styles
  voiceHistoryBox: {
    backgroundColor: '#f0f7f6',
    borderWidth: 1,
    borderColor: '#1d807c20',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  voiceHistoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1d807c20',
  },
  voiceHistoryTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  voiceHistoryCommand: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  voiceHistoryTranscription: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    marginBottom: 2,
  },
  voiceHistoryTime: {
    fontSize: 11,
    color: '#888',
  },
  
  // Mic Button Styles
  micButtonContainer: {
    backgroundColor: '#1D807C',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  micButtonActive: {
    backgroundColor: '#EF4444',
    transform: [{ scale: 1.1 }],
  },
  micButtonProcessing: {
    backgroundColor: '#1d807c',
  },
  micButtonDisabled: {
    backgroundColor: '#9CA3AF',
    opacity: 0.7,
  },
  
  // Box Styles
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  box: {
    flex: 1,
    marginHorizontal: 5,
    padding: 14,
    borderRadius: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 70,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  fullBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderRadius: 20,
    marginHorizontal: 16,
    marginBottom: 12,
    minHeight: 90,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  textPart: { flex: 1, alignItems: "flex-start" },
  boxTitle: { fontSize: 14, color: "#555", fontWeight: "600", marginBottom: 2 },
  boxValue: { fontSize: 15, fontWeight: "bold", color: "#1d807c" },
  boxSubtext: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
  },
  speedValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  
  // Status Section
  statusSection: {
    marginBottom: 8,
  },
  systemStatusBox: {
    backgroundColor: "#f0f9ff",
    marginHorizontal: 16,
  },
  statusDescription: {
    fontSize: 13,
    color: "#555",
    marginTop: 4,
  },
  sensorStatusRow: {
    flexDirection: "row",
    marginTop: 8,
    flexWrap: 'wrap',
  },
  sensorStatusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    marginBottom: 4,
  },
  sensorLabel: {
    fontSize: 12,
    color: "#777",
  },
  locationInfo: {
    fontSize: 12,
    color: "#1d807c",
    marginTop: 4,
  },
  
  // Trip Info Section
  tripInfoSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  distanceBox: {
    backgroundColor: "#f9f3f3",
  },
  speedBox: {
    backgroundColor: "#f3f9f4",
  },
  
  // Sensor Section
  sensorSection: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  speedSensorBox: {
    backgroundColor: "#fef3c7",
  },
  impactBox: {
    backgroundColor: "#f3f6f9",
  },
  impactDetectedBox: {
    backgroundColor: "#fecaca",
  },
  orientationBox: {
    backgroundColor: "#f3e8ff",
  },
  soundBox: {
    backgroundColor: "#dcfce7",
  },
  sensorSubtext: {
    fontSize: 12,
    color: "#777",
    marginTop: 2,
  },
  
  // Map Styles
  mapSection: {
    backgroundColor: "#e0f2fe",
    minHeight: 320,
    padding: 0,
    overflow: 'hidden',
    marginHorizontal: 16,
  },
  mapContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#e0f2fe',
  },
  map: {
    width: '100%',
    height: 220,
    backgroundColor: '#f5f5f5',
  },
  mapOverlay: {
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  mapAddress: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1d807c",
    marginTop: 4,
  },
  mapInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  timeText: {
    fontSize: 12,
    color: "gray",
  },
  accuracyText: {
    fontSize: 12,
    fontWeight: '500',
  },
  mapHint: {
    fontSize: 12,
    color: "#1d807c",
    marginTop: 8,
    fontStyle: 'italic',
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 320,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  placeholderText: {
    marginTop: 10,
    color: "#555",
  },
  
  // Alert Box Styles
  emergencyAlertBox: {
    backgroundColor: "#ffe6e6",
    borderWidth: 2,
    borderColor: "#e63946",
    marginHorizontal: 16,
    marginBottom: 12,
  },
  successBox: {
    backgroundColor: "#f0fff4",
    borderWidth: 2,
    borderColor: "#10b981",
    marginHorizontal: 16,
    marginBottom: 12,
  },
  successMessage: {
    color: "#10b981",
    marginTop: 4,
  },
  inlineSafeButton: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#e63946",
  },
  inlineButtonText: {
    fontSize: 14,
  },
  
  
  // Test Emergency Button
  testButton: {
    backgroundColor: "#e61010",
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: "#c22a2a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  testButtonIcon: {
    marginRight: 16,
  },
  testButtonContent: {
    flex: 1,
  },
  testButtonTitle: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
    marginBottom: 4,
  },
  testButtonDescription: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
  },
  
  // Footer
  footerWrapper: {
    position: "absolute",
    bottom: 16,
    width: "100%",
    alignItems: "center",
  },
  footerNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#1d807c",
    width: width * 0.92,
    borderRadius: 35,
    paddingVertical: 14,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    borderWidth: 5.0,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: 'center',
  },
  
  // Refresh Button
  refreshButton: {
    backgroundColor: "#1d807c",
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  refreshButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },
  
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 24,
    padding: 25,
    alignItems: "center",
    width: width * 0.85,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 10,
    color: "#e63946",
    textAlign: 'center',
  },
  modalText: {
    fontSize: 18,
    marginBottom: 25,
    textAlign: "center",
    lineHeight: 24,
    color: '#333',
  },
  countdownContainer: {
    alignItems: 'center',
    marginBottom: 25,
  },
  countdownCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e63946',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  countdownText: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
  },
  countdownLabel: {
    fontSize: 14,
    color: '#666',
  },
  modalButtons: {
    width: "100%",
    marginBottom: 15,
  },
  modalButton: {
    borderRadius: 12,
    padding: 16,
    elevation: 3,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  safeButton: {
    backgroundColor: "#4CAF50",
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
    textAlign: "center",
    fontSize: 16,
  },
  modalNote: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
  
  iconLeft: { marginRight: 12 },
});