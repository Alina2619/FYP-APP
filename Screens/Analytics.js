import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Share,
  Alert,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { LineChart } from 'react-native-chart-kit';

// ========== ADDED: Import Trip Context ==========
import { useTrip } from '../contexts/TripContext';

// Voice Command Integration
import voiceCommandService from '../src/voice/VoiceCommandService';

// Import emergency functions from the emergency dashboard
import { 
  subscribeToEmergency, 
  cancelGlobalEmergency,
  globalEmergencyState 
} from './Emergency'; // Adjust path as needed

// Speech for voice feedback
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';

const AnalyticsScreen = ({ navigation }) => {
  const [userData, setUserData] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState('month');
  const [timeRangeLoading, setTimeRangeLoading] = useState(false);
  const [comparisonData, setComparisonData] = useState(null);
  
  // ========== ADDED: Emergency states ==========
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState(null);
  const [emergencyCountdown, setEmergencyCountdown] = useState(10);
  
  // ========== ADDED: Voice Command States ==========
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [voiceConfidence, setVoiceConfidence] = useState(0);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isVoiceModelLoaded, setIsVoiceModelLoaded] = useState(false);
  
  // ========== ADDED: Voice Command Refs ==========
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimerRef = useRef(null);
  const pulseAnimationRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const isHoldingMicRef = useRef(false);
  const micButtonRef = useRef(null);

  // ========== ADDED: Get Trip Context ==========
  const { recentTrip: contextRecentTrip, isLogging, startTrip, stopTrip } = useTrip();

  // ========== ADDED: Listen to global emergency events ==========
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

  // ========== ADDED: Handle emergency cancellation ==========
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

  // ========== ADDED: Quick voice alert function ==========
  const speakQuickAlert = useCallback((message) => {
    if (!isVoiceEnabled) return;
    
    Speech.stop();
    
    Speech.speak(message, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.9,
    });
  }, [isVoiceEnabled]);

  // ========== ADDED: Voice navigation feedback ==========
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

  // ========== ADDED: Start pulse animation ==========
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

  // ========== ADDED: Stop pulse animation ==========
  const stopPulseAnimation = useCallback(() => {
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    voicePulseAnim.setValue(1);
  }, [voicePulseAnim]);

  // ========== ADDED: Initialize voice assistant ==========
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

  // ========== ADDED: Initialize voice command service ==========
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

  // ========== ADDED: Handle voice command execution (EXACT SAME AS DRIVERDASHBOARD) ==========
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
        response = 'You are already on the analytics screen.';
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

      case 'go to trip logger':
      case 'open trip logger':
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
        
      case 'share analytics':
      case 'share progress':
      case 'share stats':
        response = 'Sharing your analytics progress.';
        action = () => {
          shareProgress();
        };
        success = true;
        break;
        
      case 'show week':
      case 'week view':
        response = 'Switching to week view.';
        action = () => {
          handleTimeRangeChange('week');
        };
        success = true;
        break;
        
      case 'show month':
      case 'month view':
        response = 'Switching to month view.';
        action = () => {
          handleTimeRangeChange('month');
        };
        success = true;
        break;
        
      case 'show all time':
      case 'all time':
        response = 'Switching to all time view.';
        action = () => {
          handleTimeRangeChange('all');
        };
        success = true;
        break;
        
      default:
        response = `Command "${command}" not recognized. Try: start trip, stop trip, emergency, or dashboard.`;
        success = false;
    }
    
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
  }, [
    navigation, 
    isVoiceEnabled, 
    speakQuickAlert, 
    isLogging, 
    startTrip, 
    stopTrip, 
    speakNavigationFeedback
  ]);

  // ========== ADDED: Process voice command ==========
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

  // ========== ADDED: Cleanup timers ==========
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

  // ========== ADDED: Start voice recording ==========
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
      
      // Set timeout to auto-stop after 8 seconds
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

  // ========== ADDED: Stop voice recording ==========
  const stopVoiceRecording = useCallback(async () => {
    if (!isVoiceListening || !isHoldingMicRef.current) return;
    
    isHoldingMicRef.current = false;
    await processVoiceCommand();
  }, [isVoiceListening, processVoiceCommand]);

  // ========== ADDED: Cancel voice recording ==========
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

  // ========== ADDED: Handle mic button press in and out ==========
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

  // ========== ADDED: Handle navigation with voice feedback ==========
  const handleNavigation = useCallback((screenName) => {
    if (isVoiceEnabled) {
      speakNavigationFeedback(screenName);
    }
    
    setTimeout(() => {
      navigation.navigate(screenName);
    }, 800);
  }, [navigation, isVoiceEnabled, speakNavigationFeedback]);

  // ========== ADDED: Initialize on component mount ==========
  useEffect(() => {
    initializeVoiceAssistant();
    initializeVoiceCommandService();
    
    // Set up cleanup on unmount
    return () => {
      Speech.stop();
      voiceCommandService.cleanup();
      cleanupTimers();
      stopPulseAnimation();
    };
  }, [initializeVoiceAssistant, initializeVoiceCommandService, cleanupTimers, stopPulseAnimation]);

  // Get start and end dates for a time range
  const getDateRange = (range) => {
    const now = new Date();
    let startDate, endDate;
    
    switch (range) {
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'all':
        startDate = new Date(0);
        endDate = new Date(8640000000000000);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        endDate = new Date(now);
    }
    
    return { startDate, endDate };
  };

  // Get previous period date range
  const getPreviousDateRange = (range) => {
    const now = new Date();
    let startDate, endDate;
    
    switch (range) {
      case 'week':
        endDate = new Date(now);
        endDate.setDate(now.getDate() - 7);
        endDate.setHours(23, 59, 59, 999);
        startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'month':
        endDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        endDate.setHours(23, 59, 59, 999);
        startDate = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'all':
        return { startDate: new Date(0), endDate: new Date(8640000000000000) };
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }
    
    return { startDate, endDate };
  };

  // Fetch user data and analytics
  const fetchAnalytics = useCallback(async (userId) => {
    try {
      setRefreshing(true);
      
      const tripsRef = collection(db, 'trips');
      const q = query(
        tripsRef,
        where('userId', '==', userId),
        where('status', '==', 'completed'),
        orderBy('startTime', 'desc'),
        limit(500)
      );
      
      const querySnapshot = await getDocs(q);
      const allTrips = [];
      querySnapshot.forEach((doc) => {
        const tripData = doc.data();
        if (tripData.status === 'completed' && tripData.endTime) {
          const trip = { 
            id: doc.id, 
            ...tripData,
            startTime: tripData.startTime?.toDate ? tripData.startTime.toDate() : new Date(tripData.startTime),
            endTime: tripData.endTime?.toDate ? tripData.endTime.toDate() : new Date(tripData.endTime)
          };
          allTrips.push(trip);
        }
      });

      allTrips.sort((a, b) => a.startTime - b.startTime);

      const currentRange = getDateRange(timeRange);
      const previousRange = getPreviousDateRange(timeRange);

      const currentTrips = allTrips.filter(trip => 
        trip.startTime >= currentRange.startDate && trip.startTime <= currentRange.endDate
      );

      let previousTrips;
      if (timeRange === 'all') {
        const midIndex = Math.floor(allTrips.length / 2);
        previousTrips = allTrips.slice(0, midIndex);
      } else {
        previousTrips = allTrips.filter(trip => 
          trip.startTime >= previousRange.startDate && trip.startTime <= previousRange.endDate
        );
      }

      const currentAnalytics = calculateAnalytics(currentTrips, timeRange);
      const previousAnalytics = calculateAnalytics(previousTrips, timeRange);
      
      setAnalyticsData(currentAnalytics);
      setComparisonData(calculateComparison(currentAnalytics, previousAnalytics));
      
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setAnalyticsData(getDefaultAnalytics(timeRange));
      setComparisonData(getDefaultComparison());
    } finally {
      setLoading(false);
      setRefreshing(false);
      setTimeRangeLoading(false);
    }
  }, [timeRange]);

  const calculateComparison = (current, previous) => {
    if (!previous || previous.overview.totalTrips === 0) {
      return getDefaultComparison();
    }

    return {
      safety: {
        current: current.scores.safety,
        previous: previous.scores.safety,
        change: previous.scores.safety > 0 ? ((current.scores.safety - previous.scores.safety) / previous.scores.safety) * 100 : 0
      },
      distance: {
        current: current.overview.totalDistance,
        previous: previous.overview.totalDistance,
        change: previous.overview.totalDistance > 0 ? ((current.overview.totalDistance - previous.overview.totalDistance) / previous.overview.totalDistance) * 100 : 0
      },
      trips: {
        current: current.overview.totalTrips,
        previous: previous.overview.totalTrips,
        change: previous.overview.totalTrips > 0 ? ((current.overview.totalTrips - previous.overview.totalTrips) / previous.overview.totalTrips) * 100 : 0
      }
    };
  };

  const calculateAnalytics = (trips, range) => {
    if (!trips || trips.length === 0) {
      return getDefaultAnalytics(range);
    }

    const totalTrips = trips.length;
    const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance || 0), 0);
    const totalDuration = trips.reduce((sum, trip) => {
      if (trip.startTime && trip.endTime) {
        return sum + ((trip.endTime.getTime() - trip.startTime.getTime()) / 1000);
      }
      return sum + (trip.duration || 0);
    }, 0);
    
    const totalHardBrakes = trips.reduce((sum, trip) => sum + (trip.harshBrakingCount || 0), 0);
    const totalRapidAccels = trips.reduce((sum, trip) => sum + (trip.rapidAccelerationCount || 0), 0);
    const totalSpeeding = trips.reduce((sum, trip) => sum + (trip.speedingCount || 0), 0);
    const totalPhoneUsage = trips.reduce((sum, trip) => sum + (trip.phoneUsageCount || 0), 0);
    const totalSharpTurns = trips.reduce((sum, trip) => sum + (trip.sharpTurnCount || 0), 0);

    const safetyScore = calculateSafetyScore(trips);
    const ecoScore = calculateEcoScore(trips);
    const adherenceScore = calculateAdherenceScore(trips);
    const smoothScore = calculateSmoothScore(trips);

    const trends = calculateTrends(trips, range);
    const improvementAreas = identifyImprovementAreas({
      hardBrakes: totalHardBrakes,
      rapidAccels: totalRapidAccels,
      speeding: totalSpeeding,
      phoneUsage: totalPhoneUsage,
      sharpTurns: totalSharpTurns
    }, totalTrips, range);

    return {
      overview: {
        totalTrips,
        totalDistance: parseFloat(totalDistance.toFixed(1)),
        totalDuration,
        avgTripDistance: parseFloat((totalDistance / Math.max(totalTrips, 1)).toFixed(1)),
        avgTripDuration: Math.round(totalDuration / Math.max(totalTrips, 1)),
        drivingTime: formatDrivingTime(totalDuration),
        timeRange: range
      },
      scores: {
        safety: Math.round(safetyScore),
        eco: Math.round(ecoScore),
        adherence: Math.round(adherenceScore),
        smooth: Math.round(smoothScore)
      },
      behavior: {
        hardBrakes: totalHardBrakes,
        rapidAccels: totalRapidAccels,
        speeding: totalSpeeding,
        phoneUsage: totalPhoneUsage,
        sharpTurns: totalSharpTurns,
        perTrip: {
          hardBrakes: parseFloat((totalHardBrakes / Math.max(totalTrips, 1)).toFixed(1)),
          rapidAccels: parseFloat((totalRapidAccels / Math.max(totalTrips, 1)).toFixed(1)),
          speeding: parseFloat((totalSpeeding / Math.max(totalTrips, 1)).toFixed(1))
        }
      },
      trends: trends,
      improvementAreas,
      lastUpdated: new Date().toISOString()
    };
  };

  const calculateTrends = (trips, range) => {
    if (trips.length === 0) {
      return getEmptyTrends(range);
    }

    const now = new Date();
    let periods = [];
    let periodLabels = [];

    switch (range) {
      case 'week':
        for (let i = 6; i >= 0; i--) {
          const date = new Date(now);
          date.setDate(date.getDate() - i);
          const start = new Date(date);
          start.setHours(0, 0, 0, 0);
          const end = new Date(date);
          end.setHours(23, 59, 59, 999);
          periods.push({ start, end });
          periodLabels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
        }
        break;
      case 'month':
        for (let i = 3; i >= 0; i--) {
          const start = new Date(now);
          start.setDate(start.getDate() - (i + 1) * 7);
          const end = new Date(now);
          end.setDate(end.getDate() - i * 7 - 1);
          periods.push({ start, end });
          periodLabels.push(`W${4 - i}`);
        }
        break;
      default:
        for (let i = 5; i >= 0; i--) {
          const date = new Date(now);
          date.setMonth(date.getMonth() - i);
          periods.push({
            start: new Date(date.getFullYear(), date.getMonth(), 1),
            end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
          });
          periodLabels.push(date.toLocaleDateString('en-US', { month: 'short' }));
        }
        break;
    }

    const trends = {
      safety: new Array(periods.length).fill(0),
      distance: new Array(periods.length).fill(0),
      incidents: new Array(periods.length).fill(0),
      tripCount: new Array(periods.length).fill(0)
    };

    trips.forEach(trip => {
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        if (trip.startTime >= period.start && trip.startTime <= period.end) {
          const tripSafetyScore = calculateTripSafetyScore(trip);
          trends.safety[i] += tripSafetyScore;
          trends.distance[i] += trip.distance || 0;
          trends.incidents[i] += (trip.harshBrakingCount || 0) + (trip.rapidAccelerationCount || 0) + (trip.speedingCount || 0);
          trends.tripCount[i]++;
          break;
        }
      }
    });

    // Calculate averages for safety
    trends.safety = trends.safety.map((score, index) => 
      trends.tripCount[index] > 0 ? Math.round(score / trends.tripCount[index]) : 0
    );

    return {
      safety: trends.safety,
      distance: trends.distance.map(distance => parseFloat(distance.toFixed(1))),
      incidents: trends.incidents,
      labels: periodLabels
    };
  };

  const getEmptyTrends = (range) => {
    let labels = [];
    
    switch (range) {
      case 'week':
        labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        break;
      case 'month':
        labels = ['W1', 'W2', 'W3', 'W4'];
        break;
      default:
        labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
        break;
    }

    return {
      safety: new Array(labels.length).fill(0),
      distance: new Array(labels.length).fill(0),
      incidents: new Array(labels.length).fill(0),
      labels
    };
  };

  const getDefaultAnalytics = (range = 'month') => {
    return {
      overview: {
        totalTrips: 0,
        totalDistance: 0,
        totalDuration: 0,
        avgTripDistance: 0,
        avgTripDuration: 0,
        drivingTime: '0h 0m',
        timeRange: range
      },
      scores: {
        safety: 0,
        eco: 0,
        adherence: 0,
        smooth: 0
      },
      behavior: {
        hardBrakes: 0,
        rapidAccels: 0,
        speeding: 0,
        phoneUsage: 0,
        sharpTurns: 0,
        perTrip: {
          hardBrakes: 0,
          rapidAccels: 0,
          speeding: 0
        }
      },
      trends: getEmptyTrends(range),
      improvementAreas: [{
        title: 'Start Driving',
        description: 'Complete your first trip to see analytics',
        icon: 'car-outline',
        priority: 'low'
      }],
      lastUpdated: new Date().toISOString()
    };
  };

  const getDefaultComparison = () => {
    return {
      safety: { current: 0, previous: 0, change: 0 },
      distance: { current: 0, previous: 0, change: 0 },
      trips: { current: 0, previous: 0, change: 0 }
    };
  };

  const calculateTripSafetyScore = (trip) => {
    let score = 100;
    
    if (trip.harshBrakingCount > 0) score -= trip.harshBrakingCount * 3;
    if (trip.rapidAccelerationCount > 0) score -= trip.rapidAccelerationCount * 2;
    if (trip.speedingCount > 0) score -= trip.speedingCount * 4;
    if (trip.phoneUsageCount > 0) score -= trip.phoneUsageCount * 5;
    if (trip.sharpTurnCount > 0) score -= trip.sharpTurnCount * 1;
    
    return Math.max(0, Math.min(100, score));
  };

  const calculateSafetyScore = (trips) => {
    if (trips.length === 0) return 0;
    
    let totalScore = 0;
    
    trips.forEach(trip => {
      totalScore += calculateTripSafetyScore(trip);
    });
    
    return totalScore / trips.length;
  };

  const calculateEcoScore = (trips) => {
    if (trips.length === 0) return 0;
    
    let totalScore = 0;
    
    trips.forEach(trip => {
      let tripScore = 100;
      
      if (trip.harshBrakingCount > 0) tripScore -= trip.harshBrakingCount * 3;
      if (trip.rapidAccelerationCount > 0) tripScore -= trip.rapidAccelerationCount * 2;
      
      const avgSpeed = trip.avgSpeed || 0;
      if (avgSpeed > 0 && avgSpeed <= 60) tripScore += 10;
      if (avgSpeed > 80) tripScore -= 10;
      
      tripScore = Math.max(0, Math.min(100, tripScore));
      totalScore += tripScore;
    });
    
    return totalScore / trips.length;
  };

  const calculateAdherenceScore = (trips) => {
    if (trips.length === 0) return 0;
    
    let totalScore = 0;
    
    trips.forEach(trip => {
      const speedingScore = trip.speedingCount > 0 ? Math.max(60, 100 - (trip.speedingCount * 5)) : 100;
      totalScore += speedingScore;
    });
    
    return totalScore / trips.length;
  };

  const calculateSmoothScore = (trips) => {
    if (trips.length === 0) return 0;
    
    let totalScore = 0;
    
    trips.forEach(trip => {
      const incidentScore = 100 - ((trip.harshBrakingCount || 0) * 5) - ((trip.rapidAccelerationCount || 0) * 3);
      totalScore += Math.max(0, incidentScore);
    });
    
    return totalScore / trips.length;
  };

  const identifyImprovementAreas = (behavior, totalTrips, range) => {
    const areas = [];
    const trips = Math.max(totalTrips, 1);
    
    const avgHardBrakes = behavior.hardBrakes / trips;
    const avgRapidAccels = behavior.rapidAccels / trips;
    const avgSpeeding = behavior.speeding / trips;
    
    const hardBrakeThreshold = range === 'week' ? 1 : range === 'month' ? 2 : 3;
    const rapidAccelThreshold = range === 'week' ? 2 : range === 'month' ? 3 : 4;
    const speedingThreshold = range === 'week' ? 0.5 : range === 'month' ? 1 : 2;
    
    if (avgHardBrakes > hardBrakeThreshold) {
      areas.push({
        title: 'Smooth Braking',
        description: `Reduce hard braking (current: ${avgHardBrakes.toFixed(1)} per trip)`,
        icon: 'hand-left-outline',
        priority: avgHardBrakes > hardBrakeThreshold * 2 ? 'high' : 'medium'
      });
    }
    
    if (avgRapidAccels > rapidAccelThreshold) {
      areas.push({
        title: 'Gentle Acceleration',
        description: `Avoid rapid acceleration (current: ${avgRapidAccels.toFixed(1)} per trip)`,
        icon: 'flash-outline',
        priority: avgRapidAccels > rapidAccelThreshold * 2 ? 'high' : 'medium'
      });
    }
    
    if (avgSpeeding > speedingThreshold) {
      areas.push({
        title: 'Speed Adherence',
        description: `Maintain speed limits (current: ${avgSpeeding.toFixed(1)} incidents per trip)`,
        icon: 'speedometer-outline',
        priority: avgSpeeding > speedingThreshold * 2 ? 'high' : 'medium'
      });
    }
    
    if (behavior.phoneUsage > 0) {
      areas.push({
        title: 'Focus on Driving',
        description: 'Avoid phone usage while driving',
        icon: 'phone-portrait-outline',
        priority: 'high'
      });
    }

    if (areas.length === 0 && totalTrips > 0) {
      areas.push({
        title: 'Excellent Driving',
        description: `Keep up the great driving habits this ${range}!`,
        icon: 'thumbs-up-outline',
        priority: 'low'
      });
    }

    if (areas.length === 0 && totalTrips === 0) {
      areas.push({
        title: 'Start Driving',
        description: 'Complete your first trip to see personalized insights',
        icon: 'car-outline',
        priority: 'low'
      });
    }
    
    return areas;
  };

  const formatDrivingTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const getScoreColor = (score) => {
    if (score >= 90) return '#10b981';
    if (score >= 80) return '#f59e0b';
    if (score >= 70) return '#f97316';
    return '#ef4444';
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getTrendIcon = (change) => {
    if (change > 5) return { icon: 'trending-up', color: '#10b981' };
    if (change < -5) return { icon: 'trending-down', color: '#ef4444' };
    return { icon: 'remove', color: '#6b7280' };
  };

  const getTimeRangeDisplay = (range) => {
    switch (range) {
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'all': return 'All Time';
      default: return 'This Month';
    }
  };

  const handleTimeRangeChange = async (newRange) => {
    if (newRange === timeRange || timeRangeLoading) return;
    
    setTimeRangeLoading(true);
    setTimeRange(newRange);
    
    // Fetch new data immediately when time range changes
    if (userData && userData.uid) {
      await fetchAnalytics(userData.uid);
    } else {
      setTimeRangeLoading(false);
    }
  };

  const shareProgress = async () => {
    try {
      const safetyScore = analyticsData?.scores.safety || 0;
      const totalTrips = analyticsData?.overview.totalTrips || 0;
      const totalDistance = analyticsData?.overview.totalDistance || 0;
      
      const message = `🚗 My Drivemate Driving Progress 🚗\n\n` +
        `Safety Score: ${safetyScore}/100\n` +
        `Trips Completed: ${totalTrips}\n` +
        `Distance Driven: ${totalDistance}km\n` +
        `Time Range: ${getTimeRangeDisplay(timeRange)}\n\n` +
        `Download Drivemate to track your driving too!`;
      
      await Share.share({
        message,
        title: 'My Drivemate Progress'
      });
    } catch (error) {
      Alert.alert('Error', 'Could not share progress');
    }
  };

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        setAnalyticsData(getDefaultAnalytics());
        setComparisonData(getDefaultComparison());
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData({ ...data, uid: user.uid });
          await fetchAnalytics(user.uid);
        } else {
          setUserData({ uid: user.uid, email: user.email });
          setAnalyticsData(getDefaultAnalytics());
          setComparisonData(getDefaultComparison());
          setLoading(false);
        }
      } catch (e) {
        console.error('Error fetching user data:', e);
        setAnalyticsData(getDefaultAnalytics());
        setComparisonData(getDefaultComparison());
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const onRefresh = useCallback(() => {
    if (userData && userData.uid) {
      fetchAnalytics(userData.uid);
    }
  }, [userData, fetchAnalytics]);

  const getUserName = useCallback(() => {
    if (!userData) return 'Driver';
    return userData.name || userData.fullName || userData.displayName || 'Driver';
  }, [userData]);

  const getProfileImage = useCallback(() => {
    if (!userData) return null;
    return userData.profileImage || userData.photoURL || null;
  }, [userData]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1d807c" />
        <Text style={styles.loadingText}>Loading Analytics...</Text>
      </View>
    );
  }

  const name = getUserName();
  const profileImage = getProfileImage();
  const data = analyticsData || getDefaultAnalytics(timeRange);
  const comparison = comparisonData || getDefaultComparison();

  return (
    <View style={styles.mainContainer}>
      {/* ========== ADDED: Emergency Alert Banner ========== */}
      {(emergencyActive || globalEmergencyState?.isActive) && (
        <View style={styles.topEmergencyAlert}>
          <Ionicons name="alert-circle" size={20} color="#fff" />
          <View style={styles.topAlertContent}>
            <Text style={styles.topAlertTitle}>🚨 EMERGENCY DETECTED</Text>
            <Text style={styles.topAlertMessage} numberOfLines={1}>
              {emergencyType?.message || globalEmergencyState?.emergencyType?.message || "Emergency alert"}
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.topAlertCancelButton}
            onPress={handleCancelEmergency}
          >
            <Text style={styles.topAlertCancelText}>
              Cancel ({emergencyCountdown || globalEmergencyState?.countdown || 10}s)
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Header */}
      <View style={[styles.headerWrapper, { marginTop: emergencyActive ? 44 : 0 }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Driving Analytics • {getTimeRangeDisplay(timeRange)}</Text>
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

      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Time Range Selector */}
        <View style={styles.timeRangeContainer}>
          {['week', 'month', 'all'].map((range) => (
            <TouchableOpacity 
              key={range}
              style={[
                styles.timeRangeButton, 
                timeRange === range && styles.timeRangeActive
              ]}
              onPress={() => handleTimeRangeChange(range)}
              disabled={timeRangeLoading}
            >
              {timeRangeLoading && timeRange === range ? (
                <ActivityIndicator size="small" color={timeRange === range ? "#fff" : "#1d807c"} />
              ) : (
                <Text style={[
                  styles.timeRangeText, 
                  timeRange === range && styles.timeRangeTextActive
                ]}>
                  {range === 'week' ? 'Week' : range === 'month' ? 'Month' : 'All Time'}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Performance Comparison */}
        {data.overview.totalTrips > 0 && (
          <TouchableOpacity 
            style={[styles.fullBox, { backgroundColor: '#f0f9ff' }]}
            onPress={() => Alert.alert(
              'Performance Comparison',
              `Safety Score: ${comparison.safety.current} vs ${comparison.safety.previous}\n` +
              `Distance: ${comparison.distance.current}km vs ${comparison.distance.previous}km\n` +
              `Trips: ${comparison.trips.current} vs ${comparison.trips.previous}\n\n` +
              `Green arrow means improvement, red means decline.`
            )}
          >
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Performance vs Last Period</Text>
              <View style={styles.comparisonGrid}>
                <View style={styles.comparisonItem}>
                  <Text style={styles.comparisonLabel}>Safety Score</Text>
                  <View style={styles.comparisonValueRow}>
                    <Text style={styles.comparisonValue}>{comparison.safety.current}</Text>
                    <Ionicons 
                      name={getTrendIcon(comparison.safety.change).icon} 
                      size={16} 
                      color={getTrendIcon(comparison.safety.change).color} 
                    />
                    <Text style={[styles.comparisonChange, { color: getTrendIcon(comparison.safety.change).color }]}>
                      {comparison.safety.change > 0 ? '+' : ''}{comparison.safety.change.toFixed(1)}%
                    </Text>
                  </View>
                </View>
                <View style={styles.comparisonItem}>
                  <Text style={styles.comparisonLabel}>Distance</Text>
                  <View style={styles.comparisonValueRow}>
                    <Text style={styles.comparisonValue}>{comparison.distance.current}km</Text>
                    <Ionicons 
                      name={getTrendIcon(comparison.distance.change).icon} 
                      size={16} 
                      color={getTrendIcon(comparison.distance.change).color} 
                    />
                    <Text style={[styles.comparisonChange, { color: getTrendIcon(comparison.distance.change).color }]}>
                      {comparison.distance.change > 0 ? '+' : ''}{comparison.distance.change.toFixed(1)}%
                    </Text>
                  </View>
                </View>
                <View style={styles.comparisonItem}>
                  <Text style={styles.comparisonLabel}>Trips</Text>
                  <View style={styles.comparisonValueRow}>
                    <Text style={styles.comparisonValue}>{comparison.trips.current}</Text>
                    <Ionicons 
                      name={getTrendIcon(comparison.trips.change).icon} 
                      size={16} 
                      color={getTrendIcon(comparison.trips.change).color} 
                    />
                    <Text style={[styles.comparisonChange, { color: getTrendIcon(comparison.trips.change).color }]}>
                      {comparison.trips.change > 0 ? '+' : ''}{comparison.trips.change.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              </View>
            </View>
            <Ionicons name="trending-up" size={24} color="#1d807c" />
          </TouchableOpacity>
        )}

        {/* Overview Stats Boxes */}
        <View style={styles.row}>
          <View style={[styles.box, { backgroundColor: '#f9f3f3' }]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Total Trips</Text>
              <Text style={styles.boxValue}>{data.overview.totalTrips}</Text>
            </View>
            <Ionicons name="calendar" size={24} color="#1d807c" />
          </View>

          <View style={[styles.box, { backgroundColor: '#f3f9f4' }]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>KM Driven</Text>
              <Text style={styles.boxValue}>{data.overview.totalDistance} km</Text>
            </View>
            <Ionicons name="map" size={24} color="#1d807c" />
          </View>

          <View style={[styles.box, { backgroundColor: '#f3f6f9' }]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Driving Time</Text>
              <Text style={styles.boxValue}>{data.overview.drivingTime}</Text>
            </View>
            <Ionicons name="time" size={24} color="#1d807c" />
          </View>
        </View>

        {/* Performance Scores */}
        <TouchableOpacity 
          style={[styles.fullBox, { backgroundColor: '#f4f3ff' }]}
          onPress={() => Alert.alert(
            'Score Explanations',
            'Safety: Based on braking, acceleration, speeding, and phone usage\n\nEco: Measures fuel efficiency and smooth driving\n\nAdherence: How well you follow speed limits\n\nSmooth: Consistency in speed and gentle maneuvers'
          )}
        >
          <View style={styles.textPart}>
            <Text style={styles.boxTitle}>Performance Scores</Text>
            <View style={styles.scoresGrid}>
              {['safety', 'eco', 'adherence', 'smooth'].map((scoreType) => (
                <View key={scoreType} style={styles.scoreItem}>
                  <View style={[styles.scoreCircle, { borderColor: getScoreColor(data.scores[scoreType]) }]}>
                    <Text style={[styles.scoreValue, { color: getScoreColor(data.scores[scoreType]) }]}>
                      {data.scores[scoreType]}
                    </Text>
                  </View>
                  <Text style={styles.scoreLabel}>
                    {scoreType.charAt(0).toUpperCase() + scoreType.slice(1)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <Ionicons name="information-circle" size={24} color="#1d807c" />
        </TouchableOpacity>

        {/* Safety Trends Chart */}
        {data.trends.safety.some(score => score > 0) ? (
          <TouchableOpacity 
            style={[styles.fullBox, { backgroundColor: '#fff3f8' }]}
            onPress={() => Alert.alert(
              'Safety Score Trend',
              'Shows your safety score over the selected time period.\n\nHigher scores indicate safer driving habits.'
            )}
          >
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>
                Safety Score Trend • {timeRange === 'week' ? 'Last 7 Days' : timeRange === 'month' ? 'Last 4 Weeks' : 'Last 6 Months'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <LineChart
                  data={{
                    labels: data.trends.labels,
                    datasets: [{
                      data: data.trends.safety,
                      color: (opacity = 1) => `rgba(29, 128, 124, ${opacity})`,
                      strokeWidth: 2
                    }],
                  }}
                  width={Math.max(Dimensions.get('window').width - 80, data.trends.labels.length * 50)}
                  height={180}
                  chartConfig={{
                    backgroundColor: '#ffffff',
                    backgroundGradientFrom: '#ffffff',
                    backgroundGradientTo: '#ffffff',
                    decimalPlaces: 0,
                    color: (opacity = 1) => `rgba(29, 128, 124, ${opacity})`,
                    labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`,
                    style: {
                      borderRadius: 16,
                    },
                    propsForDots: {
                      r: "6",
                      strokeWidth: "2",
                      stroke: "#1d807c"
                    },
                    propsForBackgroundLines: {
                      strokeDasharray: "",
                      stroke: '#e2e8f0',
                      strokeWidth: 1
                    },
                    propsForLabels: {
                      fontSize: 12,
                      fontWeight: 'bold'
                    }
                  }}
                  bezier
                  style={styles.chart}
                  withInnerLines={true}
                  withOuterLines={true}
                  withVerticalLines={true}
                  withHorizontalLines={true}
                  withShadow={true}
                  fromZero={false}
                  yAxisSuffix=""
                  yAxisInterval={1}
                  segments={4}
                  formatYLabel={(value) => Math.round(parseInt(value)).toString()}
                />
              </ScrollView>
            </View>
            <Ionicons name="stats-chart" size={24} color="#1d807c" />
          </TouchableOpacity>
        ) : (
          <View style={[styles.fullBox, { backgroundColor: '#fff3f8' }]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Safety Score Trend</Text>
              <Text style={styles.noDataText}>No trip data available for this period</Text>
            </View>
            <Ionicons name="stats-chart" size={24} color="#1d807c" />
          </View>
        )}

        {/* Behavioral Metrics */}
        <TouchableOpacity 
          style={[styles.fullBox, { backgroundColor: '#f3fff7' }]}
          onPress={() => Alert.alert(
            'Behavioral Metrics',
            'These metrics show your driving habits per trip:\n\n• Hard Brakes: Sudden stops\n• Rapid Acceleration: Quick starts\n• Speeding: Exceeding speed limits\n• Phone Usage: Phone interactions while driving'
          )}
        >
          <View style={styles.textPart}>
            <Text style={styles.boxTitle}>Behavioral Metrics</Text>
            <View style={styles.behaviorGrid}>
              <View style={styles.behaviorItem}>
                <Ionicons name="hand-left-outline" size={20} color="#ef4444" />
                <Text style={styles.behaviorValue}>{data.behavior.perTrip.hardBrakes}</Text>
                <Text style={styles.behaviorLabel}>Hard Brakes/Trip</Text>
              </View>
              <View style={styles.behaviorItem}>
                <Ionicons name="flash-outline" size={20} color="#f59e0b" />
                <Text style={styles.behaviorValue}>{data.behavior.perTrip.rapidAccels}</Text>
                <Text style={styles.behaviorLabel}>Rapid Accel/Trip</Text>
              </View>
              <View style={styles.behaviorItem}>
                <Ionicons name="speedometer-outline" size={20} color="#3b82f6" />
                <Text style={styles.behaviorValue}>{data.behavior.perTrip.speeding}</Text>
                <Text style={styles.behaviorLabel}>Speeding/Trip</Text>
              </View>
              <View style={styles.behaviorItem}>
                <Ionicons name="phone-portrait-outline" size={20} color="#8b5cf6" />
                <Text style={styles.behaviorValue}>{data.behavior.phoneUsage}</Text>
                <Text style={styles.behaviorLabel}>Phone Usage</Text>
              </View>
            </View>
          </View>
          <Ionicons name="analytics" size={24} color="#1d807c" />
        </TouchableOpacity>

        {/* Quick Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity 
            style={[styles.actionBox, { backgroundColor: '#f3f6ff' }]} 
            onPress={shareProgress}
          >
            <Ionicons name="share-social" size={24} color="#1d807c" />
            <Text style={styles.actionText}>Share Progress</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.actionBox, { backgroundColor: '#f3f9f4' }]} 
            onPress={() => handleNavigation('TripLogger')}
          >
            <Ionicons name="car" size={24} color="#1d807c" />
            <Text style={styles.actionText}>Start New Trip</Text>
          </TouchableOpacity>
        </View>

        {/* Last Updated */}
        <Text style={styles.lastUpdated}>
          Last updated: {new Date(data.lastUpdated).toLocaleString()}
        </Text>
      </ScrollView>

      {/* Footer Navigation */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity onPress={() => handleNavigation('DriverDashboard')}>
            <Ionicons name="home" size={28} color="#fff" />
          </TouchableOpacity>
          
          {/* Mic Button */}
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
                <Text style={styles.example}>• "Go to dashboard" or "Open settings"</Text>
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
  mainContainer: { 
    flex: 1, 
    backgroundColor: '#fff' 
  },
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
  scrollContainer: { 
    paddingBottom: 120 
  },
  
  // Header Styles
  headerWrapper: { 
    position: 'relative', 
    backgroundColor: '#1d807c' 
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
    width: width,
    height: 30,
    backgroundColor: '#fff',
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    marginTop: -10,
  },
  headerTitle: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: '#fff' 
  },
  subTitle: { 
    fontSize: 14, 
    color: '#fff', 
    marginTop: 2 
  },
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
    backgroundColor: '#1d807c',
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
  
  // Time Range Selector
  timeRangeContainer: {
    flexDirection: 'row',
    marginHorizontal: 18,
    marginTop: 20,
    marginBottom: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 4,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  timeRangeActive: {
    backgroundColor: '#1d807c',
  },
  timeRangeText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  timeRangeTextActive: {
    color: '#fff',
  },
  
  // Box and Row Styles
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  box: {
    flex: 1,
    marginHorizontal: 4,
    padding: 16,
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 80,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
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
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  textPart: { 
    flex: 1, 
    alignItems: 'flex-start' 
  },
  boxTitle: {
    fontSize: 14,
    color: '#555',
    fontWeight: '600',
    marginBottom: 8,
  },
  boxValue: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: '#1d807c' 
  },
  
  // Comparison Styles
  comparisonGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  comparisonItem: {
    flex: 1,
    alignItems: 'center',
  },
  comparisonLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 4,
  },
  comparisonValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  comparisonValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1d807c',
  },
  comparisonChange: {
    fontSize: 10,
    fontWeight: '600',
  },
  
  // Scores Styles
  scoresGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    flexWrap: 'wrap',
  },
  scoreItem: {
    alignItems: 'center',
    width: '25%',
  },
  scoreCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 4,
  },
  scoreValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  scoreLabel: {
    fontSize: 10,
    color: '#64748b',
    textAlign: 'center',
  },
  
  // Chart Styles
  chart: {
    marginVertical: 8,
    borderRadius: 16,
    paddingRight: 20,
  },
  
  // Behavior Grid
  behaviorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  behaviorItem: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  behaviorValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1d807c',
    marginTop: 4,
  },
  behaviorLabel: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
    textAlign: 'center',
  },
  
  // Improvement Areas
  improvementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  improvementIcon: {
    marginRight: 8,
  },
  improvementText: {
    flex: 1,
  },
  improvementTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2,
  },
  improvementDesc: {
    fontSize: 12,
    color: '#64748b',
  },
  priorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
  },
  priorityText: {
    fontSize: 8,
    color: '#fff',
    fontWeight: 'bold',
  },
  
  // Actions Row
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 18,
    marginBottom: 16,
  },
  actionBox: {
    flex: 1,
    marginHorizontal: 6,
    padding: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  actionText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#1d807c',
    textAlign: 'center',
  },
  
  // Last Updated
  lastUpdated: {
    textAlign: 'center',
    fontSize: 10,
    color: '#94a3b8',
    marginBottom: 20,
    marginTop: 8,
  },
  
  // No Data Text
  noDataText: {
    fontSize: 14,
    color: '#94a3b8',
    fontStyle: 'italic',
    marginTop: 8,
  },
  
  // Footer Navigation
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
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
});

export default AnalyticsScreen;