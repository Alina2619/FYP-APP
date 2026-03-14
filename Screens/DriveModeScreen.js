import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Animated,
  Modal,
} from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where,
  orderBy, 
  limit, 
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';

// Import emergency functions
import { 
  subscribeToEmergency, 
  cancelGlobalEmergency,
  globalEmergencyState,
  triggerGlobalEmergency,
  updateGlobalSensorData
} from './Emergency';

// Import voice command service
import voiceCommandService from '../src/voice/VoiceCommandService';

// Activity Recognition Component
import SimpleActivityMonitor from '../src/components/SimpleActivityMonitor';

const { width } = Dimensions.get('window');

const DriveModeScreen = ({ navigation }) => {
  const [userData, setUserData] = useState(null);
  const [activeTrip, setActiveTrip] = useState(null);
  const [allTrips, setAllTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // REAL SENSOR DATA STATES
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [gForce, setGForce] = useState(1.0);
  const [soundLevel, setSoundLevel] = useState(0);
  const [phoneUsage, setPhoneUsage] = useState(0);
  const [distractionLevel, setDistractionLevel] = useState(0);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState('Unknown');
  const [acceleration, setAcceleration] = useState(0);
  const [orientation, setOrientation] = useState({ x: 0, y: 0, z: 0 });
  
  // Emergency states
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState(null);
  const [emergencyCountdown, setEmergencyCountdown] = useState(10);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  
  // Activity Recognition States
  const [currentActivity, setCurrentActivity] = useState('Ready');
  const [activityConfidence, setActivityConfidence] = useState(0);
  const [isActivityMonitoring, setIsActivityMonitoring] = useState(true);
  
  // VOICE COMMAND STATES
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [voiceConfidence, setVoiceConfidence] = useState(0);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isVoiceModelLoaded, setIsVoiceModelLoaded] = useState(false);
  const [voiceServiceStatus, setVoiceServiceStatus] = useState('initializing');
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [voiceCommandHistory, setVoiceCommandHistory] = useState([]);
  
  // Driving statistics
  const [drivingStats, setDrivingStats] = useState({
    totalTrips: 0,
    totalDistance: 0,
    totalDuration: 0,
    avgSafetyScore: 0,
    avgEcoScore: 0,
    harshBrakingEvents: 0,
    speedingEvents: 0,
    phoneUsageEvents: 0,
    distractionEvents: 0,
    sharpTurnEvents: 0,
    rapidAccelerationEvents: 0,
  });
  
  const [alerts, setAlerts] = useState([]);
  const [currentAlert, setCurrentAlert] = useState(null);
  const alertAnim = useRef(new Animated.Value(0)).current;
  const emergencyPulseAnim = useRef(new Animated.Value(1)).current;
  
  // VOICE COMMAND REFS
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimerRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const isHoldingMicRef = useRef(false);
  const pulseAnimationRef = useRef(null);
  const micButtonRef = useRef(null);
  
  // Sensor refs and buffers
  const locationSubscription = useRef(null);
  const accelerometerSubscription = useRef(null);
  const gyroscopeSubscription = useRef(null);
  const soundUpdateInterval = useRef(null);
  const isMounted = useRef(true);
  const speedBuffer = useRef([]);
  const locationBuffer = useRef([]);
  const soundBuffer = useRef([]);
  const MAX_BUFFER_SIZE = 10;

  // Listen to global emergency events
  useEffect(() => {
    const unsubscribe = subscribeToEmergency((event) => {
      switch (event.type) {
        case 'EMERGENCY_TRIGGERED':
          setEmergencyActive(true);
          setEmergencyType(event.emergency);
          setEmergencyCountdown(event.countdown);
          setShowEmergencyModal(true);
          
          if (isVoiceEnabled) {
            speakQuickAlert(`Emergency detected: ${event.emergency.message}. You have 10 seconds to cancel.`);
          }
          break;
          
        case 'COUNTDOWN_UPDATE':
          setEmergencyCountdown(event.countdown);
          break;
          
        case 'EMERGENCY_EXPIRED':
          setEmergencyActive(false);
          setShowEmergencyModal(false);
          if (isVoiceEnabled) {
            speakQuickAlert("Emergency has been logged to authorities.");
          }
          break;
          
        case 'EMERGENCY_CANCELLED':
          setEmergencyActive(false);
          setEmergencyType(null);
          setShowEmergencyModal(false);
          if (isVoiceEnabled) {
            speakQuickAlert("Emergency cancelled. We're glad you're safe!");
          }
          break;
      }
    });
    
    return unsubscribe;
  }, [isVoiceEnabled]);

  // Initialize voice command service
  const initializeVoiceCommandService = useCallback(async () => {
    try {
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
    Speech.speak(message, { language: 'en-US', pitch: 1.0, rate: 0.9 });
  }, [isVoiceEnabled]);

  // Quick voice alert function
  const speakQuickAlert = useCallback((message) => {
    if (!isVoiceEnabled) return;
    Speech.stop();
    Speech.speak(message, { language: 'en-US', pitch: 1.0, rate: 0.9 });
  }, [isVoiceEnabled]);

  // Voice navigation feedback
  const speakNavigationFeedback = useCallback((screenName) => {
    if (!isVoiceEnabled) return;
    const messages = {
      'DriverDashboard': 'Navigating to Dashboard',
      'TripLogger': 'Navigating to Trip Logger',
      'DriveMateDashboard': 'Navigating to Emergency Dashboard',
      'DriverSettings': 'Navigating to Settings',
      'Analytics': 'Navigating to Analytics'
    };
    speakQuickAlert(messages[screenName] || `Navigating to ${screenName}`);
  }, [isVoiceEnabled, speakQuickAlert]);

  // Handle emergency cancellation
  const handleCancelEmergency = async () => {
    try {
      cancelGlobalEmergency();
      setShowEmergencyModal(false);
      
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          emergencyStatus: 'cancelled',
          updatedAt: new Date().toISOString()
        });
      }
      
      if (isVoiceEnabled) {
        speakQuickAlert("Emergency cancelled. We're glad you're safe!");
      }
      
    } catch (error) {
      console.error("Error cancelling emergency:", error);
      Alert.alert("Error", "Failed to cancel emergency. Please try again.");
    }
  };

  // START REAL SENSOR MONITORING
  const startRealTimeMonitoring = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission Required", "Location permission is needed for accurate speed measurement.");
        return;
      }
      
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 15000,
      });
      
      updateLocationData(location.coords, true);
      
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 2,
        },
        (location) => {
          if (isMounted.current && location.coords) {
            updateLocationData(location.coords, false);
          }
        }
      );
      
      Accelerometer.setUpdateInterval(100);
      accelerometerSubscription.current = Accelerometer.addListener((data) => {
        const gForceMagnitude = Math.sqrt(
          Math.pow(data.x, 2) + 
          Math.pow(data.y, 2) + 
          Math.pow(data.z, 2)
        ) / 9.81;
        
        setGForce(gForceMagnitude);
        
        if (speedBuffer.current.length >= 2) {
          const recentSpeeds = speedBuffer.current.slice(-2);
          const accel = (recentSpeeds[1] - recentSpeeds[0]) / 0.1;
          setAcceleration(accel);
        }
        
        updateGlobalSensorData({
          speed: currentSpeed,
          gForce: gForceMagnitude,
          soundLevel: soundLevel,
          orientation: { x: data.x, y: data.y, z: data.z }
        });
      });
      
      Gyroscope.setUpdateInterval(100);
      gyroscopeSubscription.current = Gyroscope.addListener((data) => {
        setOrientation(data);
        
        const rotationRate = Math.sqrt(
          Math.pow(data.x, 2) + 
          Math.pow(data.y, 2) + 
          Math.pow(data.z, 2)
        );
        
        if (rotationRate > 2.0 && currentSpeed > 20) {
          showAlert({
            type: 'sharp_turn',
            message: 'Sharp turn detected!',
            severity: 'medium',
          });
        }
      });
      
      await startSoundMonitoring();
      
    } catch (error) {
      console.error('Error starting sensors:', error);
      Alert.alert("Sensor Error", "Could not start all sensors. Some features may not work.");
    }
  }, [currentSpeed, soundLevel]);

  // VOICE COMMAND FUNCTIONS

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
          triggerGlobalEmergency({
            type: 'VOICE_COMMAND',
            severity: 'HIGH',
            message: 'Manual emergency triggered by voice command'
          });
        };
        success = true;
        break;
        
      case 'cancel emergency':
      case 'i\'m safe':
      case 'safe':
      case 'cancel':
        if (!emergencyActive && !globalEmergencyState.isActive) {
          response = 'No emergency is currently active.';
          success = false;
        } else {
          response = 'Emergency cancelled. We\'re glad you\'re safe!';
          action = () => {
            handleCancelEmergency();
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
            speakNavigationFeedback('DriverDashboard');
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
            speakNavigationFeedback('TripLogger');
            setTimeout(() => {
              navigation.navigate('TripLogger');
            }, 800);
          }
        };
        success = true;
        break;
        
      case 'go to emergency dashboard':
      case 'open emergency':
      case 'emergency dashboard':
        response = 'Navigating to Emergency Dashboard.';
        action = () => {
          if (navigation) {
            speakNavigationFeedback('DriveMateDashboard');
            setTimeout(() => {
              navigation.navigate('DriveMateDashboard');
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
            speakNavigationFeedback('DriverSettings');
            setTimeout(() => {
              navigation.navigate('DriverSettings');
            }, 800);
          }
        };
        success = true;
        break;
        
      case 'show stats':
      case 'view statistics':
      case 'statistics':
        response = 'Showing driving statistics.';
        success = true;
        break;
        
      case 'start activity monitoring':
      case 'start monitoring':
      case 'enable monitoring':
        response = 'Activity monitoring started.';
        action = () => {
          setIsActivityMonitoring(true);
        };
        success = true;
        break;
        
      case 'stop activity monitoring':
      case 'stop monitoring':
      case 'disable monitoring':
        response = 'Activity monitoring stopped.';
        action = () => {
          setIsActivityMonitoring(false);
        };
        success = true;
        break;
        
      default:
        response = `Command "${command}" not recognized. Try: emergency, show stats, or dashboard.`;
        success = false;
    }
    
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
    
    if (isVoiceEnabled && success) {
      speakQuickAlert(response);
    }
    
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
  }, [navigation, isVoiceEnabled, speakQuickAlert, emergencyActive, handleCancelEmergency, speakNavigationFeedback]);

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

  // Start voice recording (for press and hold)
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

  // SOUND LEVEL MONITORING FUNCTION
  const startSoundMonitoring = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('Sound permission denied');
        return;
      }
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });
      
      const updateSoundLevel = () => {
        let simulatedSound = 40;
        
        if (currentSpeed > 60) simulatedSound += 20;
        if (currentSpeed > 80) simulatedSound += 10;
        
        if (currentActivity.toLowerCase().includes('driving')) {
          simulatedSound += 15;
        }
        
        simulatedSound += Math.random() * 10;
        
        soundBuffer.current.push(simulatedSound);
        if (soundBuffer.current.length > 5) {
          soundBuffer.current.shift();
        }
        
        const avgSound = soundBuffer.current.reduce((a, b) => a + b, 0) / soundBuffer.current.length;
        setSoundLevel(avgSound);
        
        if (avgSound > 85) {
          showAlert({
            type: 'noise',
            message: `Loud noise detected: ${avgSound.toFixed(0)} dB`,
            severity: 'medium',
          });
        }
      };
      
      soundUpdateInterval.current = setInterval(updateSoundLevel, 2000);
      updateSoundLevel();
      
    } catch (error) {
      console.error('Sound monitoring error:', error);
    }
  };

  // STOP ALL SENSORS
  const stopRealTimeMonitoring = useCallback(() => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    
    if (accelerometerSubscription.current) {
      accelerometerSubscription.current.remove();
      accelerometerSubscription.current = null;
    }
    
    if (gyroscopeSubscription.current) {
      gyroscopeSubscription.current.remove();
      gyroscopeSubscription.current = null;
    }
    
    if (soundUpdateInterval.current) {
      clearInterval(soundUpdateInterval.current);
      soundUpdateInterval.current = null;
    }
  }, []);

  // LOCATION DATA PROCESSING
  const updateLocationData = (coords, isInitial = false) => {
    if (!isMounted.current) return;
    
    locationBuffer.current.push({
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      speed: coords.speed,
      timestamp: Date.now()
    });
    
    if (locationBuffer.current.length > MAX_BUFFER_SIZE) {
      locationBuffer.current.shift();
    }
    
    const smoothedCoord = calculateSmoothedLocation(locationBuffer.current);
    
    setCurrentLocation(smoothedCoord);
    
    const smoothedSpeed = calculateSmoothedSpeed(coords.speed);
    setCurrentSpeed(smoothedSpeed);
    
    speedBuffer.current.push(smoothedSpeed);
    if (speedBuffer.current.length > 5) {
      speedBuffer.current.shift();
    }
    
    if (coords.accuracy) {
      if (coords.accuracy < 5) setLocationAccuracy("High");
      else if (coords.accuracy < 15) setLocationAccuracy("Medium");
      else if (coords.accuracy < 30) setLocationAccuracy("Low");
      else setLocationAccuracy("Poor");
    }
    
    if (smoothedSpeed > 60) {
      showAlert({
        type: 'speeding',
        message: `Speed: ${smoothedSpeed.toFixed(0)} km/h (Limit: 60)`,
        severity: 'high',
      });
    }
  };

  const calculateSmoothedLocation = (locations) => {
    if (locations.length === 0) return { latitude: 0, longitude: 0 };
    if (locations.length === 1) return locations[0];
    
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    
    locations.forEach((location, index) => {
      const weight = (index + 1) / locations.length;
      totalWeight += weight;
      weightedLat += location.latitude * weight;
      weightedLng += location.longitude * weight;
    });
    
    return {
      latitude: weightedLat / totalWeight,
      longitude: weightedLng / totalWeight,
      accuracy: locations[locations.length - 1].accuracy,
      speed: locations[locations.length - 1].speed,
    };
  };

  const calculateSmoothedSpeed = (currentSpeed) => {
    if (currentSpeed === null || currentSpeed < 0) return 0;
    
    const speedKmh = currentSpeed * 3.6;
    
    speedBuffer.current.push(speedKmh);
    if (speedBuffer.current.length > 5) {
      speedBuffer.current.shift();
    }
    
    const weights = [0.1, 0.15, 0.2, 0.25, 0.3];
    let totalWeight = 0;
    let weightedSum = 0;
    
    speedBuffer.current.forEach((speed, index) => {
      const weight = weights[weights.length - speedBuffer.current.length + index] || 0.3;
      weightedSum += speed * weight;
      totalWeight += weight;
    });
    
    const smoothedSpeed = weightedSum / totalWeight;
    
    return Math.max(0, Math.min(200, parseFloat(smoothedSpeed.toFixed(1))));
  };

  // Handle activity update from SimpleActivityMonitor
  const handleActivityUpdate = useCallback((activity) => {
    if (!activity || !activity.activity) return;
    
    setCurrentActivity(activity.activity);
    setActivityConfidence(activity.confidence || 0);
    
    if (activity.activity.toLowerCase().includes('phone') || 
        activity.activity.toLowerCase().includes('handheld')) {
      setPhoneUsage(prev => Math.min(100, prev + 5));
      setDistractionLevel(prev => Math.min(100, prev + 10));
      
      showAlert({
        type: 'phone_usage',
        message: 'Phone usage detected while driving!',
        severity: 'high',
      });
    }
    
    if (activity.activity.toLowerCase().includes('driving') && 
        activity.confidence > 0.7) {
      setPhoneUsage(prev => Math.max(0, prev - 1));
    }
  }, []);

  const showAlert = (alert) => {
    setAlerts(prev => [alert, ...prev.slice(0, 3)]);
    setCurrentAlert(alert);
    
    Animated.sequence([
      Animated.timing(alertAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(2000),
      Animated.timing(alertAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => setCurrentAlert(null), 300);
    });
  };

  const startEmergencyPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(emergencyPulseAnim, {
          toValue: 1.3,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(emergencyPulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const stopEmergencyPulseAnimation = () => {
    emergencyPulseAnim.stopAnimation();
    emergencyPulseAnim.setValue(1);
  };

  const fetchUserData = useCallback(async (user) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const data = userSnap.data();
        setUserData(data);
        setIsVoiceEnabled(data.driveModeSettings?.voiceEnabled ?? true);
      }
    } catch (error) {
      console.log('Error fetching user data:', error.message);
    }
  }, []);

  const fetchAllTrips = useCallback(async (userId) => {
    try {
      const tripsRef = collection(db, 'trips');
      const q = query(
        tripsRef,
        where('userId', '==', userId),
        orderBy('startTime', 'desc'),
        limit(50)
      );
      
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const trips = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data(),
          duration: doc.data().duration || 0
        }));
        
        setAllTrips(trips);
        
        const activeTrips = trips.filter(trip => trip.status === 'active');
        setActiveTrip(activeTrips[0] || null);
        
        const completedTrips = trips.filter(trip => trip.status === 'completed');
        const stats = {
          totalTrips: completedTrips.length,
          totalDistance: completedTrips.reduce((sum, trip) => sum + (trip.distance || 0), 0),
          totalDuration: completedTrips.reduce((sum, trip) => sum + (trip.duration || 0), 0),
          harshBrakingEvents: completedTrips.reduce((sum, trip) => sum + (trip.harshBrakingCount || 0), 0),
          speedingEvents: completedTrips.reduce((sum, trip) => sum + (trip.speedingCount || 0), 0),
          phoneUsageEvents: completedTrips.reduce((sum, trip) => sum + (trip.phoneUsageCount || 0), 0),
          distractionEvents: completedTrips.reduce((sum, trip) => sum + (trip.distractionCount || 0), 0),
          sharpTurnEvents: completedTrips.reduce((sum, trip) => sum + (trip.sharpTurnCount || 0), 0),
          rapidAccelerationEvents: completedTrips.reduce((sum, trip) => sum + (trip.rapidAccelerationCount || 0), 0),
        };
        
        if (completedTrips.length > 0) {
          const totalSafetyScore = completedTrips.reduce((sum, trip) => 
            sum + parseFloat(calculateSafetyScore(trip)), 0);
          
          const totalEcoScore = completedTrips.reduce((sum, trip) => 
            sum + parseFloat(calculateEcoScore(trip)), 0);
          
          stats.avgSafetyScore = (totalSafetyScore / completedTrips.length).toFixed(1);
          stats.avgEcoScore = (totalEcoScore / completedTrips.length).toFixed(1);
        }
        
        setDrivingStats(stats);
      } else {
        setAllTrips([]);
        setActiveTrip(null);
      }
    } catch (error) {
      console.log('Error fetching trips:', error.message);
      setAllTrips([]);
      setActiveTrip(null);
    }
  }, []);

  const calculateSafetyScore = useCallback((trip) => {
    if (!trip) return 5;
    
    let score = 5;
    if (trip.harshBrakingCount > 0) score -= Math.min(1.5, trip.harshBrakingCount * 0.3);
    if (trip.rapidAccelerationCount > 0) score -= Math.min(1.5, trip.rapidAccelerationCount * 0.3);
    if (trip.speedingCount > 0) score -= Math.min(2, trip.speedingCount * 0.2);
    if (trip.sharpTurnCount > 0) score -= Math.min(1, trip.sharpTurnCount * 0.2);
    if (trip.phoneUsageCount > 0) score -= Math.min(1.5, trip.phoneUsageCount * 0.5);
    
    return Math.max(0, score).toFixed(1);
  }, []);

  const calculateEcoScore = useCallback((trip) => {
    if (!trip || !trip.distance || trip.distance === 0) return 5;
    
    let score = 5;
    if (trip.rapidAccelerationCount > 0) score -= Math.min(1, trip.rapidAccelerationCount * 0.2);
    if (trip.harshBrakingCount > 0) score -= Math.min(1, trip.harshBrakingCount * 0.2);
    
    return Math.max(0, score).toFixed(1);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const auth = getAuth();
    const user = auth.currentUser;
    
    if (user) {
      await fetchUserData(user);
      await fetchAllTrips(user.uid);
    }
    
    setRefreshing(false);
  }, [fetchUserData, fetchAllTrips]);

  // Initialize voice assistant
  useEffect(() => {
    const initVoice = async () => {
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

    initVoice();
    initializeVoiceCommandService();
  }, [initializeVoiceCommandService]);

  useEffect(() => {
    isMounted.current = true;
    
    const auth = getAuth();
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await fetchUserData(user);
        await fetchAllTrips(user.uid);
      }
      setLoading(false);
    });
    
    startRealTimeMonitoring();
    
    return () => {
      unsubAuth();
      isMounted.current = false;
      stopRealTimeMonitoring();
      stopEmergencyPulseAnimation();
      
      voiceCommandService.cleanup();
      
      cleanupTimers();
      stopPulseAnimation();
    };
  }, [fetchUserData, fetchAllTrips, startRealTimeMonitoring, stopRealTimeMonitoring, cleanupTimers, stopPulseAnimation]);

  useEffect(() => {
    if (emergencyActive) {
      startEmergencyPulseAnimation();
    } else {
      stopEmergencyPulseAnimation();
    }
  }, [emergencyActive]);

  useEffect(() => {
    if (gForce > 3.5 && currentSpeed > 20) {
      showAlert({
        type: 'harsh_braking',
        message: `Hard braking! G-force: ${gForce.toFixed(1)}`,
        severity: 'high',
      });
    }
  }, [gForce, currentSpeed]);

  const getUserName = () => {
    if (!userData) return 'Driver';
    return userData.name || userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Driver';
  };

  const getProfileImage = () => {
    if (!userData) return null;
    return userData.profileImage || userData.photoURL || userData.imageUrl || null;
  };

  const getSafetyColor = (score) => {
    const numScore = parseFloat(score);
    if (numScore >= 4) return '#10b981';
    if (numScore >= 3) return '#f59e0b';
    return '#ef4444';
  };

  const getSpeedColor = (speed) => {
    if (speed <= 60) return '#10b981';
    if (speed <= 70) return '#f59e0b';
    return '#ef4444';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1d807c" />
        <Text style={styles.loadingText}>Loading Drive Mode...</Text>
      </View>
    );
  }

  const name = getUserName();
  const profileImage = getProfileImage();

  return (
    <View style={styles.mainContainer}>
      {(emergencyActive || globalEmergencyState.isActive) && (
        <View style={styles.topEmergencyAlert}>
          <Animated.View style={[styles.emergencyPulse, { transform: [{ scale: emergencyPulseAnim }] }]}>
            <Ionicons name="alert-circle" size={20} color="#fff" />
          </Animated.View>
          <View style={styles.topAlertContent}>
            <Text style={styles.topAlertTitle}>🚨 EMERGENCY DETECTED</Text>
            <Text style={styles.topAlertMessage} numberOfLines={1}>
              {emergencyType?.message || globalEmergencyState.emergencyType?.message || "Emergency alert"}
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.topAlertCancelButton}
            onPress={handleCancelEmergency}
          >
            <Text style={styles.topAlertCancelText}>
              Cancel ({emergencyCountdown || globalEmergencyState.countdown}s)
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.headerWrapper, { marginTop: emergencyActive ? 44 : 0 }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Drive Mode</Text>
          </View>

          <View style={styles.profileWrapper}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.profileImage} />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Ionicons name="person" size={20} color="#1d807c" />
              </View>
            )}
            <Text style={styles.profileName} numberOfLines={1}>
              {name}
            </Text>
          </View>
        </View>
        <View style={styles.curve} />
      </View>

      {currentAlert && (
        <Animated.View 
          style={[
            styles.alertBanner,
            { 
              backgroundColor: currentAlert.severity === 'high' ? '#fef2f2' : '#fffbeb',
              opacity: alertAnim,
              transform: [{ translateY: alertAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-50, 0]
              })}]
            }
          ]}
        >
          <Ionicons 
            name={currentAlert.type === 'speeding' ? 'speedometer' : 
                  currentAlert.type === 'harsh_braking' ? 'warning' : 'alert-circle'} 
            size={22} 
            color={currentAlert.severity === 'high' ? '#ef4444' : '#f59e0b'} 
          />
          <Text style={[
            styles.alertText,
            { color: currentAlert.severity === 'high' ? '#dc2626' : '#d97706' }
          ]}>
            {currentAlert.message}
          </Text>
        </Animated.View>
      )}

      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
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

        <View style={styles.activityMonitorContainer}>
          <SimpleActivityMonitor 
            onActivityUpdate={handleActivityUpdate}
            autoStart={true}
            isEnabled={isActivityMonitoring}
          />
        </View>

        <View style={styles.sectionTitleContainer}>
          <Ionicons name="speedometer" size={20} color="#1d807c" />
          <Text style={styles.sectionTitle}>Live Sensor Data</Text>
        </View>

        <View style={styles.row}>
          <View style={[styles.box, styles.speedBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>GPS Speed</Text>
              <Text style={[
                styles.boxValue, 
                { color: getSpeedColor(currentSpeed) }
              ]}>
                {currentSpeed.toFixed(1)} km/h
              </Text>
              <Text style={styles.boxSubtext}>
                Live GPS data
              </Text>
            </View>
            <FontAwesome5 name="tachometer-alt" size={22} color={getSpeedColor(currentSpeed)} />
          </View>

          <View style={[styles.box, styles.gforceBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>G-Force</Text>
              <Text style={[
                styles.boxValue, 
                { color: gForce > 3.5 ? '#ef4444' : '#10b981' }
              ]}>
                {gForce.toFixed(2)} g
              </Text>
              <Text style={styles.boxSubtext}>
                {gForce > 3.5 ? 'Hard braking!' : 'Normal'}
              </Text>
            </View>
            <Ionicons 
              name={gForce > 3.5 ? "warning" : "speedometer"} 
              size={24} 
              color={gForce > 3.5 ? '#ef4444' : '#10b981'} 
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.box, styles.phoneBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Phone Usage</Text>
              <Text style={[
                styles.boxValue, 
                { color: phoneUsage < 30 ? '#10b981' : phoneUsage < 60 ? '#f59e0b' : '#ef4444' }
              ]}>
                {phoneUsage.toFixed(0)}%
              </Text>
              <Text style={styles.boxSubtext}>
                {phoneUsage > 50 ? 'High usage!' : 'Normal'}
              </Text>
            </View>
            <Ionicons name="phone-portrait" size={24} color={phoneUsage < 30 ? '#10b981' : phoneUsage < 60 ? '#f59e0b' : '#ef4444'} />
          </View>

          <View style={[styles.box, styles.distractionBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Distraction</Text>
              <Text style={[
                styles.boxValue, 
                { color: distractionLevel < 30 ? '#10b981' : distractionLevel < 60 ? '#f59e0b' : '#ef4444' }
              ]}>
                {distractionLevel.toFixed(0)}%
              </Text>
              <Text style={styles.boxSubtext}>
                {distractionLevel > 60 ? 'Stay focused!' : 'Good'}
              </Text>
            </View>
            <Ionicons name="eye" size={24} color={distractionLevel < 30 ? '#10b981' : distractionLevel < 60 ? '#f59e0b' : '#ef4444'} />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.box, styles.soundBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Sound Level</Text>
              <Text style={[
                styles.boxValue, 
                { color: soundLevel > 85 ? '#ef4444' : '#1d807c' }
              ]}>
                {soundLevel.toFixed(0)} dB
              </Text>
              <Text style={styles.boxSubtext}>
                {soundLevel > 85 ? 'Loud noise!' : 'Normal'}
              </Text>
            </View>
            <Ionicons name="mic" size={24} color={soundLevel > 85 ? '#ef4444' : '#1d807c'} />
          </View>

          <View style={[styles.box, styles.accelBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Acceleration</Text>
              <Text style={[
                styles.boxValue, 
                { color: Math.abs(acceleration) > 2 ? '#f59e0b' : '#10b981' }
              ]}>
                {acceleration.toFixed(2)} m/s²
              </Text>
              <Text style={styles.boxSubtext}>
                {Math.abs(acceleration) > 2 ? 'Rapid change' : 'Smooth'}
              </Text>
            </View>
            <Ionicons 
              name={acceleration > 0 ? "trending-up" : "trending-down"} 
              size={24} 
              color={Math.abs(acceleration) > 2 ? '#f59e0b' : '#10b981'} 
            />
          </View>
        </View>

        <View style={styles.sectionTitleContainer}>
          <Ionicons name="stats-chart" size={20} color="#1d807c" />
          <Text style={styles.sectionTitle}>Driving Statistics</Text>
        </View>

        <View style={[styles.fullBox, styles.statsSummaryBox]}>
          <View style={styles.statsHeader}>
            <View style={styles.mainStat}>
              <Text style={styles.mainStatValue}>{drivingStats.totalTrips}</Text>
              <Text style={styles.mainStatLabel}>Total Trips</Text>
            </View>
            <View style={styles.scoresContainer}>
              <View style={styles.scoreItem}>
                <Text style={[styles.scoreValue, { color: getSafetyColor(drivingStats.avgSafetyScore) }]}>
                  {drivingStats.avgSafetyScore}
                </Text>
                <Text style={styles.scoreLabel}>Safety</Text>
              </View>
              <View style={styles.scoreDivider} />
              <View style={styles.scoreItem}>
                <Text style={[styles.scoreValue, { color: getSafetyColor(drivingStats.avgEcoScore) }]}>
                  {drivingStats.avgEcoScore}
                </Text>
                <Text style={styles.scoreLabel}>Eco</Text>
              </View>
            </View>
          </View>
          
          <View style={styles.statsDetails}>
            <View style={styles.statDetailItem}>
              <Ionicons name="analytics" size={16} color="#fff" />
              <Text style={styles.statDetailValue}>{drivingStats.totalDistance.toFixed(0)} km</Text>
              <Text style={styles.statDetailLabel}>Distance</Text>
            </View>
            
            <View style={styles.statDetailItem}>
              <Ionicons name="time" size={16} color="#fff" />
              <Text style={styles.statDetailValue}>{formatTime(drivingStats.totalDuration)}</Text>
              <Text style={styles.statDetailLabel}>Duration</Text>
            </View>
          </View>
        </View>

        {/* FOUR BOXES AT THE BOTTOM */}
        <View style={styles.fourBoxesContainer}>
          <View style={styles.boxRow}>
            <View style={styles.fourBox}>
              <View style={[styles.fourBoxIcon, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
                <Ionicons name="warning" size={24} color="#ef4444" />
              </View>
              <Text style={styles.fourBoxValue}>{drivingStats.harshBrakingEvents}</Text>
              <Text style={styles.fourBoxLabel}>Harsh Braking</Text>
            </View>
            
            <View style={styles.fourBox}>
              <View style={[styles.fourBoxIcon, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
                <Ionicons name="speedometer" size={24} color="#f59e0b" />
              </View>
              <Text style={styles.fourBoxValue}>{drivingStats.speedingEvents}</Text>
              <Text style={styles.fourBoxLabel}>Speeding</Text>
            </View>
          </View>

          <View style={styles.boxRow}>
            <View style={styles.fourBox}>
              <View style={[styles.fourBoxIcon, { backgroundColor: 'rgba(220, 38, 38, 0.1)' }]}>
                <Ionicons name="phone-portrait" size={24} color="#dc2626" />
              </View>
              <Text style={styles.fourBoxValue}>{drivingStats.phoneUsageEvents}</Text>
              <Text style={styles.fourBoxLabel}>Phone Usage</Text>
            </View>
            
            <View style={styles.fourBox}>
              <View style={[styles.fourBoxIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                <Ionicons name="rocket" size={24} color="#10b981" />
              </View>
              <Text style={styles.fourBoxValue}>{drivingStats.rapidAccelerationEvents}</Text>
              <Text style={styles.fourBoxLabel}>Rapid Accel</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity onPress={() => navigation.navigate("DriverDashboard")}>
            <Ionicons name="home" size={28} color="#fff" />
          </TouchableOpacity>
          
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

      <Modal
        animationType="fade"
        transparent={true}
        visible={showEmergencyModal}
        onRequestClose={() => setShowEmergencyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="warning" size={40} color="#e63946" />
              <Text style={styles.modalTitle}>Emergency Detected</Text>
            </View>
            <Text style={styles.modalText}>
              {emergencyType?.message || "Emergency triggered"}
            </Text>
            <View style={styles.countdownContainer}>
              <View style={styles.countdownCircle}>
                <Text style={styles.countdownText}>{emergencyCountdown}s</Text>
              </View>
              <Text style={styles.countdownLabel}>Time remaining to cancel</Text>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.safeButton]}
                onPress={handleCancelEmergency}
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
                {voiceConfidence > 0 && (
                  <Text style={styles.confidenceText}>
                    Confidence: {(voiceConfidence * 100).toFixed(0)}%
                  </Text>
                )}
              </View>
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
                <Text style={styles.example}>• "Go to dashboard" or "Show stats"</Text>
                <Text style={styles.example}>• "Start monitoring" or "Stop monitoring"</Text>
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
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#1d807c',
  },
  scrollContainer: { paddingBottom: 120 },
  headerWrapper: { position: 'relative', backgroundColor: '#1d807c' },
  headerContent: {
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  curve: {
    width: width,
    height: 30,
    backgroundColor: '#fff',
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    marginTop: -10,
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  subTitle: { fontSize: 14, color: '#fff', marginTop: 2 },
  profileWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '40%',
  },
  profileName: {
    color: '#fff',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 100,
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileImagePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Emergency Alert Styles
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
  emergencyPulse: {
    justifyContent: 'center',
    alignItems: 'center',
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
  
  alertBanner: {
    position: 'absolute',
    top: 120,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    zIndex: 1000,
  },
  alertText: {
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  activityMonitorContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1d807c',
    marginLeft: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  box: {
    flex: 1,
    marginHorizontal: 4,
    padding: 14,
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 70,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  speedBox: { backgroundColor: '#fef2f2' },
  gforceBox: { backgroundColor: '#f0f9ff' },
  phoneBox: { backgroundColor: '#fef3c7' },
  distractionBox: { backgroundColor: '#f3e8ff' },
  soundBox: { backgroundColor: '#fce7f3' },
  accelBox: { backgroundColor: '#dcfce7' },
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
  statsSummaryBox: {
    backgroundColor: '#1d807c',
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  mainStat: {
    alignItems: 'center',
  },
  mainStatValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
  },
  mainStatLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  scoresContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    padding: 12,
  },
  scoreItem: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  scoreLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  scoreDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 12,
  },
  statsDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 16,
  },
  statDetailItem: {
    alignItems: 'center',
  },
  statDetailValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
  },
  statDetailLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  
  // Four Boxes Container Styles
  fourBoxesContainer: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  boxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  fourBox: {
    width: '48%',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  fourBoxIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  fourBoxValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1d807c',
    marginBottom: 4,
  },
  fourBoxLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  
  textPart: { flex: 1, alignItems: 'flex-start' },
  boxTitle: {
    fontSize: 14,
    color: '#555',
    fontWeight: '600',
    marginBottom: 2,
  },
  boxValue: { fontSize: 15, fontWeight: 'bold', color: '#1d807c' },
  boxSubtext: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
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
  footerWrapper: {
    position: 'absolute',
    bottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  footerNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#1d807c',
    width: width * 0.92,
    borderRadius: 35,
    paddingVertical: 14,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    borderWidth: 5.0,
    borderColor: 'rgba(255,255,255,0.2)',
  },
});

const formatTime = (seconds) => {
  if (!seconds && seconds !== 0) return '0h 0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

export default DriveModeScreen;