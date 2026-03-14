import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Alert,
  Image,
  ActivityIndicator,
  Linking,
  Platform,
  Modal,
  Animated,
  AppState,
} from "react-native";
import { Ionicons, FontAwesome5 } from "@expo/vector-icons";
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useTrip } from '../contexts/TripContext';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';

// ========== Voice Command Integration ==========
import voiceCommandService from '../src/voice/VoiceCommandService';

// ========== Import emergency functions ==========
import { 
  subscribeToEmergency, 
  cancelGlobalEmergency,
  globalEmergencyState 
} from './Emergency';

// ========== Audio for voice recording ==========
import { Audio } from 'expo-av';

// ========== WebView Map Component ==========
import WebViewMap from './components/WebViewMap';

const TripLogger = ({ navigation, route }) => {
  const {
    isLogging,
    timeElapsed,
    distance,
    avgSpeed,
    speedData,
    currentLocation,
    startTrip,
    stopTrip,
    impactDetected,
  } = useTrip();
  
  // State management
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [behavioralStats, setBehavioralStats] = useState(null);
  const [userId, setUserId] = useState(null);
  
  // ========== Emergency states ==========
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState(null);
  const [emergencyCountdown, setEmergencyCountdown] = useState(10);
  
  // ========== Voice Command States ==========
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [voiceConfidence, setVoiceConfidence] = useState(0);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isVoiceModelLoaded, setIsVoiceModelLoaded] = useState(false);
  
  // ========== Map states ==========
  const [mapReady, setMapReady] = useState(false);
  const [heading, setHeading] = useState(0);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  
  // Optimized location state
  const [locationState, setLocationState] = useState({
    current: null,
    smoothed: null,
    accuracy: "Unknown",
    lastUpdate: null,
    heading: 0,
    region: {
      latitude: 31.5204,
      longitude: 74.3587,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }
  });
  
  // Optimized route tracking
  const [routeCoordinates, setRouteCoordinates] = useState([]);

  // Refs for performance optimization
  const mapRef = useRef(null);
  const isMounted = useRef(true);
  const locationSubscription = useRef(null);
  const headingSubscription = useRef(null);
  const speechQueue = useRef([]);
  const isSpeaking = useRef(false);
  const autoRefreshTimer = useRef(null);
  const lastManualRefresh = useRef(Date.now());
  const appStateSubscription = useRef(null);
  const offlineTimeoutRef = useRef(null);
  const onlineStatusInterval = useRef(null);
  
  // ========== Voice Command Refs ==========
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimerRef = useRef(null);
  const pulseAnimationRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const isHoldingMicRef = useRef(false);
  
  // Buffers with size limits
  const speedBuffer = useRef([]);
  const locationBuffer = useRef([]);
  const headingBuffer = useRef([]);
  const MAX_BUFFER_SIZE = 15;
  const SPEED_BUFFER_SIZE = 8;

  // ========== ONLINE STATUS MANAGEMENT - CRITICAL FIX ==========
  const updateOnlineStatus = useCallback(async (status) => {
    const auth = getAuth();
    const user = auth.currentUser;
    
    if (!user) {
      console.log('No user logged in');
      return;
    }
    
    try {
      const userRef = doc(db, 'users', user.uid);
      
      // Update with ALL possible online status fields
      await updateDoc(userRef, {
        isOnline: status === 'online',
        status: status,
        lastSeen: serverTimestamp(),
        lastActive: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      console.log(`✅ Driver status updated to: ${status} for user: ${user.uid}`);
      
      // Also update local state
      setIsOnline(status === 'online');
      
    } catch (error) {
      console.error('❌ Error updating online status:', error);
    }
  }, []);

  // Initialize online status when component mounts
  useEffect(() => {
    const auth = getAuth();
    const user = auth.currentUser;
    
    if (user) {
      setUserId(user.uid);
      // Set online immediately when component mounts
      updateOnlineStatus('online');
      
      // Set up periodic heartbeat to keep online status alive (every 2 minutes)
      onlineStatusInterval.current = setInterval(() => {
        updateOnlineStatus('online');
        console.log('Heartbeat: keeping online status alive');
      }, 120000); // 2 minutes
    }
    
    return () => {
      if (onlineStatusInterval.current) {
        clearInterval(onlineStatusInterval.current);
      }
    };
  }, []);

  // Handle app state changes for online/offline status
  useEffect(() => {
    const auth = getAuth();
    const user = auth.currentUser;
    
    if (!user) return;

    // Listen for app state changes
    appStateSubscription.current = AppState.addEventListener('change', (nextAppState) => {
      console.log('App state changed to:', nextAppState);
      
      if (nextAppState === 'active') {
        // Clear any pending offline timeout
        if (offlineTimeoutRef.current) {
          clearTimeout(offlineTimeoutRef.current);
          offlineTimeoutRef.current = null;
        }
        // Set online when app comes to foreground
        updateOnlineStatus('online');
      } else if (nextAppState === 'background') {
        // Set offline after 10 seconds delay (to handle quick app switches)
        offlineTimeoutRef.current = setTimeout(() => {
          updateOnlineStatus('offline');
        }, 10000); // 10 seconds
      } else if (nextAppState === 'inactive') {
        // Handle inactive state
        if (offlineTimeoutRef.current) {
          clearTimeout(offlineTimeoutRef.current);
          offlineTimeoutRef.current = null;
        }
      }
    });

    // Set up beforeunload/cleanup for when component unmounts
    const handleBeforeUnload = () => {
      updateOnlineStatus('offline');
    };

    // Cleanup
    return () => {
      if (appStateSubscription.current) {
        appStateSubscription.current.remove();
      }
      if (offlineTimeoutRef.current) {
        clearTimeout(offlineTimeoutRef.current);
      }
      // Set offline when component unmounts
      handleBeforeUnload();
    };
  }, [updateOnlineStatus]);

  // ========== Listen to global emergency events ==========
  useEffect(() => {
    const unsubscribe = subscribeToEmergency((event) => {
      switch (event.type) {
        case 'EMERGENCY_TRIGGERED':
          setEmergencyActive(true);
          setEmergencyType(event.emergency);
          setEmergencyCountdown(event.countdown);
          
          if (isVoiceEnabled) {
            speakFeedback(`Emergency detected: ${event.emergency.message}. You have ${event.countdown} seconds to cancel.`);
          }
          break;
          
        case 'COUNTDOWN_UPDATE':
          setEmergencyCountdown(event.countdown);
          break;
          
        case 'EMERGENCY_EXPIRED':
          setEmergencyActive(false);
          if (isVoiceEnabled) {
            speakFeedback("Emergency has been logged to authorities.");
          }
          break;
          
        case 'EMERGENCY_CANCELLED':
          setEmergencyActive(false);
          setEmergencyType(null);
          if (isVoiceEnabled) {
            speakFeedback("Emergency cancelled. We're glad you're safe!");
          }
          break;
      }
    });
    
    return unsubscribe;
  }, [isVoiceEnabled]);

  // ========== App state monitoring for map ==========
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && locationPermission) {
        refreshMap();
        if (autoRefreshEnabled) {
          refreshLocation();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [locationPermission, autoRefreshEnabled]);

  // ========== Route coordinates limiting ==========
  useEffect(() => {
    const MAX_COORDINATES = 200;
    if (routeCoordinates.length > MAX_COORDINATES) {
      setRouteCoordinates(prev => prev.slice(-MAX_COORDINATES));
    }
  }, [routeCoordinates]);

  // ========== Auto-refresh timer setup ==========
  useEffect(() => {
    if (autoRefreshEnabled && locationPermission) {
      autoRefreshTimer.current = setInterval(() => {
        if (isMounted.current) {
          console.log('Auto-refreshing location...');
          refreshLocation();
        }
      }, 30000);
    }

    return () => {
      if (autoRefreshTimer.current) {
        clearInterval(autoRefreshTimer.current);
        autoRefreshTimer.current = null;
      }
    };
  }, [autoRefreshEnabled, locationPermission]);

  // ========== Handle emergency cancellation ==========
  const handleCancelEmergency = async () => {
    try {
      cancelGlobalEmergency();
      
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          emergencyStatus: 'cancelled',
          updatedAt: new Date().toISOString()
        });
        
        await addDoc(collection(db, "emergency_logs"), {
          userId: user.uid,
          type: 'CANCELLED_FROM_TRIP_LOGGER',
          message: 'User cancelled emergency from trip logger',
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

  // ========== Voice navigation feedback ==========
  const speakNavigationFeedback = useCallback((screenName) => {
    if (!isVoiceEnabled) return;
    
    const messages = {
      'TripLogger': 'You are already on Trip Logger',
      'DriveMateDashboard': 'Navigating to Emergency Dashboard',
      'DriverSettings': 'Navigating to Settings',
      'DriverDashboard': 'Navigating to Dashboard',
      'Analytics': 'Navigating to Analytics',
      'ShareLocation': 'Navigating to Share Location',
      'Emergency': 'Navigating to Emergency'
    };
    
    speakFeedback(messages[screenName] || `Navigating to ${screenName}`);
  }, [isVoiceEnabled]);

  // ========== Refresh map function ==========
  const refreshMap = () => {
    setMapReady(false);
    setTimeout(() => {
      setMapReady(true);
    }, 500);
  };

  // ========== Start pulse animation ==========
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

  // ========== Stop pulse animation ==========
  const stopPulseAnimation = useCallback(() => {
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    voicePulseAnim.setValue(1);
  }, [voicePulseAnim]);

  // ========== Initialize voice command service ==========
  const initializeVoiceCommandService = useCallback(async () => {
    try {
      const initialized = await voiceCommandService.initialize();
      setIsVoiceModelLoaded(initialized);
      return initialized;
    } catch (error) {
      console.error('Voice command service initialization failed:', error);
      setIsVoiceModelLoaded(false);
      return false;
    }
  }, []);

  // ========== Initialize voice assistant ==========
  const initializeVoiceAssistant = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status === 'granted') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          staysActiveInBackground: true,
          playThroughEarpieceAndroid: false,
        });
      }
    } catch (error) {
      console.log('Voice initialization:', error.message);
    }
  }, []);

  // Handle route parameters
  useEffect(() => {
    const autoStart = route.params?.autoStart;
    const autoStop = route.params?.autoStop;
    
    const handleVoiceCommands = async () => {
      if (autoStart && !isLogging && isOnline) {
        await handleStartTripFromVoice();
        navigation.setParams({ autoStart: false });
      }
      
      if (autoStop && isLogging) {
        await handleStopTripFromVoice();
        navigation.setParams({ autoStop: false });
      }
    };
    
    handleVoiceCommands();
  }, [route.params, isLogging, isOnline]);

  // ========== Handle voice command execution ==========
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
              if (!isOnline) {
                speakFeedback('Please go online first to start trip logging');
                Alert.alert("Offline Mode", "Please go online from the Driver Dashboard first");
                return;
              }
              
              if (!locationPermission) {
                speakFeedback('Location permission required');
                Alert.alert("Location Permission Required", "Please grant location permission");
                return;
              }
              
              await startTrip();
              speakFeedback('Trip started successfully');
            } catch (error) {
              console.error('Error starting trip:', error);
              speakFeedback('Failed to start trip. Please try manually.');
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
              speakFeedback('Trip stopped successfully');
              if (userData?.uid) {
                await calculateBehavioralStats(userData.uid);
              }
            } catch (error) {
              console.error('Error stopping trip:', error);
              speakFeedback('Failed to stop trip. Please try manually.');
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
            speakNavigationFeedback('DriveMateDashboard');
            setTimeout(() => {
              try {
                navigation.navigate('DriveMateDashboard', { 
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
      case 'main screen':
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
      case 'stats':
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
        
      case 'show map':
      case 'open map':
      case 'map view':
        response = 'You are already viewing the map.';
        success = true;
        break;
        
      case 'refresh location':
      case 'update location':
        response = 'Refreshing your current location.';
        action = () => {
          refreshLocation();
        };
        success = true;
        break;
        
      case 'open google maps':
      case 'navigate to maps':
      case 'show in maps':
        response = 'Opening Google Maps with your location.';
        action = () => {
          openGoogleMaps();
        };
        success = true;
        break;
        
      case 'enable auto refresh':
      case 'turn on auto refresh':
        response = 'Auto refresh enabled.';
        action = () => {
          setAutoRefreshEnabled(true);
          Alert.alert('Auto Refresh', 'Location auto-refresh has been enabled.');
        };
        success = true;
        break;
        
      case 'disable auto refresh':
      case 'turn off auto refresh':
        response = 'Auto refresh disabled.';
        action = () => {
          setAutoRefreshEnabled(false);
          Alert.alert('Auto Refresh', 'Location auto-refresh has been disabled.');
        };
        success = true;
        break;
        
      default:
        response = `Command "${command}" not recognized. Try: start trip, stop trip, emergency, or dashboard.`;
        success = false;
    }
    
    if (isVoiceEnabled && success) {
      speakFeedback(response);
    }
    
    if (action && success) {
      setTimeout(() => {
        try {
          action();
        } catch (error) {
          console.error('Action execution error:', error);
          if (isVoiceEnabled) {
            speakFeedback('Action could not be completed.');
          }
        }
      }, success && commandLower.includes('emergency') ? 500 : 800);
    } else if (!success && isVoiceEnabled) {
      speakFeedback(response);
    }
    
    return { success, response };
  }, [
    navigation, 
    isVoiceEnabled, 
    isLogging, 
    isOnline, 
    locationPermission, 
    startTrip, 
    stopTrip, 
    speakNavigationFeedback,
    userData
  ]);

  // ========== Process voice command ==========
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
  }, [executeVoiceCommand, stopPulseAnimation]);

  // ========== Cleanup timers ==========
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

  // ========== Start voice recording ==========
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

  // ========== Stop voice recording ==========
  const stopVoiceRecording = useCallback(async () => {
    if (!isVoiceListening || !isHoldingMicRef.current) return;
    
    isHoldingMicRef.current = false;
    await processVoiceCommand();
  }, [isVoiceListening, processVoiceCommand]);

  // ========== Cancel voice recording ==========
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

  // ========== Handle mic button press in and out ==========
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

  // ========== Handle navigation with voice feedback ==========
  const handleNavigation = useCallback((screenName) => {
    if (isVoiceEnabled) {
      speakNavigationFeedback(screenName);
    }
    
    setTimeout(() => {
      navigation.navigate(screenName);
    }, 800);
  }, [navigation, isVoiceEnabled, speakNavigationFeedback]);

  // Cleanup function
  useEffect(() => {
    isMounted.current = true;
    
    initializeVoiceAssistant();
    initializeVoiceCommandService();
    
    initLocation();
    initHeadingTracking();
    
    const bufferCleanupInterval = setInterval(() => {
      if (locationBuffer.current.length > MAX_BUFFER_SIZE * 2) {
        locationBuffer.current = locationBuffer.current.slice(-MAX_BUFFER_SIZE);
      }
      if (speedBuffer.current.length > SPEED_BUFFER_SIZE * 2) {
        speedBuffer.current = speedBuffer.current.slice(-SPEED_BUFFER_SIZE);
      }
      if (headingBuffer.current.length > 10) {
        headingBuffer.current = headingBuffer.current.slice(-10);
      }
    }, 30000);
    
    const speechInterval = setInterval(() => {
      if (!isSpeaking.current && speechQueue.current.length > 0) {
        const message = speechQueue.current.shift();
        speakFeedback(message);
      }
    }, 500);
    
    return () => {
      isMounted.current = false;
      clearInterval(bufferCleanupInterval);
      clearInterval(speechInterval);
      
      if (autoRefreshTimer.current) {
        clearInterval(autoRefreshTimer.current);
      }
      
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
      if (headingSubscription.current) {
        headingSubscription.current.remove();
      }
      
      Speech.stop();
      voiceCommandService.cleanup();
      cleanupTimers();
      stopPulseAnimation();
    };
  }, [initializeVoiceAssistant, initializeVoiceCommandService, cleanupTimers, stopPulseAnimation]);

  // ========== Initialize heading tracking ==========
  const initHeadingTracking = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      headingSubscription.current = await Location.watchHeadingAsync((headingData) => {
        if (isMounted.current) {
          const trueHeading = headingData.trueHeading || headingData.magHeading || 0;
          
          headingBuffer.current.push(trueHeading);
          if (headingBuffer.current.length > 5) {
            headingBuffer.current.shift();
          }
          
          let sumSin = 0;
          let sumCos = 0;
          headingBuffer.current.forEach(h => {
            sumSin += Math.sin(h * Math.PI / 180);
            sumCos += Math.cos(h * Math.PI / 180);
          });
          const smoothedHeading = Math.atan2(sumSin, sumCos) * 180 / Math.PI;
          const finalHeading = smoothedHeading < 0 ? smoothedHeading + 360 : smoothedHeading;
          
          setHeading(finalHeading);
          setLocationState(prev => ({
            ...prev,
            heading: finalHeading
          }));
        }
      });
    } catch (error) {
      console.log('Heading tracking error:', error);
    }
  };

  // Optimized location initialization
  const initLocation = async () => {
    if (!isMounted.current) return;
    
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        setLocationPermission(false);
        Alert.alert(
          "Permission Required", 
          "Location permission is needed for trip logging. Please enable location permissions."
        );
        return;
      }
      
      setLocationPermission(true);
      
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeout: 10000,
      });
      
      if (isMounted.current) {
        updateLocationData(location.coords, true);
      }
      
      const updateFrequency = isLogging ? 1000 : 3000;
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: isLogging ? Location.Accuracy.High : Location.Accuracy.Balanced,
          timeInterval: updateFrequency,
          distanceInterval: isLogging ? 5 : 20,
        },
        (newLocation) => {
          if (isMounted.current && newLocation.coords) {
            updateLocationData(newLocation.coords, false);
          }
        }
      );
      
    } catch (err) {
      console.warn('Location initialization error:', err);
    } finally {
      if (isMounted.current) {
        setLocationLoading(false);
      }
    }
  };

  // Optimized location data processing
  const updateLocationData = useCallback((coords, isInitial = false) => {
    if (!isMounted.current) return;
    
    const newLocation = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      speed: coords.speed,
      timestamp: Date.now()
    };
    
    locationBuffer.current.push(newLocation);
    
    if (locationBuffer.current.length > MAX_BUFFER_SIZE) {
      locationBuffer.current.shift();
    }
    
    const smoothedCoord = calculateSmoothedLocation(locationBuffer.current);
    
    if (coords.speed !== null && coords.speed > 0) {
      const speedKmh = coords.speed * 3.6;
      speedBuffer.current.push(speedKmh);
      if (speedBuffer.current.length > SPEED_BUFFER_SIZE) {
        speedBuffer.current.shift();
      }
    }
    
    const accuracyLevel = getAccuracyLevel(coords.accuracy);
    
    setLocationState(prev => ({
      ...prev,
      current: coords,
      smoothed: smoothedCoord,
      accuracy: accuracyLevel,
      lastUpdate: new Date(),
      heading: prev.heading,
      region: {
        ...prev.region,
        latitude: smoothedCoord.latitude,
        longitude: smoothedCoord.longitude,
        latitudeDelta: isLogging ? 0.005 : 0.01,
        longitudeDelta: isLogging ? 0.005 : 0.01,
      }
    }));
    
    if (isLogging) {
      setRouteCoordinates(prev => {
        if (prev.length === 0) {
          return [smoothedCoord];
        }
        
        const lastCoord = prev[prev.length - 1];
        const dist = calculateDistance(
          lastCoord.latitude, lastCoord.longitude,
          smoothedCoord.latitude, smoothedCoord.longitude
        );
        
        if (dist < 3) {
          return prev;
        }
        
        const newRoute = [...prev, smoothedCoord];
        return newRoute.length > 200 ? newRoute.slice(-200) : newRoute;
      });
    }
  }, [isLogging]);

  // Helper functions
  const calculateSmoothedLocation = (locations) => {
    if (locations.length === 0) return { latitude: 0, longitude: 0 };
    if (locations.length === 1) return locations[0];
    
    let totalLat = 0;
    let totalLng = 0;
    
    locations.forEach(location => {
      totalLat += location.latitude;
      totalLng += location.longitude;
    });
    
    return {
      latitude: totalLat / locations.length,
      longitude: totalLng / locations.length,
    };
  };

  const getAccuracyLevel = (accuracy) => {
    if (!accuracy || accuracy > 50) return "Low";
    if (accuracy > 20) return "Medium";
    if (accuracy > 10) return "Good";
    return "High";
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  };

  // Optimized speech feedback with queue
  const speakFeedback = useCallback((message) => {
    if (!isVoiceEnabled || !message) return;
    
    if (isSpeaking.current) {
      speechQueue.current.push(message);
      return;
    }
    
    isSpeaking.current = true;
    
    Speech.speak(message, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.9,
      onDone: () => {
        isSpeaking.current = false;
        Speech.stop();
      },
      onError: (error) => {
        console.log('Speech error:', error);
        isSpeaking.current = false;
        Speech.stop();
      }
    });
  }, [isVoiceEnabled]);

  const handleStartTripFromVoice = async () => {
    try {
      if (!isLogging && isOnline) {
        await startTrip();
        speakFeedback('Trip started successfully');
      } else if (isLogging) {
        speakFeedback('Trip is already in progress');
      } else if (!isOnline) {
        speakFeedback('Please go online first to start trip logging');
      }
    } catch (error) {
      console.error('Error starting trip from voice:', error);
      speakFeedback('Failed to start trip');
    }
  };

  const handleStopTripFromVoice = async () => {
    try {
      if (isLogging) {
        await stopTrip();
        speakFeedback('Trip stopped successfully');
        if (userData?.uid) {
          await calculateBehavioralStats(userData.uid);
        }
      } else {
        speakFeedback('No trip is currently in progress');
      }
    } catch (error) {
      console.error('Error stopping trip from voice:', error);
      speakFeedback('Failed to stop trip');
    }
  };

  // Optimized user data fetching
  useEffect(() => {
    const auth = getAuth();
    
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserData(null);
        setLoading(false);
        return;
      }

      setUserId(user.uid);

      try {
        const userRef = doc(db, 'users', user.uid);
        
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData({ ...data, uid: user.uid });
          setIsOnline(data.isOnline || false);
          setIsVoiceEnabled(data.driveModeSettings?.voiceEnabled ?? true);
          
          await calculateBehavioralStats(user.uid);
        }
        
        const unsubscribeOnline = onSnapshot(userRef, (doc) => {
          if (doc.exists() && isMounted.current) {
            const data = doc.data();
            const newOnlineStatus = data.isOnline || false;
            
            if (newOnlineStatus !== isOnline) {
              setIsOnline(newOnlineStatus);
              
              if (!newOnlineStatus && isLogging) {
                stopTrip();
                Alert.alert("Offline", "Trip logging stopped because you went offline");
              }
            }
          }
        });

        return () => unsubscribeOnline();
      } catch (e) {
        console.error('Error fetching user data:', e);
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Calculate behavioral stats
  const calculateBehavioralStats = useCallback(async (userId) => {
    if (!userId) return;

    try {
      const tripsRef = collection(db, 'trips');
      const q = query(
        tripsRef, 
        where('userId', '==', userId),
        where('status', '==', 'completed'),
        orderBy('endTime', 'desc'),
        limit(3)
      );
      
      const querySnapshot = await getDocs(q);
      const trips = [];
      let totalTrips = 0;
      let totalHardBrakes = 0;
      let totalRapidAccels = 0;
      let totalAdherenceScore = 0;
      let totalSmoothScore = 0;
      
      querySnapshot.forEach((doc) => {
        const tripData = doc.data();
        trips.push({ id: doc.id, ...tripData });
        
        totalHardBrakes += tripData.hardBrakes || 0;
        totalRapidAccels += tripData.rapidAccels || 0;
        totalAdherenceScore += tripData.adherenceScore || 85;
        totalSmoothScore += tripData.smoothnessScore || 80;
        totalTrips++;
      });
      
      if (totalTrips === 0) {
        setBehavioralStats({
          totalTrips: 0,
          avgHardBrakes: 0,
          avgRapidAccels: 0,
          avgAdherenceScore: 85,
          avgSmoothScore: 80,
          hasData: false
        });
        return;
      }
      
      setBehavioralStats({
        totalTrips,
        avgHardBrakes: Math.round(totalHardBrakes / totalTrips),
        avgRapidAccels: Math.round(totalRapidAccels / totalTrips),
        avgAdherenceScore: Math.round(totalAdherenceScore / totalTrips),
        avgSmoothScore: Math.round(totalSmoothScore / totalTrips),
        hasData: true
      });
      
    } catch (error) {
      console.error('Error calculating behavioral stats:', error);
    }
  }, []);

  // Reset route when logging stops
  useEffect(() => {
    if (!isLogging) {
      setRouteCoordinates([]);
      speedBuffer.current = [];
      locationBuffer.current = [];
      headingBuffer.current = [];
    }
  }, [isLogging]);

  // Memoized calculations for performance
  const currentSpeed = useMemo(() => {
    if (speedBuffer.current.length === 0) return 0;
    
    const sum = speedBuffer.current.reduce((a, b) => a + b, 0);
    return parseFloat((sum / speedBuffer.current.length).toFixed(1));
  }, [speedBuffer.current]);

  const formattedTime = useMemo(() => {
    if (!timeElapsed) return '0h 0m 0s';
    const h = Math.floor(timeElapsed / 3600);
    const m = Math.floor((timeElapsed % 3600) / 60);
    const s = timeElapsed % 60;
    return `${h}h ${m}m ${s}s`;
  }, [timeElapsed]);

  const getUserName = useMemo(() => {
    if (!userData) return 'Driver';
    
    return userData.name || 
           userData.fullName || 
           userData.displayName ||
           `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 
           userData.email?.split('@')[0] || 
           'Driver';
  }, [userData]);

  const getProfileImage = useMemo(() => {
    if (!userData) return null;
    
    return userData.profileImage || 
           userData.photoURL || 
           userData.avatar || 
           userData.imageUrl ||
           (userData.driverProfile && userData.driverProfile.profileImage) ||
           null;
  }, [userData]);

  // Behavioral insight calculations
  const behavioralInsights = useMemo(() => {
    if (isLogging) {
      const speeds = speedData || [];
      
      let realTimeHardBrakes = 0;
      for (let i = 2; i < speeds.length; i++) {
        const decel = speeds[i-2] - speeds[i];
        if (decel > 15 && speeds[i] < speeds[i-1]) {
          realTimeHardBrakes++;
        }
      }
      
      let realTimeRapidAccels = 0;
      for (let i = 2; i < speeds.length; i++) {
        const accel = speeds[i] - speeds[i-2];
        if (accel > 12 && speeds[i] > speeds[i-1]) {
          realTimeRapidAccels++;
        }
      }
      
      let adherenceScore = 85;
      if (speeds.length > 0) {
        const safeSpeeds = speeds.filter(speed => speed <= 85 && speed > 0).length;
        adherenceScore = Math.round((safeSpeeds / speeds.length) * 100);
      }
      
      let smoothScore = 80;
      if (speeds.length >= 2) {
        let jerkiness = 0;
        let validReadings = 0;
        
        for (let i = 1; i < speeds.length; i++) {
          const speedChange = Math.abs(speeds[i] - speeds[i - 1]);
          if (speedChange > 0.5) {
            jerkiness += speedChange;
            validReadings++;
          }
        }
        
        if (validReadings > 0) {
          const avgJerkiness = jerkiness / validReadings;
          smoothScore = Math.max(0, Math.min(100, Math.round(100 - (avgJerkiness * 3))));
        } else {
          smoothScore = 100;
        }
      }
      
      return {
        hardBrakes: realTimeHardBrakes,
        rapidAccels: realTimeRapidAccels,
        adherence: adherenceScore,
        smoothness: smoothScore,
        isRealTime: true
      };
    } else {
      return {
        hardBrakes: behavioralStats?.avgHardBrakes || 0,
        rapidAccels: behavioralStats?.avgRapidAccels || 0,
        adherence: behavioralStats?.avgAdherenceScore || 85,
        smoothness: behavioralStats?.avgSmoothScore || 80,
        isRealTime: false,
        hasHistoricalData: behavioralStats?.hasData || false
      };
    }
  }, [isLogging, speedData, behavioralStats]);

  // Toggle trip logging
  const toggleLogging = async () => {
    try {
      if (!isOnline) {
        Alert.alert(
          "Offline Mode", 
          "Please go online from the Driver Dashboard first to start trip logging"
        );
        return;
      }
      
      if (!locationPermission) {
        Alert.alert(
          "Location Permission Required", 
          "Please grant location permission to start trip logging"
        );
        await initLocation();
        return;
      }
      
      if (isLogging) {
        await stopTrip();
        speakFeedback('Trip stopped successfully');
        if (userData?.uid) {
          await calculateBehavioralStats(userData.uid);
        }
      } else {
        setRouteCoordinates([]);
        speedBuffer.current = [];
        locationBuffer.current = [];
        headingBuffer.current = [];
        
        await startTrip();
        speakFeedback('Trip started successfully. Drive safely!');
      }
    } catch (error) {
      console.error('Error toggling trip logging:', error);
      Alert.alert('Error', 'Failed to toggle trip logging. Please try again.');
    }
  };

  const openGoogleMaps = useCallback(() => {
    const locationToUse = locationState.smoothed;
    if (!locationToUse) {
      Alert.alert("Location Unavailable", "Current location is not available.");
      return;
    }
    
    const { latitude, longitude } = locationToUse;
    const url = Platform.select({
      ios: `maps://app?q=${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}?q=${latitude},${longitude}`,
    });

    Linking.openURL(url).catch(err => {
      console.error('Error opening Google Maps:', err);
      Alert.alert('Error', 'Could not open maps application.');
    });
  }, [locationState.smoothed]);

  const refreshLocation = async () => {
    const now = Date.now();
    if (now - lastManualRefresh.current < 2000) {
      return;
    }
    lastManualRefresh.current = now;

    if (!locationPermission) {
      await initLocation();
      return;
    }

    setLocationLoading(true);
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 5000,
      });
      
      if (isMounted.current && location.coords) {
        updateLocationData(location.coords, true);
      }
    } catch (error) {
      console.log('Error refreshing location:', error);
    } finally {
      if (isMounted.current) {
        setLocationLoading(false);
      }
    }
  };

  const getLocationUpdateTime = useCallback(() => {
    if (!locationState.lastUpdate) return "Never";
    
    const diff = Math.floor((new Date() - locationState.lastUpdate) / 1000);
    if (diff < 10) return "Just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }, [locationState.lastUpdate]);

  const toggleAutoRefresh = () => {
    setAutoRefreshEnabled(prev => !prev);
    Alert.alert(
      'Auto Refresh',
      !autoRefreshEnabled ? 'Location will refresh every 30 seconds' : 'Auto refresh disabled'
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1d807c" />
        <Text style={styles.loadingText}>Loading Trip Logger...</Text>
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* Emergency Alert Banner */}
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

      {/* Header */}
      <View style={[styles.headerWrapper, { marginTop: emergencyActive ? 44 : 0 }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Trip Logger</Text>
          </View>

          {/* Profile Section */}
          <View style={styles.profileWrapper}>
            {getProfileImage ? (
              <Image source={{ uri: getProfileImage }} style={styles.profileImage} />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Ionicons name="person" size={20} color="#1d807c" />
              </View>
            )}
            <Text style={styles.profileName} numberOfLines={1}>
              {getUserName}
            </Text>
          </View>
        </View>
        <View style={styles.curve} />
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Online Status Indicator */}
        <View style={[styles.fullBox, { backgroundColor: isOnline ? "#e8f5e9" : "#ffebee" }]}>
          <Ionicons
            name={isOnline ? "radio-button-on" : "radio-button-off"}
            size={28}
            color={isOnline ? "#2e7d32" : "#c62828"}
            style={styles.iconLeft}
          />
          <View>
            <Text style={styles.boxTitle}>Online Status</Text>
            <Text style={[styles.boxValue, { color: isOnline ? "#2e7d32" : "#c62828" }]}>
              {isOnline ? "Online - Available for trips" : "Offline - Not available"}
            </Text>
          </View>
        </View>

        {/* Impact Warning */}
        {impactDetected && (
          <View style={[styles.fullBox, { backgroundColor: "#ffebee" }]}>
            <Ionicons name="warning" size={28} color="#d32f2f" style={styles.iconLeft} />
            <View>
              <Text style={[styles.boxTitle, { color: "#d32f2f" }]}>Impact Detected!</Text>
              <Text style={[styles.impactMessage, { color: "#d32f2f" }]}>
                Please check if you're safe and pull over if needed
              </Text>
            </View>
          </View>
        )}

        {/* Start/Stop Button */}
        <TouchableOpacity
          style={[
            styles.fullBox, 
            { 
              backgroundColor: isLogging ? "#ffcdd2" : (isOnline ? "#e1f5fe" : "#f5f5f5"),
              opacity: isOnline ? 1 : 0.7
            }
          ]}
          onPress={toggleLogging}
          disabled={!isOnline}
        >
          <Ionicons
            name={isLogging ? "stop-circle" : "play-circle"}
            size={32}
            color={isOnline ? (isLogging ? "#c62828" : "#1d807c") : "#9e9e9e"}
            style={styles.iconLeft}
          />
          <Text style={[styles.boxTitle, { 
            color: isOnline ? (isLogging ? "#c62828" : "#555") : "#9e9e9e",
            fontWeight: 'bold'
          }]}>
            {isLogging ? "Stop Trip Logging" : "Start Trip Logging"}
          </Text>
        </TouchableOpacity>

        {/* Trip Duration */}
        {isLogging && (
          <View style={[styles.fullBox, { backgroundColor: "#e3f2fd" }]}>
            <Ionicons name="time" size={28} color="#1d807c" style={styles.iconLeft} />
            <View>
              <Text style={styles.boxTitle}>Trip Duration</Text>
              <Text style={styles.boxValue}>{formattedTime}</Text>
            </View>
          </View>
        )}

        {/* Current Speed */}
        <View style={[styles.fullBox, { backgroundColor: "#fff3e0" }]}>
          <FontAwesome5
            name="tachometer-alt"
            size={26}
            color="#1d807c"
            style={styles.iconLeft}
          />
          <View>
            <Text style={styles.boxTitle}>Current Speed</Text>
            <Text style={styles.boxValue}>{currentSpeed} km/h</Text>
            <Text style={{ fontSize: 12, color: "#777", marginTop: 2 }}>
              GPS Accuracy: {locationState.accuracy}
            </Text>
          </View>
        </View>

        {/* Distance Travelled */}
        <View style={[styles.fullBox, { backgroundColor: "#f3e5f5" }]}>
          <Ionicons name="car-sport" size={28} color="#1d807c" style={styles.iconLeft} />
          <View>
            <Text style={styles.boxTitle}>Distance Travelled</Text>
            <Text style={styles.boxValue}>{distance?.toFixed(3) || "0.000"} km</Text>
          </View>
        </View>

        {/* Average Speed */}
        <View style={[styles.fullBox, { backgroundColor: "#e8f5e9" }]}>
          <FontAwesome5
            name="chart-line"
            size={26}
            color="#1d807c"
            style={styles.iconLeft}
          />
          <View>
            <Text style={styles.boxTitle}>Average Speed</Text>
            <Text style={styles.boxValue}>{avgSpeed?.toFixed(2) || "0.00"} km/h</Text>
          </View>
        </View>

        {/* Map View */}
        <View style={styles.mapContainer}>
          {locationLoading ? (
            <View style={styles.mapPlaceholder}>
              <ActivityIndicator size="large" color="#1d807c" />
              <Text style={{marginTop: 10, textAlign: 'center'}}>Getting your location...</Text>
            </View>
          ) : locationPermission && locationState.smoothed ? (
            <View style={styles.mapContainer}>
              <WebViewMap
                userLocation={{
                  latitude: locationState.smoothed.latitude,
                  longitude: locationState.smoothed.longitude,
                  accuracy: locationState.current?.accuracy,
                  heading: locationState.heading
                }}
                routeCoordinates={routeCoordinates}
                followsUserLocation={isLogging}
                onMapReady={() => {
                  console.log('WebView map ready');
                  setMapReady(true);
                }}
                style={styles.map}
              />
              
              <View style={styles.mapOverlay}>
                <View style={styles.mapOverlayRow}>
                  <Text style={styles.mapOverlayText}>
                  Location: {getLocationUpdateTime()}
                  </Text>
                  <View style={styles.headingContainer}>
                    <Ionicons 
                      name="navigation" 
                      size={16} 
                      color="#1d807c" 
                      style={{ transform: [{ rotate: `${locationState.heading}deg` }] }}
                    />
                    <Text style={styles.headingText}>
                      {Math.round(locationState.heading)}°
                    </Text>
                  </View>
                </View>
                <Text style={styles.mapAccuracyText}>
                  Accuracy: {locationState.accuracy} | Speed: {currentSpeed} km/h
                </Text>
            
              </View>
              
              <TouchableOpacity 
                style={styles.refreshLocationButton}
                onPress={refreshLocation}
              >
                <Ionicons name="refresh" size={20} color="#1d807c" />
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.autoRefreshButton}
                onPress={toggleAutoRefresh}
              >
                <Ionicons 
                  name={autoRefreshEnabled ? "time" : "time-outline"} 
                  size={20} 
                  color={autoRefreshEnabled ? "#1d807c" : "#999"} 
                />
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.openMapsButton}
                onPress={openGoogleMaps}
              >
                <Ionicons name="navigate" size={20} color="#1d807c" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.mapPlaceholder}>
              <Ionicons name="location-outline" size={40} color="#ccc" />
              <Text style={{marginTop: 10, textAlign: 'center'}}>
                Location permission required to show map
              </Text>
              <TouchableOpacity 
                style={styles.permissionButton}
                onPress={initLocation}
              >
                <Text style={styles.permissionButtonText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Behavioral Insights */}
        <View style={[styles.card, { backgroundColor: "#f5f5f5" }]}>
          <View style={styles.behaviorHeader}>
            <Text style={styles.sectionTitle}>Behavioral Insights</Text>
            <View style={styles.insightIndicator}>
              {behavioralInsights.isRealTime ? (
                <Text style={styles.realtimeIndicator}>Real-time</Text>
              ) : behavioralInsights.hasHistoricalData ? (
                <Text style={styles.historicalIndicator}>
                  Based on {behavioralStats?.totalTrips || 0} trips
                </Text>
              ) : (
                <Text style={styles.defaultIndicator}>No trip data yet</Text>
              )}
            </View>
          </View>
          <View style={styles.insightRow}>
            <View style={[styles.insightBox, { backgroundColor: "#e8f5e9" }]}>
              <Ionicons name="speedometer" size={22} color="#1d807c" />
              <Text style={styles.insightValue}>
                {behavioralInsights.adherence}%
              </Text>
              <Text style={styles.insightLabel}>Speed Adherence</Text>
            </View>
            <View style={[styles.insightBox, { backgroundColor: "#fff3e0" }]}>
              <Ionicons name="hand-left-outline" size={22} color="#1d807c" />
              <Text style={styles.insightValue}>
                {behavioralInsights.hardBrakes}
              </Text>
              <Text style={styles.insightLabel}>Hard Brakes</Text>
            </View>
            <View style={[styles.insightBox, { backgroundColor: "#e3f2fd" }]}>
              <Ionicons name="flash-outline" size={22} color="#1d807c" />
              <Text style={styles.insightValue}>
                {behavioralInsights.rapidAccels}
              </Text>
              <Text style={styles.insightLabel}>Rapid Accel</Text>
            </View>
            <View style={[styles.insightBox, { backgroundColor: "#f3e5f5" }]}>
              <Ionicons name="happy-outline" size={22} color="#1d807c" />
              <Text style={styles.insightValue}>
                {behavioralInsights.smoothness}%
              </Text>
              <Text style={styles.insightLabel}>Smooth Score</Text>
            </View>
          </View>
          
          {!behavioralInsights.isRealTime && behavioralInsights.hasHistoricalData && (
            <View style={styles.historicalStats}>
              <Text style={styles.historicalText}>
                Historical averages from your completed trips
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer Navigation */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity onPress={() => handleNavigation("DriverDashboard")}>
            <Ionicons name="home" size={28} color="#fff" />
          </TouchableOpacity>
          
          <TouchableOpacity
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
                isVoiceListening ? "#EF4444" :
                isProcessingVoice ? "#3B82F6" : "#fff"
              }
            />
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => handleNavigation("DriverSettings")}>
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
                backgroundColor: isProcessingVoice ? '#E5E7EB' : '#FEF2F2'
              }
            ]}>
              <Ionicons 
                name={isProcessingVoice ? "cloud-upload" : "mic"} 
                size={64} 
                color={isProcessingVoice ? "#6B7280" : "#EF4444"} 
              />
            </Animated.View>
            
            <Text style={styles.voiceModalTitle}>
              {isProcessingVoice ? 'PROCESSING...' : 'LISTENING...'}
            </Text>
            
            <View style={styles.recordingStatus}>
              <View style={styles.recordingIndicator}>
                <View style={[
                  styles.recordingDot,
                  { backgroundColor: isProcessingVoice ? '#6B7280' : '#EF4444' }
                ]} />
                <Text style={[
                  styles.recordingText,
                  { color: isProcessingVoice ? '#6B7280' : '#EF4444' }
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
                <Text style={styles.example}>• "Refresh location"</Text>
                <Text style={styles.example}>• "Enable auto refresh" or "Disable auto refresh"</Text>
              </View>
            )}
            
            <TouchableOpacity
              style={[styles.voiceModalCancelButton, isProcessingVoice && { backgroundColor: '#E5E7EB' }]}
              onPress={cancelVoiceRecording}
            >
              <Text style={[styles.voiceModalCancelText, isProcessingVoice && { color: '#6B7280' }]}>
                {isProcessingVoice ? 'Close' : 'Cancel Recording'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const { width } = Dimensions.get("window");
const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: "#fff" },
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
  headerWrapper: { 
    position: 'relative', 
    backgroundColor: "#1d807c" 
  },
  headerContent: {
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  curve: {
    width,
    height: 30,
    backgroundColor: "#fff",
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    marginTop: -10,
  },
  headerTitle: { fontSize: 24, fontWeight: "bold", color: "#fff" },
  subTitle: { fontSize: 14, color: "#fff", marginTop: 2 },
  profileWrapper: { 
    flexDirection: 'row', 
    alignItems: 'center',
    maxWidth: '40%',
  },
  profileName: { 
    color: '#fff', 
    marginRight: 8, 
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
    backgroundColor: '#3B82F6',
  },
  micButtonDisabled: {
    backgroundColor: '#9CA3AF',
    opacity: 0.7,
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
    color: '#EF4444',
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
    color: '#10B981',
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
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    marginBottom: 12,
  },
  voiceModalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  
  fullBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 20,
    marginHorizontal: 18,
    marginBottom: 12,
  },
  boxTitle: { fontSize: 15, color: "#555", fontWeight: "600" },
  boxValue: { fontSize: 15, fontWeight: "bold", color: "#1d807c", marginTop: 4 },
  statusHint: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
    fontStyle: 'italic',
  },
  userIdHint: {
    fontSize: 9,
    color: "#999",
    marginTop: 2,
  },
  offlineHint: {
    fontSize: 12,
    color: "#c62828",
    marginTop: 4,
    fontStyle: 'italic'
  },
  impactMessage: {
    fontSize: 12,
    color: "#d32f2f",
    marginTop: 4,
  },
  iconLeft: { marginRight: 12 },
  mapContainer: {
    height: 320,
    marginHorizontal: 18,
    marginBottom: 12,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  mapOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8,
    borderRadius: 8,
  },
  mapOverlayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  mapOverlayText: {
    color: 'white',
    fontSize: 11,
    flex: 1,
  },
  mapAccuracyText: {
    color: '#1d807c',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  mapAutoRefreshText: {
    color: '#aaa',
    fontSize: 10,
    fontStyle: 'italic',
  },
  headingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  headingText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  refreshLocationButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  autoRefreshButton: {
    position: 'absolute',
    top: 50,
    right: 10,
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  openMapsButton: {
    position: 'absolute',
    top: 90,
    right: 10,
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    height: 320,
    borderRadius: 20,
    padding: 16,
  },
  card: {
    marginHorizontal: 18,
    marginBottom: 12,
    borderRadius: 20,
    padding: 16,
  },
  behaviorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#333" },
  insightIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  realtimeIndicator: {
    fontSize: 12,
    color: "#1d807c",
    fontWeight: 'bold',
  },
  historicalIndicator: {
    fontSize: 12,
    color: "#666",
    fontStyle: 'italic',
  },
  defaultIndicator: {
    fontSize: 12,
    color: "#999",
    fontStyle: 'italic',
  },
  insightRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  insightBox: {
    width: "47%",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  insightValue: { fontSize: 15, fontWeight: "bold", color: "#1d807c", marginTop: 4 },
  insightLabel: { fontSize: 12, color: "#555", marginTop: 2 },
  historicalStats: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  historicalText: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
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
    backgroundColor: '#1d807c',
    width: width * 0.92,
    borderRadius: 35,
    paddingVertical: 14,
    elevation: 6,
    shadowColor: '#21eba7ff',
    shadowOpacity: 1,
    shadowRadius: 100,
    borderWidth: 5.0,
    borderColor: 'rgba(214,51,132,0.12)',
  },
  permissionButton: {
    marginTop: 15,
    backgroundColor: '#1d807c',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});

export default TripLogger;