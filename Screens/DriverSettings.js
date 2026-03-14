import React, { useState, useEffect, useCallback, useRef } from "react";
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
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from "react-native";
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { getAuth, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { doc, getDoc, updateDoc, serverTimestamp, collection, addDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';

// Import emergency functions
import { 
  subscribeToEmergency, 
  cancelGlobalEmergency,
  globalEmergencyState 
} from './Emergency';

// Import voice command service
import voiceCommandService from '../src/voice/VoiceCommandService';

const DriverSettingsScreen = ({ navigation }) => {
  const auth = getAuth();
  const user = auth.currentUser;

  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userData, setUserData] = useState(null);
  
  // Emergency states
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState(null);
  const [emergencyCountdown, setEmergencyCountdown] = useState(10);
  
  // Voice Command States
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [isVoiceModelLoaded, setIsVoiceModelLoaded] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [voiceConfidence, setVoiceConfidence] = useState(0);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [voiceCommandHistory, setVoiceCommandHistory] = useState([]);
  const [voiceServiceStatus, setVoiceServiceStatus] = useState('initializing');
  
  // Voice animation refs
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimerRef = useRef(null);
  const pulseAnimationRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const isHoldingMicRef = useRef(false);
  const micButtonRef = useRef(null);

  // Profile State
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    profileImage: "",
    licenseNumber: "",
    vehicleType: "",
    vehicleNumber: "",
  });

  // Security State
  const [security, setSecurity] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });

  // Modals
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showImagePickerModal, setShowImagePickerModal] = useState(false);

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

  // ✅ Initialize voice command service
  const initializeVoiceCommandService = useCallback(async () => {
    try {
      console.log('Initializing voice command service...');
      setVoiceServiceStatus('initializing');
      
      // Request audio permissions
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
    
    Speech.stop();
    
    Speech.speak(message, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.9,
      onDone: () => {},
      onStopped: () => {},
      onError: () => {},
    });
  }, [isVoiceEnabled]);

  // ✅ Handle emergency cancellation
  const handleCancelEmergency = async () => {
    try {
      cancelGlobalEmergency();
      
      // Also update user status in database
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          emergencyStatus: 'cancelled',
          updatedAt: new Date().toISOString()
        });
        
        // Log safe response
        await addDoc(collection(db, "emergency_logs"), {
          userId: user.uid,
          type: 'CANCELLED_FROM_SETTINGS',
          message: 'User cancelled emergency from settings screen',
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
      case 'test emergency':
      case 'trigger emergency':
      case 'simulate emergency':
      case 'emergency test':
        response = 'Testing emergency system. Please verify in emergency dashboard.';
        action = () => {
          if (navigation) {
            navigation.navigate('Emergency', { 
              triggerEmergency: true,
              voiceCommand: command,
              isTest: true
            });
          }
        };
        success = true;
        break;
        
      case 'cancel emergency':
      case 'stop emergency':
      case 'emergency off':
        if (emergencyActive) {
          response = 'Cancelling emergency alert.';
          action = () => {
            handleCancelEmergency();
            speakQuickAlert('Emergency cancelled successfully.');
          };
          success = true;
        } else {
          response = 'No active emergency to cancel.';
          success = false;
        }
        break;
        
      case 'go to settings':
      case 'open settings':
      case 'settings':
      case 'driver settings':
        response = 'You are already in settings.';
        success = false;
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
        
      case 'profile':
      case 'my profile':
        response = 'Switching to profile tab.';
        action = () => {
          setActiveTab('profile');
        };
        success = true;
        break;
        
      case 'security':
      case 'password':
      case 'change password':
        response = 'Switching to security tab.';
        action = () => {
          setActiveTab('security');
          setShowPasswordModal(true);
        };
        success = true;
        break;
        
      case 'save profile':
      case 'update profile':
        response = 'Saving profile information.';
        action = async () => {
          await saveProfile();
          if (isVoiceEnabled) {
            speakQuickAlert('Profile saved successfully.');
          }
        };
        success = true;
        break;
        
      default:
        response = `Command "${command}" not recognized. Try: "test emergency", "cancel emergency", "profile", or "security".`;
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
  }, [navigation, isVoiceEnabled, speakQuickAlert, emergencyActive, handleCancelEmergency, speakNavigationFeedback]);

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
  }, [executeVoiceCommand, stopPulseAnimation, cleanupTimers]);

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

  // Handle navigation with voice feedback
  const handleNavigation = useCallback((screenName) => {
    if (isVoiceEnabled) {
      speakNavigationFeedback(screenName);
    }
    
    setTimeout(() => {
      navigation.navigate(screenName);
    }, 800);
  }, [navigation, isVoiceEnabled, speakNavigationFeedback]);

  // Fetch user data
  const fetchUserData = async () => {
    if (!user) {
      navigation.navigate("Login");
      return;
    }

    setLoading(true);
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserData(data);
        
        setProfile({
          name: data.name || data.fullName || user.displayName || "",
          email: user.email || "",
          phone: data.phone || data.phoneNumber || "",
          profileImage: data.profileImage || data.photoURL || "",
          licenseNumber: data.driverProfile?.licenseNumber || data.licenseNumber || "",
          vehicleType: data.driverProfile?.vehicleType || data.vehicleType || "",
          vehicleNumber: data.driverProfile?.vehicleNumber || data.vehicleNumber || "",
        });

        // Set voice enabled from user settings
        setIsVoiceEnabled(data.voiceCommands !== false);
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
      Alert.alert("Error", "Failed to load profile data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserData();
    initializeVoiceCommandService();
    
    return () => {
      Speech.stop();
      voiceCommandService.cleanup();
      stopPulseAnimation();
    };
  }, []);

  // Validation functions
  const validateLicenseNumber = (license) => {
    if (!license || license.trim() === "") return "License number is required";
    return "";
  };

  const validateVehicleNumber = (vehicle) => {
    if (!vehicle || vehicle.trim() === "") return "Vehicle number is required";
    return "";
  };

  // Profile Picture Management
  const pickImage = async (source) => {
    try {
      let result;
      
      if (source === 'camera') {
        const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
        if (!permissionResult.granted) {
          Alert.alert("Permission Required", "Camera permission is required to take photos.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      } else {
        const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permissionResult.granted) {
          Alert.alert("Permission Required", "Gallery access is required to select photos.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        setProfile(prev => ({ ...prev, profileImage: imageUri }));
        setShowImagePickerModal(false);
        
        // Save profile picture immediately to database
        await saveProfileImage(imageUri);
      }
    } catch (error) {
      console.error("Error picking image:", error);
      Alert.alert("Error", "Failed to update profile picture");
    }
  };

  // Save profile image to database
  const saveProfileImage = async (imageUri) => {
    if (!user) return;

    setSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        profileImage: imageUri,
        updatedAt: serverTimestamp()
      });
      
      Alert.alert("Success", "Profile picture updated successfully!");
    } catch (error) {
      console.error("Error saving profile image:", error);
      Alert.alert("Error", "Failed to update profile picture");
    } finally {
      setSaving(false);
    }
  };

  // Profile Management
  const handleProfileChange = (field, value) => {
    let formattedValue = value;
    
    if (field === 'licenseNumber') {
      formattedValue = value.toUpperCase().replace(/\s/g, '');
    }
    
    if (field === 'vehicleNumber') {
      formattedValue = value.toUpperCase().replace(/\s/g, '');
    }
    
    setProfile(prev => ({
      ...prev,
      [field]: formattedValue
    }));
  };

  const saveProfile = async () => {
    if (!user) return;

    const licenseError = validateLicenseNumber(profile.licenseNumber);
    const vehicleError = validateVehicleNumber(profile.vehicleNumber);
    
    if (licenseError || vehicleError) {
      Alert.alert("Validation Error", licenseError || vehicleError);
      return;
    }

    setSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      
      // Prepare update data with proper field mapping
      const updateData = {
        name: profile.name,
        phone: profile.phone,
        profileImage: profile.profileImage,
        licenseNumber: profile.licenseNumber,
        vehicleType: profile.vehicleType,
        vehicleNumber: profile.vehicleNumber,
        updatedAt: serverTimestamp()
      };

      // If driverProfile exists in your schema, update both
      if (userData?.driverProfile) {
        updateData.driverProfile = {
          licenseNumber: profile.licenseNumber,
          vehicleType: profile.vehicleType,
          vehicleNumber: profile.vehicleNumber,
        };
      }

      await updateDoc(userRef, updateData);
      Alert.alert("Success", "Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      Alert.alert("Error", "Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Security Management
  const handleSecurityChange = (field, value) => {
    setSecurity(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const updatePasswordHandler = async () => {
    if (!user) return;

    if (security.newPassword !== security.confirmPassword) {
      Alert.alert("Error", "New passwords don't match");
      return;
    }

    if (security.newPassword.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters long");
      return;
    }

    setSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, security.currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, security.newPassword);
      
      Alert.alert("Success", "Password updated successfully!");
      setSecurity({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setShowPasswordModal(false);
    } catch (error) {
      console.error("Error updating password:", error);
      if (error.code === 'auth/wrong-password') {
        Alert.alert("Error", "Current password is incorrect");
      } else if (error.code === 'auth/weak-password') {
        Alert.alert("Error", "Password is too weak");
      } else {
        Alert.alert("Error", "Failed to update password");
      }
    } finally {
      setSaving(false);
    }
  };

  // Test emergency system
  const testEmergencySystem = () => {
    Alert.alert(
      "Test Emergency System",
      "This will trigger a test emergency to verify the system is working properly. No real emergency services will be contacted.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Test Emergency", 
          onPress: () => {
            navigation.navigate('Emergency', { 
              triggerEmergency: true,
              isTest: true 
            });
          }
        }
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Logout", 
          style: "destructive",
          onPress: async () => {
            try {
              await auth.signOut();
              navigation.replace("Login");
            } catch (error) {
              console.error("Error signing out:", error);
            }
          }
        }
      ]
    );
  };

  const getProfileImage = () => {
    return profile.profileImage || null;
  };

  const getUserName = () => {
    return profile.name || 'Driver';
  };

  if (loading) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.headerWrapper}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.headerTitle}>Drivemate</Text>
              <Text style={styles.subTitle}>Settings</Text>
            </View>
          </View>
          <View style={styles.curve} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1d807c" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </View>
    );
  }

  // Button disabled states
  const isProfileSaveDisabled = saving;
  const isPasswordUpdateDisabled = saving || 
    !security.currentPassword || 
    !security.newPassword || 
    !security.confirmPassword ||
    security.newPassword !== security.confirmPassword ||
    security.newPassword.length < 6;

  return (
    <KeyboardAvoidingView 
      style={styles.mainContainer}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.mainContainer}>
        {/* EMERGENCY ALERT AT TOP */}
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
              <Text style={styles.subTitle}>Settings</Text>
            </View>

            <View style={styles.profileWrapper}>
              {getProfileImage() ? (
                <Image source={{ uri: getProfileImage() }} style={styles.profileImage} />
              ) : (
                <View style={styles.profileImagePlaceholder}>
                  <Ionicons name="person" size={20} color="#1d807c" />
                </View>
              )}
              <Text style={styles.profileName} numberOfLines={1}>
                {getUserName()}
              </Text>
            </View>
          </View>
          <View style={styles.curve} />
        </View>

        {/* VOICE COMMAND HISTORY */}
        {voiceCommandHistory.length > 0 && (
          <View style={[styles.fullBox, styles.voiceHistoryBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>VOICE COMMANDS</Text>
              {voiceCommandHistory.slice(0, 2).map((item, index) => (
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
            <TouchableOpacity onPress={() => setShowVoiceModal(true)}>
              <Ionicons name="mic" size={24} color="#1D807C" />
            </TouchableOpacity>
          </View>
        )}

        {/* CONTENT */}
        <ScrollView 
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Settings Navigation - Only Profile and Security tabs remain */}
          <View style={styles.tabContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity 
                style={[styles.tab, activeTab === "profile" && styles.activeTab]}
                onPress={() => setActiveTab("profile")}
              >
                <Ionicons 
                  name="person" 
                  size={20} 
                  color={activeTab === "profile" ? "#fff" : "#1d807c"} 
                />
                <Text style={[styles.tabText, activeTab === "profile" && styles.activeTabText]}>
                  Profile
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.tab, activeTab === "security" && styles.activeTab]}
                onPress={() => setActiveTab("security")}
              >
                <Ionicons 
                  name="lock-closed" 
                  size={20} 
                  color={activeTab === "security" ? "#fff" : "#1d807c"} 
                />
                <Text style={[styles.tabText, activeTab === "security" && styles.activeTabText]}>
                  Security
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.tab, activeTab === "emergency" && styles.activeTab]}
                onPress={() => setActiveTab("emergency")}
              >
                <Ionicons 
                  name="alert-circle" 
                  size={20} 
                  color={activeTab === "emergency" ? "#fff" : "#1d807c"} 
                />
                <Text style={[styles.tabText, activeTab === "emergency" && styles.activeTabText]}>
                  Emergency
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Profile Settings */}
          {activeTab === "profile" && (
            <View style={styles.section}>
              {/* Profile Picture Section */}
              <View style={styles.profilePictureSection}>
                <View style={styles.profileImageContainer}>
                  {profile.profileImage ? (
                    <Image source={{ uri: profile.profileImage }} style={styles.largeProfileImage} />
                  ) : (
                    <View style={styles.largeProfileImagePlaceholder}>
                      <Ionicons name="person" size={40} color="#1d807c" />
                    </View>
                  )}
                </View>
                <TouchableOpacity 
                  style={styles.imageActionButton}
                  onPress={() => setShowImagePickerModal(true)}
                >
                  <Ionicons name="camera" size={18} color="#1d807c" />
                  <Text style={styles.imageActionText}>Change Photo</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    value={profile.name}
                    onChangeText={(text) => handleProfileChange("name", text)}
                    placeholder="Enter your full name"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Email Address</Text>
                  <TextInput
                    style={[styles.input, styles.disabledInput]}
                    value={profile.email}
                    placeholder="Your email address"
                    editable={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Phone Number</Text>
                  <TextInput
                    style={styles.input}
                    value={profile.phone}
                    onChangeText={(text) => handleProfileChange("phone", text)}
                    placeholder="Enter your phone number"
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>License Number</Text>
                  <TextInput
                    style={styles.input}
                    value={profile.licenseNumber}
                    onChangeText={(text) => handleProfileChange("licenseNumber", text)}
                    placeholder="Enter your license number"
                    autoCapitalize="characters"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Vehicle Type</Text>
                  <View style={styles.vehicleOptions}>
                    {["Sedan", "SUV", "Hatchback", "Motorcycle"].map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.vehicleOption,
                          profile.vehicleType === type.toLowerCase() && styles.selectedVehicleOption
                        ]}
                        onPress={() => handleProfileChange("vehicleType", type.toLowerCase())}
                      >
                        <Text style={[
                          styles.vehicleOptionText,
                          profile.vehicleType === type.toLowerCase() && styles.selectedVehicleOptionText
                        ]}>
                          {type}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Vehicle Number</Text>
                  <TextInput
                    style={styles.input}
                    value={profile.vehicleNumber}
                    onChangeText={(text) => handleProfileChange("vehicleNumber", text)}
                    placeholder="Enter your vehicle number"
                    autoCapitalize="characters"
                  />
                </View>
              </View>

              <TouchableOpacity 
                style={[styles.saveButton, isProfileSaveDisabled && styles.disabledButton]}
                onPress={saveProfile}
                disabled={isProfileSaveDisabled}
              >
                <Ionicons name="save" size={20} color="#fff" />
                <Text style={styles.saveButtonText}>
                  {saving ? "Saving..." : "Save Profile"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Security Settings */}
          {activeTab === "security" && (
            <View style={styles.section}>
              <View style={styles.securityCards}>
                <TouchableOpacity 
                  style={styles.securityCard}
                  onPress={() => setShowPasswordModal(true)}
                >
                  <View style={styles.securityCardContent}>
                    <Ionicons name="key" size={24} color="#1d807c" />
                    <View style={styles.securityCardText}>
                      <Text style={styles.securityCardTitle}>Change Password</Text>
                      <Text style={styles.securityCardDescription}>
                        Update your account password
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#1d807c" />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.securityCard}
                  onPress={handleLogout}
                >
                  <View style={styles.securityCardContent}>
                    <Ionicons name="log-out" size={24} color="#ff6b6b" />
                    <View style={styles.securityCardText}>
                      <Text style={styles.securityCardTitle}>Logout</Text>
                      <Text style={styles.securityCardDescription}>
                        Sign out from your account
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#ff6b6b" />
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Emergency Settings - Removed Emergency Contacts Card */}
          {activeTab === "emergency" && (
            <View style={styles.section}>
              <View style={styles.emergencyCards}>
                <TouchableOpacity 
                  style={styles.emergencyCard}
                  onPress={testEmergencySystem}
                >
                  <View style={styles.emergencyCardContent}>
                    <Ionicons name="shield-checkmark" size={24} color="#1d807c" />
                    <View style={styles.emergencyCardText}>
                      <Text style={styles.emergencyCardTitle}>Test Emergency System</Text>
                      <Text style={styles.emergencyCardDescription}>
                        Verify emergency detection is working
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#1d807c" />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.emergencyCard}
                  onPress={() => handleNavigation('DriveMateDashboard')}
                >
                  <View style={styles.emergencyCardContent}>
                    <Ionicons name="alert-circle" size={24} color="#1d807c" />
                    <View style={styles.emergencyCardText}>
                      <Text style={styles.emergencyCardTitle}>Emergency Dashboard</Text>
                      <Text style={styles.emergencyCardDescription}>
                        View real-time emergency sensors
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#1d807c" />
                  </View>
                </TouchableOpacity>

                {emergencyActive && (
                  <TouchableOpacity 
                    style={[styles.emergencyCard, styles.cancelEmergencyCard]}
                    onPress={handleCancelEmergency}
                  >
                    <View style={styles.emergencyCardContent}>
                      <Ionicons name="close-circle" size={24} color="#e63946" />
                      <View style={styles.emergencyCardText}>
                        <Text style={[styles.emergencyCardTitle, { color: '#e63946' }]}>
                          Cancel Emergency ({emergencyCountdown}s)
                        </Text>
                        <Text style={[styles.emergencyCardDescription, { color: '#e63946' }]}>
                          Cancel the current emergency alert
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#e63946" />
                    </View>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.emergencyInfo}>
                <Text style={styles.emergencyInfoTitle}>Emergency System Status</Text>
                <View style={styles.emergencyStatusRow}>
                  <Ionicons 
                    name={emergencyActive ? "alert-circle" : "checkmark-circle"} 
                    size={20} 
                    color={emergencyActive ? "#e63946" : "#10B981"} 
                  />
                  <Text style={styles.emergencyStatusText}>
                    {emergencyActive ? "Emergency Active" : "System Normal"}
                  </Text>
                </View>
                <Text style={styles.emergencyInfoDescription}>
                  {emergencyActive 
                    ? "An emergency has been detected. Please check the emergency dashboard for details."
                    : "The emergency detection system is active and monitoring for any issues."}
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Password Change Modal */}
        <Modal visible={showPasswordModal} animationType="slide" transparent={true}>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Change Password</Text>
                <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              <View style={styles.modalForm}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Current Password</Text>
                  <TextInput
                    style={styles.input}
                    value={security.currentPassword}
                    onChangeText={(text) => handleSecurityChange("currentPassword", text)}
                    placeholder="Enter current password"
                    secureTextEntry
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>New Password</Text>
                  <TextInput
                    style={styles.input}
                    value={security.newPassword}
                    onChangeText={(text) => handleSecurityChange("newPassword", text)}
                    placeholder="Enter new password"
                    secureTextEntry
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Confirm New Password</Text>
                  <TextInput
                    style={styles.input}
                    value={security.confirmPassword}
                    onChangeText={(text) => handleSecurityChange("confirmPassword", text)}
                    placeholder="Confirm new password"
                    secureTextEntry
                  />
                </View>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={styles.modalCancel}
                  onPress={() => setShowPasswordModal(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.modalConfirm, isPasswordUpdateDisabled && styles.disabledButton]}
                  onPress={updatePasswordHandler}
                  disabled={isPasswordUpdateDisabled}
                >
                  <Text style={styles.modalConfirmText}>
                    {saving ? "Updating..." : "Update Password"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Image Picker Modal */}
        <Modal visible={showImagePickerModal} animationType="slide" transparent={true}>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Change Profile Picture</Text>
                <TouchableOpacity onPress={() => setShowImagePickerModal(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              <View style={styles.imagePickerOptions}>
                <TouchableOpacity 
                  style={styles.imagePickerOption}
                  onPress={() => pickImage('camera')}
                >
                  <Ionicons name="camera" size={24} color="#1d807c" />
                  <Text style={styles.imagePickerText}>Take Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.imagePickerOption}
                  onPress={() => pickImage('gallery')}
                >
                  <Ionicons name="images" size={24} color="#1d807c" />
                  <Text style={styles.imagePickerText}>Choose from Gallery</Text>
                </TouchableOpacity>
              </View>
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
                  <Text style={styles.example}>• "Test emergency" or "Cancel emergency"</Text>
                  <Text style={styles.example}>• "Profile" or "Security"</Text>
                  <Text style={styles.example}>• "Save profile" or "Update profile"</Text>
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
      </View>
    </KeyboardAvoidingView>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: '#fff' },
  scrollContainer: { paddingBottom: 120 },
  
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
  },
  profileName: {
    color: '#fff',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#1d807c',
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
  
  // Voice History Styles
  fullBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  voiceHistoryBox: {
    backgroundColor: '#f0f7f6',
    borderWidth: 1,
    borderColor: '#1d807c20',
  },
  textPart: { flex: 1, alignItems: 'flex-start' },
  boxTitle: {
    fontSize: 14,
    color: '#555',
    fontWeight: '600',
    marginBottom: 2,
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
    color: '#4B5563',
    marginBottom: 2,
  },
  voiceHistoryTranscription: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
    marginBottom: 2,
  },
  voiceHistoryTime: {
    fontSize: 11,
    color: '#6B7280',
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
  
  // Tab Navigation
  tabContainer: {
    paddingHorizontal: 16,
    marginVertical: 16,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginRight: 12,
    borderRadius: 25,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  activeTab: {
    backgroundColor: '#1d807c',
    borderColor: '#1d807c',
  },
  tabText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#1d807c',
  },
  activeTabText: {
    color: '#fff',
  },
  
  // Sections
  section: {
    marginBottom: 20,
  },
  
  // Profile Picture Section
  profilePictureSection: {
    alignItems: 'center',
    marginBottom: 20,
    padding: 16,
  },
  profileImageContainer: {
    marginBottom: 16,
  },
  largeProfileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#1d807c',
  },
  largeProfileImagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#1d807c',
    backgroundColor: '#e8f5e8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1d807c',
    gap: 6,
  },
  imageActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d807c',
  },
  
  // Form Styles
  form: {
    gap: 16,
    paddingHorizontal: 16,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
  },
  input: {
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  disabledInput: {
    backgroundColor: '#f8f9fa',
    color: '#6c757d',
  },
  
  // Vehicle Options
  vehicleOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vehicleOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  selectedVehicleOption: {
    backgroundColor: '#1d807c',
    borderColor: '#1d807c',
  },
  vehicleOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#495057',
  },
  selectedVehicleOptionText: {
    color: '#fff',
  },
  
  // Security Section
  securityCards: {
    gap: 12,
    paddingHorizontal: 16,
  },
  securityCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 16,
  },
  securityCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  securityCardText: {
    flex: 1,
    marginLeft: 12,
  },
  securityCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#495057',
    marginBottom: 4,
  },
  securityCardDescription: {
    fontSize: 14,
    color: '#6c757d',
  },
  
  // Emergency Section
  emergencyCards: {
    gap: 12,
    paddingHorizontal: 16,
  },
  emergencyCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 16,
  },
  cancelEmergencyCard: {
    backgroundColor: '#fff5f5',
  },
  emergencyCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emergencyCardText: {
    flex: 1,
    marginLeft: 12,
  },
  emergencyCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#495057',
    marginBottom: 4,
  },
  emergencyCardDescription: {
    fontSize: 14,
    color: '#6c757d',
  },
  emergencyInfo: {
    padding: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
  },
  emergencyInfoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#495057',
    marginBottom: 12,
  },
  emergencyStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  emergencyStatusText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  emergencyInfoDescription: {
    fontSize: 14,
    color: '#6c757d',
    lineHeight: 20,
  },
  
  // Buttons
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d807c',
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    marginHorizontal: 16,
    gap: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#6c757d',
  },
  
  // Modal
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1d807c',
  },
  modalForm: {
    gap: 16,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancel: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#6c757d',
    fontSize: 16,
    fontWeight: '600',
  },
  modalConfirm: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1d807c',
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  
  // Image Picker Options
  imagePickerOptions: {
    gap: 12,
  },
  imagePickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    gap: 12,
  },
  imagePickerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#495057',
  },
  
  // Footer
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

export default DriverSettingsScreen;