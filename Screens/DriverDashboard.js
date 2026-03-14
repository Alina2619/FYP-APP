import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Image,
  ActivityIndicator,
  Switch,
  Alert,
  RefreshControl,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where,
  orderBy, 
  limit, 
  onSnapshot, 
  updateDoc,
  getDocs,
  addDoc
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useTrip } from '../contexts/TripContext';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';

// Activity Recognition Component
import SimpleActivityMonitor from '../src/components/SimpleActivityMonitor';

// Voice Command Integration
import voiceCommandService from '../src/voice/VoiceCommandService';

// Import emergency functions from the emergency dashboard
import { 
  subscribeToEmergency, 
  cancelGlobalEmergency,
  globalEmergencyState 
} from './Emergency'; // Adjust path as needed

const DriverDashboardScreen = ({ navigation }) => {
  const [userData, setUserData] = useState(null);
  const [recentTrip, setRecentTrip] = useState(null);
  const [allTrips, setAllTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tripLoading, setTripLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // Emergency states from global emergency
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState(null);
  const [emergencyCountdown, setEmergencyCountdown] = useState(10);
  
  // Activity Recognition States
  const [currentActivity, setCurrentActivity] = useState('Initializing...');
  const [activityConfidence, setActivityConfidence] = useState(0);
  const [isActivityMonitoring, setIsActivityMonitoring] = useState(true);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  
  // Voice Command States
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [voiceCommandResult, setVoiceCommandResult] = useState(null);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceCommandHistory, setVoiceCommandHistory] = useState([]);
  const [isVoiceModelLoaded, setIsVoiceModelLoaded] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [voiceConfidence, setVoiceConfidence] = useState(0);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [voiceServiceStatus, setVoiceServiceStatus] = useState('initializing');
  
  // Use refs to track state without re-renders
  const voiceAlertCountRef = useRef(0);
  const lastActivityRef = useRef('');
  const isVoiceAlertActiveRef = useRef(false);
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimerRef = useRef(null);
  const pulseAnimationRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const micButtonRef = useRef(null);
  const isHoldingMicRef = useRef(false);
  
  const { recentTrip: contextRecentTrip, isLogging, startTrip, stopTrip } = useTrip();

  // ✅ Listen to global emergency events
  useEffect(() => {
    const unsubscribe = subscribeToEmergency((event) => {
      switch (event.type) {
        case 'EMERGENCY_TRIGGERED':
          setEmergencyActive(true);
          setEmergencyType(event.emergency);
          setEmergencyCountdown(event.countdown);
          
          // Voice alert for emergency
          if (isVoiceEnabled) {
            speakQuickAlert(`Emergency detected: ${event.emergency.message}. You have ${event.countdown} seconds to cancel.`);
          }
          break;
          
        case 'COUNTDOWN_UPDATE':
          setEmergencyCountdown(event.countdown);
          break;
          
        case 'EMERGENCY_EXPIRED':
          setEmergencyActive(false);
          if (isVoiceEnabled) {
            speakQuickAlert("Emergency has been logged to authorities.");
          }
          break;
          
        case 'EMERGENCY_CANCELLED':
          setEmergencyActive(false);
          setEmergencyType(null);
          if (isVoiceEnabled) {
            speakQuickAlert("Emergency cancelled. We're glad you're safe!");
          }
          break;
      }
    });
    
    return unsubscribe;
  }, [isVoiceEnabled]);

  // ✅ Handle emergency cancellation from dashboard
  const handleCancelEmergency = async () => {
    try {
      cancelGlobalEmergency();
      
      // Also update user status in database
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          emergencyStatus: 'cancelled',
          updatedAt: new Date().toISOString()
        });
        
        // Log safe response
        await addDoc(collection(db, "emergency_logs"), {
          userId: user.uid,
          type: 'CANCELLED_FROM_DASHBOARD',
          message: 'User cancelled emergency from dashboard',
          userResponse: "safe",
          responseTime: new Date(),
          timestamp: new Date().toISOString(),
        });
      }
      
      Alert.alert(
        "Emergency Cancelled",
        "The emergency has been cancelled successfully.",
        [{ text: "OK" }]
      );
      
    } catch (error) {
      console.error("Error cancelling emergency:", error);
      Alert.alert("Error", "Failed to cancel emergency. Please try again.");
    }
  };

  // Format time from seconds to readable format
  const formatTime = useCallback((seconds) => {
    if (!seconds && seconds !== 0) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  }, []);

  // Format date to readable format
  const formatDate = useCallback((timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      let date;
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      } else if (timestamp instanceof Date) {
        date = timestamp;
      } else {
        date = new Date(timestamp);
      }
      return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch (error) {
      console.error('Error converting timestamp:', error);
      return 'Invalid Date';
    }
  }, []);

  // Format time to readable format
  const formatTimeOnly = useCallback((timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      let date;
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      } else if (timestamp instanceof Date) {
        date = timestamp;
      } else {
        date = new Date(timestamp);
      }
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    } catch (error) {
      console.error('Error converting timestamp:', error);
      return 'Invalid Time';
    }
  }, []);

  // Safely get trip duration
  const getTripDuration = useCallback((trip) => {
    if (!trip) return 0;
    
    // If duration is already calculated, use it
    if (trip.duration !== undefined && trip.duration !== null) return trip.duration;
    
    // Calculate duration from start and end times
    if (trip.startTime && trip.endTime) {
      try {
        const start = trip.startTime.toDate ? trip.startTime.toDate() : new Date(trip.startTime);
        const end = trip.endTime.toDate ? trip.endTime.toDate() : new Date(trip.endTime);
        return Math.round((end - start) / 1000); // Convert to seconds
      } catch (error) {
        console.error('Error calculating duration:', error);
        return 0;
      }
    }
    
    return 0;
  }, []);

  // Calculate safety score based on trip data (out of 5)
  const calculateSafetyScore = useCallback((trips) => {
    if (!trips || trips.length === 0) return 0;
    
    let totalScore = 0;
    let validTrips = 0;
    
    trips.forEach(trip => {
      if (!trip.endTime) return; // Skip incomplete trips
      
      let tripScore = 5; // Start with perfect score
      
      // Deduct points for harsh braking (g-force > 0.3)
      if (trip.harshBrakingCount > 0) {
        tripScore -= Math.min(1, trip.harshBrakingCount * 0.2);
      }
      
      // Deduct points for rapid acceleration (g-force > 0.3)
      if (trip.rapidAccelerationCount > 0) {
        tripScore -= Math.min(1, trip.rapidAccelerationCount * 0.2);
      }
      
      // Deduct points for speeding (over speed limit)
      if (trip.speedingCount > 0) {
        tripScore -= Math.min(1.5, trip.speedingCount * 0.1);
      }
      
      // Deduct points for sharp turns (lateral g-force > 0.4)
      if (trip.sharpTurnCount > 0) {
        tripScore -= Math.min(0.5, trip.sharpTurnCount * 0.1);
      }
      
      // Deduct points for phone usage during driving
      if (trip.phoneUsageCount > 0) {
        tripScore -= Math.min(1, trip.phoneUsageCount * 0.5);
      }
      
      // Ensure score doesn't go below 0
      tripScore = Math.max(0, tripScore);
      
      totalScore += tripScore;
      validTrips++;
    });
    
    return validTrips > 0 ? parseFloat((totalScore / validTrips).toFixed(1)) : 0;
  }, []);

  // Calculate eco drive score based on trip data (out of 5)
  const calculateEcoDriveScore = useCallback((trips) => {
    if (!trips || trips.length === 0) return 0;
    
    let totalScore = 0;
    let validTrips = 0;
    
    trips.forEach(trip => {
      if (!trip.endTime || !trip.distance || trip.distance === 0) return; // Skip incomplete or zero distance trips
      
      let tripScore = 5; // Start with perfect score
      
      // Calculate fuel efficiency (lower is better)
      const fuelEfficiency = trip.fuelConsumed ? trip.fuelConsumed / trip.distance : 0;
      
      // Deduct points for poor fuel efficiency (assuming 10L/100km is average)
      if (fuelEfficiency > 0) {
        const efficiencyScore = Math.max(0, 5 - (fuelEfficiency * 10)); // Scale to 0-5
        tripScore = Math.min(tripScore, efficiencyScore);
      }
      
      // Deduct points for excessive idling (more than 5% of trip time)
      const tripDuration = getTripDuration(trip);
      const idlePercentage = trip.idleTime && tripDuration > 0 ? trip.idleTime / tripDuration : 0;
      if (idlePercentage > 0.05) {
        tripScore -= Math.min(1, (idlePercentage - 0.05) * 10);
      }
      
      // Deduct points for aggressive driving behaviors that waste fuel
      if (trip.rapidAccelerationCount > 0) {
        tripScore -= Math.min(1, trip.rapidAccelerationCount * 0.1);
      }
      
      if (trip.harshBrakingCount > 0) {
        tripScore -= Math.min(1, trip.harshBrakingCount * 0.1);
      }
      
      // Ensure score doesn't go below 0
      tripScore = Math.max(0, tripScore);
      
      totalScore += tripScore;
      validTrips++;
    });
    
    return validTrips > 0 ? parseFloat((totalScore / validTrips).toFixed(1)) : 0;
  }, [getTripDuration]);

  // Initialize voice assistant
  const initializeVoiceAssistant = useCallback(async () => {
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
  }, []);

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

  // Quick voice alert function
  const speakQuickAlert = useCallback((message) => {
    if (!isVoiceEnabled) return;
    
    isVoiceAlertActiveRef.current = true;
    
    Speech.stop();
    
    Speech.speak(message, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.9,
      onDone: () => {
        isVoiceAlertActiveRef.current = false;
      },
      onStopped: () => {
        isVoiceAlertActiveRef.current = false;
      },
      onError: () => {
        isVoiceAlertActiveRef.current = false;
      },
    });
    
    setTimeout(() => {
      if (isVoiceAlertActiveRef.current) {
        Speech.stop();
        isVoiceAlertActiveRef.current = false;
      }
    }, 3000);
  }, [isVoiceEnabled]);

  // Voice navigation feedback
  const speakNavigationFeedback = useCallback((screenName) => {
    if (!isVoiceEnabled) return;
    
    const messages = {
      'TripLogger': 'Navigating to Trip Logger',
      'DriveMateDashboard': 'Navigating to Emergency Dashboard',
      'DriverSettings': 'Navigating to Settings',
      'DriverDashboard': 'Navigating to Dashboard',
      'Analytics': 'Navigating to Analytics',
      'ShareLocation': 'Navigating to Share Location',
      'Emergency': 'Navigating to Emergency'
    };
    
    speakQuickAlert(messages[screenName] || `Navigating to ${screenName}`);
  }, [isVoiceEnabled, speakQuickAlert]);

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

  // Handle voice command execution
  const executeVoiceCommand = useCallback(async (command, confidence, transcription = '', source = 'assemblyai') => {
    if (!command) return false;
    
    const commandLower = command.toLowerCase();
    let response = '';
    let action = null;
    let success = false;
    
    switch (commandLower) {
      case 'start trip':
      case 'begin trip':
      case 'start driving':
      case 'begin driving':
      case 'start journey':
      case 'let\'s drive':
        if (isLogging) {
          response = 'Trip is already in progress.';
          success = false;
        } else {
          response = 'Starting new trip. Drive safely!';
          action = async () => {
            try {
              await startTrip();
              if (navigation) {
                navigation.navigate('TripLogger');
                speakQuickAlert('Trip started successfully. Navigating to Trip Logger.');
              }
            } catch (error) {
              console.error('Error starting trip:', error);
              speakQuickAlert('Failed to start trip. Please try manually.');
            }
          };
          success = true;
        }
        break;
        
      case 'stop trip':
      case 'end trip':
      case 'stop driving':
      case 'end journey':
      case 'finish trip':
        if (!isLogging) {
          response = 'No trip is currently in progress.';
          success = false;
        } else {
          response = 'Stopping current trip.';
          action = async () => {
            try {
              await stopTrip();
              speakQuickAlert('Trip stopped successfully.');
            } catch (error) {
              console.error('Error stopping trip:', error);
              speakQuickAlert('Failed to stop trip. Please try manually.');
            }
          };
          success = true;
        }
        break;
        
      case 'share location':
      case 'share my location':
      case 'send location':
        response = 'Sharing your current location with family.';
        action = () => {
          if (navigation) {
            speakNavigationFeedback('ShareLocation');
            setTimeout(() => {
              try {
                navigation.navigate('ShareLocation');
              } catch (error) {
                Alert.alert(
                  'Share Location',
                  'This feature is coming soon!',
                  [{ text: 'OK' }]
                );
              }
            }, 800);
          }
        };
        success = true;
        break;
        
      case 'call emergency':
      case 'emergency':
      case 'help':
      case '911':
      case 'call for help':
      case 'emergency contact':
        response = 'Emergency triggered. Navigating to emergency dashboard.';
        action = () => {
          if (navigation) {
            speakNavigationFeedback('Emergency');
            setTimeout(() => {
              try {
                navigation.navigate('Emergency', { 
                  triggerEmergency: true,
                  voiceCommand: command 
                });
              } catch (error) {
                Alert.alert(
                  'EMERGENCY',
                  'Emergency contact has been notified!',
                  [{ text: 'OK' }]
                );
              }
            }, 500);
          }
        };
        success = true;
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
        
      case 'go to analytics':
      case 'open analytics':
      case 'analytics':
        response = 'Navigating to Analytics.';
        action = () => {
          if (navigation) {
            speakNavigationFeedback('Analytics');
            setTimeout(() => {
              navigation.navigate('Analytics');
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
        
      default:
        response = `Command "${command}" not recognized. Try: start trip, stop trip, emergency, or dashboard.`;
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
      }, success && commandLower.includes('emergency') ? 500 : 800);
    } else if (!success && isVoiceEnabled) {
      speakQuickAlert(response);
    }
    
    return { success, response };
  }, [navigation, isVoiceEnabled, speakQuickAlert, isLogging, startTrip, stopTrip, speakNavigationFeedback]);

  // Process voice command
  const processVoiceCommand = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    
    try {
      // Clear timers
      cleanupTimers();
      
      setIsVoiceListening(false);
      setIsProcessingVoice(true);
      setVoiceTranscription('Processing...');
      
      // Stop recording and transcribe
      const result = await voiceCommandService.stopRecordingAndTranscribe();
      
      setVoiceCommandResult(result);
      
      if (result.transcription) {
        setVoiceTranscription(result.transcription);
      }
      
      if (result.confidence) {
        setVoiceConfidence(result.confidence);
      }
      
      if (result.success && result.command) {
        // Execute the command
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
      
      // Wait a moment to show results, then close modal
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
  }, [executeVoiceCommand, stopPulseAnimation]);

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

  // Start voice recording (for press and hold)
  const startVoiceRecording = useCallback(async () => {
    if (isVoiceListening || isProcessingVoice || !isVoiceModelLoaded || isProcessingRef.current || isHoldingMicRef.current) {
      return;
    }
    
    isHoldingMicRef.current = true;
    
    try {
      // Start recording
      setIsVoiceListening(true);
      setShowVoiceModal(true);
      setRecordingTime(0);
      setVoiceTranscription('');
      setVoiceConfidence(0);
      startPulseAnimation();
      
      // Start recording timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 10) { // Max 10 seconds
            stopVoiceRecording();
            return 10;
          }
          return prev + 1;
        });
      }, 1000);
      
      // Start recording with VoiceCommandService
      const startResult = await voiceCommandService.startRecording();
      
      if (!startResult.success) {
        throw new Error(startResult.error || 'Failed to start recording');
      }
      
      // Set timeout to auto-stop after 8 seconds (longer for hold)
      recordingTimeoutRef.current = setTimeout(() => {
        stopVoiceRecording();
      }, 8000);
      
    } catch (error) {
      console.error('Error starting voice recording:', error);
      
      // Clean up on error
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

  // Handle activity update from SimpleActivityMonitor
  const handleActivityUpdate = useCallback((activity) => {
    if (!activity || !activity.activity) return;
    
    const newActivity = activity.activity;
    const newConfidence = activity.confidence || 0;
    const prevActivity = lastActivityRef.current;
    
    // Update state
    setCurrentActivity(newActivity);
    setActivityConfidence(newConfidence);
    
    // Only trigger voice alerts on significant activity changes
    if (isVoiceEnabled && newConfidence > 0.7) {
      const isNewDriving = newActivity.toLowerCase().includes('driving');
      const wasDriving = prevActivity.toLowerCase().includes('driving');
      const isNewWalking = newActivity.toLowerCase().includes('walking');
      const wasWalking = prevActivity.toLowerCase().includes('walking');
      
      // Reset counter if activity type changes
      if ((isNewDriving && !wasDriving) || (isNewWalking && !wasWalking)) {
        voiceAlertCountRef.current = 0;
      }
      
      // Only speak for the first 2 times when activity is detected
      if (voiceAlertCountRef.current < 2) {
        if (isNewDriving && !wasDriving) {
          speakQuickAlert("Driving Detected Stay Safe");
          voiceAlertCountRef.current++;
        } else if (isNewWalking && !wasWalking && !wasDriving) {
          speakQuickAlert("Walking detected Stay Aware of your surroundings");
          voiceAlertCountRef.current++;
        }
      }
    }
    
    // Update refs
    lastActivityRef.current = newActivity;
  }, [isVoiceEnabled, speakQuickAlert]);

  // Fetch user data and set online status
  const fetchUserData = useCallback(async (user) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const data = userSnap.data();
        setUserData(data);
        
        // Auto-set online status to true when user logs in
        const shouldBeOnline = true;
        if (data.isOnline !== shouldBeOnline) {
          await updateDoc(userRef, {
            isOnline: shouldBeOnline,
            lastOnlineUpdate: new Date().toISOString()
          });
          setIsOnline(shouldBeOnline);
        } else {
          setIsOnline(data.isOnline || false);
        }
        
        // Set voice enabled from user settings
        setIsVoiceEnabled(data.driveModeSettings?.voiceEnabled ?? true);
        setIsActivityMonitoring(true);
      } else {
        setUserData(null);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      setUserData(null);
    }
  }, []);

  // Set user offline when logging out
  const setUserOffline = useCallback(async (userId) => {
    try {
      if (!userId) return;
      
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        isOnline: false,
        lastOnlineUpdate: new Date().toISOString()
      });
      setIsOnline(false);
    } catch (error) {
      console.error('Error setting user offline:', error);
    }
  }, []);

  // Fetch all trips for calculating scores
  const fetchAllTrips = useCallback(async (userId) => {
    try {
      const tripsRef = collection(db, 'trips');
      setTripLoading(true);
      
      try {
        const q = query(
          tripsRef,
          where('userId', '==', userId),
          where('endTime', '!=', null),
          orderBy('endTime', 'desc')
        );
        
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const trips = snapshot.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data(),
            duration: doc.data().duration || getTripDuration(doc.data())
          }));
          
          setAllTrips(trips);
          
          if (trips.length > 0) {
            setRecentTrip(trips[0]);
          } else {
            setRecentTrip(null);
          }
          return;
        } else {
          setAllTrips([]);
          setRecentTrip(null);
        }
      } catch (queryError) {
        console.log('Query with endTime failed:', queryError);
      }
      
      // Fallback: Get any trips by this user (ordered by startTime)
      try {
        const fallbackQuery = query(
          tripsRef,
          where('userId', '==', userId),
          orderBy('startTime', 'desc'),
          limit(50)
        );
        
        const fallbackSnapshot = await getDocs(fallbackQuery);
        
        if (!fallbackSnapshot.empty) {
          const trips = fallbackSnapshot.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data(),
            duration: doc.data().duration || getTripDuration(doc.data())
          }));
          
          setAllTrips(trips);
          
          const completedTrips = trips.filter(trip => trip.endTime);
          if (completedTrips.length > 0) {
            setRecentTrip(completedTrips[0]);
          } else if (trips.length > 0) {
            setRecentTrip(trips[0]);
          } else {
            setRecentTrip(null);
          }
        } else {
          setRecentTrip(null);
          setAllTrips([]);
        }
      } catch (fallbackError) {
        console.log('Fallback query also failed:', fallbackError);
        setRecentTrip(null);
        setAllTrips([]);
      }
    } catch (error) {
      console.error('Error fetching trips:', error);
      setRecentTrip(null);
      setAllTrips([]);
    } finally {
      setTripLoading(false);
      setRefreshing(false);
    }
  }, [getTripDuration]);

  // Refresh data
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const auth = getAuth();
    const user = auth.currentUser;
    
    if (user) {
      await fetchUserData(user);
      await fetchAllTrips(user.uid);
    } else {
      setRefreshing(false);
    }
  }, [fetchUserData, fetchAllTrips]);

  // Toggle AI voice on/off
  const toggleVoiceEnabled = async () => {
    const newValue = !isVoiceEnabled;
    setIsVoiceEnabled(newValue);
    
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          'driveModeSettings.voiceEnabled': newValue,
          updatedAt: new Date().toISOString()
        });
        
        if (newValue) {
          speakQuickAlert('Voice assistance enabled');
        } else {
          Speech.stop();
        }
      }
    } catch (error) {
      console.error('Error updating voice settings:', error);
      Alert.alert('Error', 'Failed to update voice settings');
    }
  };

  // Handle navigation with voice feedback
  const handleNavigation = useCallback((screenName) => {
    if (isVoiceEnabled) {
      speakNavigationFeedback(screenName);
    }
    
    setTimeout(() => {
      navigation.navigate(screenName);
    }, 800);
  }, [navigation, isVoiceEnabled, speakNavigationFeedback]);

  // Initialize on component mount
  useEffect(() => {
    initializeVoiceAssistant();
    initializeVoiceCommandService();
    
    const auth = getAuth();
    let userUnsubscribe = null;
    let tripsUnsubscribe = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (userData) {
          await setUserOffline(userData.uid);
        }
        setUserData(null);
        setRecentTrip(null);
        setAllTrips([]);
        setLoading(false);
        setTripLoading(false);
        setIsActivityMonitoring(false);
        if (userUnsubscribe) userUnsubscribe();
        if (tripsUnsubscribe) tripsUnsubscribe();
        return;
      }

      try {
        await fetchUserData(user);
        setLoading(false);
        
        const userRef = doc(db, 'users', user.uid);
        userUnsubscribe = onSnapshot(userRef, (doc) => {
          if (doc.exists()) {
            const data = doc.data();
            setUserData(data);
            setIsOnline(data.isOnline || false);
            // Update voice setting from database
            if (data.driveModeSettings?.voiceEnabled !== undefined) {
              setIsVoiceEnabled(data.driveModeSettings.voiceEnabled);
            }
          }
        });

        await fetchAllTrips(user.uid);

        const tripsRef = collection(db, 'trips');
        const tripsQuery = query(
          tripsRef,
          where('userId', '==', user.uid),
          orderBy('startTime', 'desc'),
          limit(10)
        );

        tripsUnsubscribe = onSnapshot(tripsQuery, (snapshot) => {
          if (!snapshot.empty) {
            const trips = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data(),
              duration: doc.data().duration || getTripDuration(doc.data())
            }));
            setAllTrips(trips);
            
            const completedTrips = trips.filter(trip => trip.endTime);
            if (completedTrips.length > 0) {
              setRecentTrip(completedTrips[0]);
            } else if (trips.length > 0) {
              setRecentTrip(trips[0]);
            } else {
              setRecentTrip(null);
            }
          } else {
            setAllTrips([]);
            setRecentTrip(null);
          }
        }, (error) => {
          console.error('Error in trips real-time listener:', error);
        });

      } catch (e) {
        console.error('Error initializing dashboard:', e);
        setLoading(false);
        setTripLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (userUnsubscribe) userUnsubscribe();
      if (tripsUnsubscribe) tripsUnsubscribe();
      Speech.stop();
      voiceCommandService.cleanup();
      
      cleanupTimers();
      stopPulseAnimation();
    };
  }, [
    initializeVoiceAssistant, 
    fetchUserData, 
    fetchAllTrips, 
    getTripDuration, 
    setUserOffline, 
    initializeVoiceCommandService, 
    cleanupTimers,
    stopPulseAnimation
  ]);

  // Also check context for recent trip if no trip from database
  useEffect(() => {
    if (!recentTrip && contextRecentTrip && !tripLoading) {
      setRecentTrip({
        id: 'context-trip',
        ...contextRecentTrip,
        startTime: new Date(),
      });
    }
  }, [recentTrip, contextRecentTrip, tripLoading]);

  // Toggle online status manually
  const toggleOnlineStatus = async () => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) return;

      const userRef = doc(db, 'users', user.uid);
      const newStatus = !isOnline;
      
      await updateDoc(userRef, {
        isOnline: newStatus,
        lastOnlineUpdate: new Date().toISOString()
      });

      setIsOnline(newStatus);
      
      if (newStatus) {
        if (isVoiceEnabled) {
          speakQuickAlert("You're now online. Your family can see your location.");
        }
        Alert.alert(
          "You're Now Online",
          "Your family can now see your location and driving status.",
          [{ text: "OK" }]
        );
      } else {
        if (isVoiceEnabled) {
          speakQuickAlert("You're now offline. Your family cannot see your location.");
        }
        Alert.alert(
          "You're Now Offline",
          "Your family can no longer see your location.",
          [{ text: "OK" }]
        );
      }
    } catch (error) {
      console.error('Error updating online status:', error);
      Alert.alert('Error', 'Failed to update online status');
    }
  };

  // Get user name from all possible fields
  const getUserName = useCallback(() => {
    if (!userData) return 'Driver';
    return (
      userData.name ||
      userData.fullName ||
      userData.displayName ||
      `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
      'Driver'
    );
  }, [userData]);

  // Get profile image from all possible fields
  const getProfileImage = useCallback(() => {
    if (!userData) return null;
    return (
      userData.profileImage ||
      userData.photoURL ||
      userData.avatar ||
      userData.imageUrl ||
      (userData.driverProfile && userData.driverProfile.profileImage) ||
      null
    );
  }, [userData]);

  // Safely get trip distance
  const getTripDistance = useCallback((trip) => {
    return trip?.distance || 0;
  }, []);

  // Safely get average speed
  const getAvgSpeed = useCallback((trip) => {
    return trip?.avgSpeed || 0;
  }, []);

  // Safely get max speed
  const getMaxSpeed = useCallback((trip) => {
    return trip?.maxSpeed || 0;
  }, []);

  // Safely get start location
  const getStartLocation = useCallback((trip) => {
    if (!trip?.startLocation) return null;
    
    if (typeof trip.startLocation === 'string') {
      return trip.startLocation;
    }
    
    if (trip.startLocation.latitude && trip.startLocation.longitude) {
      return `${trip.startLocation.latitude.toFixed(6)}, ${trip.startLocation.longitude.toFixed(6)}`;
    }
    
    return 'Unknown location';
  }, []);

  // Safely get end location
  const getEndLocation = useCallback((trip) => {
    if (!trip?.endLocation) return null;
    
    if (typeof trip.endLocation === 'string') {
      return trip.endLocation;
    }
    
    if (trip.endLocation.latitude && trip.endLocation.longitude) {
      return `${trip.endLocation.latitude.toFixed(6)}, ${trip.endLocation.longitude.toFixed(6)}`;
    }
    
    return 'Unknown location';
  }, []);

  // Calculate scores based on all trips
  const safetyScore = calculateSafetyScore(allTrips);
  const ecoDrive = calculateEcoDriveScore(allTrips);
  
  // Calculate total distance from all trips
  const totalDistance = allTrips.reduce((total, trip) => {
    return total + (trip.distance || 0);
  }, 0);

  const name = getUserName();
  const profileImage = getProfileImage();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1d807c" />
        <Text style={styles.loadingText}>Loading Dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* ✅ EMERGENCY ALERT AT TOP (Visible on all screens when active) */}
      {(emergencyActive || globalEmergencyState.isActive) && (
        <View style={styles.topEmergencyAlert}>
          <Ionicons name="alert-circle" size={20} color="#fff" />
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

      {/* HEADER */}
      <View style={[styles.headerWrapper, { marginTop: emergencyActive ? 44 : 0 }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Driver Dashboard</Text>
          </View>

          {/* Profile Section */}
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

      {/* CONTENT */}
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Toggle Row - AI Voice & Online Status */}
        <View style={styles.toggleRow}>
          {/* AI Voice Toggle */}
          <View style={[styles.toggleBox, { backgroundColor: isVoiceEnabled ? '#e8f4fd' : '#f5f5f5' }]}>
            <View style={styles.textPart}>
              <Text style={styles.toggleTitle}>AI Voice:</Text>
              <Text style={[styles.toggleStatus, { color: isVoiceEnabled ? '#1d807c' : '#666' }]}>
                {isVoiceEnabled ? 'ON' : 'OFF'}
              </Text>   
            </View>
            <Switch
              value={isVoiceEnabled}
              onValueChange={toggleVoiceEnabled}
              trackColor={{ false: '#ccc', true: '#1d807c' }}
              thumbColor={isVoiceEnabled ? '#1d807c' : '#f4f3f4'}
            />
          </View>

          {/* Online Status Toggle */}
          <View style={[styles.toggleBox, { backgroundColor: isOnline ? '#e8f5e9' : '#f5f5f5' }]}>
            <View style={styles.textPart}>
              <Text style={styles.toggleTitle}>Status:</Text>
              <Text style={[styles.toggleStatus, { color: isOnline ? '#1d807c' : '#666' }]}>
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </Text>
            </View>
            <Switch
              value={isOnline}
              onValueChange={toggleOnlineStatus}
              trackColor={{ false: '#ccc', true: '#1d807c' }}
              thumbColor={isOnline ? '#1d807c' : '#f4f3f4'}
            />
          </View>
        </View>

        {/* SimpleActivityMonitor Component - Auto-starts */}
        <View style={styles.activityMonitorWrapper}>
          <SimpleActivityMonitor 
            onActivityUpdate={handleActivityUpdate}
            autoStart={true}
            isEnabled={isActivityMonitoring}
            showMinimal={true}
          />
        </View>

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

        {/* Row 1 (Stats calculated from trips) */}
        <View style={styles.row}>
          <View style={[styles.box, { backgroundColor: '#f0f7f6' }]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>KM Driven</Text>
              <Text style={styles.boxValue}>
                {totalDistance > 0 ? `${totalDistance.toFixed(2)} km` : '0.00 km'}
              </Text>
              <Text style={styles.boxSubtext}>
                {allTrips.length} trips
              </Text>
            </View>
            <Ionicons name="speedometer" size={24} color="#1d807c" />
          </View>

          <View style={[styles.box, { backgroundColor: '#e8f4f2' }]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Safety Score</Text>
              <Text style={styles.boxValue}>
                {safetyScore > 0 ? `${safetyScore}/5` : 'N/A'}
              </Text>
              <Text style={styles.boxSubtext}>
                Based on {allTrips.filter(t => t.endTime).length} trips
              </Text>
            </View>
            <Ionicons name="shield-checkmark" size={24} color="#1d807c" />
          </View>

          <View style={[styles.box, { backgroundColor: '#e0f0ed' }]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Eco Drive</Text>
              <Text style={styles.boxValue}>
                {ecoDrive > 0 ? `${ecoDrive}/5` : 'N/A'}
              </Text>
              <Text style={styles.boxSubtext}>
                Fuel efficiency
              </Text>
            </View>
            <Ionicons name="leaf" size={24} color="#1d807c" />
          </View>
        </View>

        {/* Full Boxes */}
        <TouchableOpacity
          style={[styles.fullBox, { backgroundColor: '#f0f7f6' }]}
          onPress={() => handleNavigation('TripLogger')}
        >
          <View style={styles.textPart}>
            <Text style={styles.boxTitle}>Trip Logger</Text>
            <Text style={styles.boxValue}>Start Logging</Text>
            <Text style={styles.boxSubtext}>
              {isLogging ? 'Trip in progress' : 'No active trip'}
            </Text>
          </View>
          <Ionicons name="car" size={24} color="#1d807c" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.fullBox, { backgroundColor: '#e8f4f2' }]}
          onPress={() => handleNavigation('Analytics')}
        >
          <View style={styles.textPart}>
            <Text style={styles.boxTitle}>Analytics</Text>
            <Text style={styles.boxValue}>View Stats</Text>
          </View>
          <Ionicons name="stats-chart" size={24} color="#1d807c" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.fullBox, { backgroundColor: '#e0f0ed' }]}
          onPress={() => handleNavigation('Emergency')}
        >
          <View style={styles.textPart}>
            <Text style={styles.boxTitle}>Emergency</Text>
            <Text style={styles.boxValue}>View Dashboard</Text>
          </View>
          <Ionicons name="alert-circle" size={24} color="#1d807c" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.fullBox, { backgroundColor: '#d8e9e5' }]}
          onPress={() => handleNavigation('DriveModeScreen')}
        >
          <View style={styles.textPart}>
            <Text style={styles.boxTitle}>Drive Mode</Text>
            <Text style={styles.boxValue}>{isOnline ? 'Enabled' : 'Disabled'}</Text>
          </View>
          <Ionicons name="navigate-circle" size={24} color="#1d807c" />
        </TouchableOpacity>

        {/* Recent Trip */}
        <View style={[styles.fullBox, styles.recentTripBox]}>
          <View style={styles.textPart}>
            <Text style={[styles.boxTitle, { marginBottom: 8 }]}>Recent Trip</Text>
            {tripLoading ? (
              <ActivityIndicator size="small" color="#1d807c" />
            ) : recentTrip ? (
              <View style={styles.tripDetails}>
                {/* Trip Date and Time */}
                <View style={styles.tripDetailRow}>
                  <Ionicons name="calendar" size={14} color="#1d807c" />
                  <Text style={styles.recentTripText}>
                    {formatDate(recentTrip.startTime)} at {formatTimeOnly(recentTrip.startTime)}
                  </Text>
                </View>

                {/* Duration */}
                <View style={styles.tripDetailRow}>
                  <Ionicons name="time" size={14} color="#1d807c" />
                  <Text style={styles.recentTripText}>
                    Duration: {formatTime(getTripDuration(recentTrip))}
                  </Text>
                </View>

                {/* Distance */}
                <View style={styles.tripDetailRow}>
                  <Ionicons name="map" size={14} color="#1d807c" />
                  <Text style={styles.recentTripText}>
                    Distance: {getTripDistance(recentTrip) ? `${getTripDistance(recentTrip).toFixed(2)} km` : 'N/A'}
                  </Text>
                </View>

                {/* Average Speed */}
                <View style={styles.tripDetailRow}>
                  <Ionicons name="speedometer" size={14} color="#1d807c" />
                  <Text style={styles.recentTripText}>
                    Avg Speed: {getAvgSpeed(recentTrip) ? `${getAvgSpeed(recentTrip).toFixed(1)} km/h` : 'N/A'}
                  </Text>
                </View>

                {/* Max Speed (if available) */}
                {getMaxSpeed(recentTrip) > 0 && (
                  <View style={styles.tripDetailRow}>
                    <Ionicons name="rocket" size={14} color="#1d807c" />
                    <Text style={styles.recentTripText}>
                      Max Speed: {getMaxSpeed(recentTrip).toFixed(1)} km/h
                    </Text>
                  </View>
                )}

                {/* Start Location */}
                {getStartLocation(recentTrip) && (
                  <View style={styles.tripDetailRow}>
                    <Ionicons name="location" size={14} color="#1d807c" />
                    <Text style={styles.recentTripText}>
                      Start: {getStartLocation(recentTrip)}
                    </Text>
                  </View>
                )}

                {/* End Location */}
                {getEndLocation(recentTrip) && (
                  <View style={styles.tripDetailRow}>
                    <Ionicons name="flag" size={14} color="#1d807c" />
                    <Text style={styles.recentTripText}>
                      End: {getEndLocation(recentTrip)}
                    </Text>
                  </View>
                )}

                {/* Trip ID (for reference) */}
                {recentTrip.id !== 'context-trip' && (
                  <View style={[styles.tripDetailRow, { marginTop: 8 }]}>
                    <Text style={[styles.recentTripText, { 
                      fontStyle: 'italic', 
                      fontSize: 10, 
                      color: '#888' 
                    }]}>
                      Trip ID: {recentTrip.id.substring(0, 8)}...
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <Text style={styles.recentTripText}>No recent trip recorded</Text>
            )}
          </View>
          <Ionicons name="map" size={26} color="#1d807c" />
        </View>
      </ScrollView>

      {/* FOOTER NAVIGATION */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity onPress={() => handleNavigation('DriverDashboard')}>
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
          
          <TouchableOpacity onPress={() => handleNavigation('DriverSettings')}>
            <Ionicons name="settings" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

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
                <Text style={styles.example}>• "Start trip" or "Begin driving"</Text>
                <Text style={styles.example}>• "Stop trip" or "End journey"</Text>
                <Text style={styles.example}>• "Emergency" or "Call emergency"</Text>
                <Text style={styles.example}>• "Go to dashboard" or "Open analytics"</Text>
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

const { width } = Dimensions.get('window');

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
    backgroundColor: "#d32f2f",
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
  
  // Activity Monitor Styles
  activityMonitorWrapper: {
    marginHorizontal: 18,
    marginBottom: 12,
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
    backgroundColor: '#d32f2f',
    transform: [{ scale: 1.1 }],
  },
  micButtonProcessing: {
    backgroundColor: '#1d807c',
  },
  micButtonDisabled: {
    backgroundColor: '#9CA3AF',
    opacity: 0.7,
  },
  
  // Voice History Styles
  voiceHistoryBox: {
    backgroundColor: '#f0f7f6',
    borderWidth: 1,
    borderColor: '#1d807c20',
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
    backgroundColor: '#f5f5f5',
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
    color: '#666',
    textAlign: 'center',
  },
  transcriptionContainer: {
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  transcriptionLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
    fontWeight: '600',
  },
  transcriptionText: {
    fontSize: 16,
    color: '#333',
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
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  commandExamples: {
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
  },
  examplesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  example: {
    fontSize: 12,
    color: '#666',
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
  
  // Box Styles
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
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
  },
  fullBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderRadius: 20,
    marginHorizontal: 18,
    marginBottom: 12,
    minHeight: 90,
  },
  textPart: { flex: 1, alignItems: 'flex-start' },
  iconLeft: { marginRight: 12 },
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
  recentTripBox: { backgroundColor: '#e8f4f2' },
  tripDetails: {
    width: '100%',
    maxHeight: 300,
  },
  tripDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
    flexWrap: 'wrap',
  },
  recentTripText: { 
    fontSize: 12,
    color: '#333', 
    marginLeft: 6,
    flexShrink: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 18,
    marginBottom: 12,
    gap: 10,
  },
  toggleBox: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    minHeight: 70,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  toggleStatus: {
    fontSize: 13,
    fontWeight: 'bold',
    textTransform: 'uppercase',
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
    backgroundColor: '#1d807c',
    width: width * 0.92,
    borderRadius: 35,
    paddingVertical: 14,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    borderWidth: 5.0,
    borderColor: '#1d807c20',
    alignItems: 'center',
  },
});

export default DriverDashboardScreen;