import React, { useState, useEffect, useCallback } from "react";
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
  Keyboard,
} from "react-native";
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { getAuth, updatePassword, reauthenticateWithCredential, EmailAuthProvider, signOut } from "firebase/auth";
import { 
  doc, 
  getDoc, 
  updateDoc,
  serverTimestamp,
  setDoc 
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import * as ImageManipulator from 'expo-image-manipulator';

const FamilySettingsScreen = ({ navigation }) => {
  const auth = getAuth();
  const user = auth.currentUser;

  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userData, setUserData] = useState(null);
  const [initialProfile, setInitialProfile] = useState(null);
  const [initialPreferences, setInitialPreferences] = useState(null);

  // Profile State
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    profileImage: "",
  });

  // Validation errors
  const [validationErrors, setValidationErrors] = useState({
    phone: "",
  });

  // Security State
  const [security, setSecurity] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });

  // Password strength indicators
  const [passwordStrength, setPasswordStrength] = useState({
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    special: false,
  });

  // Preferences State - COMPLETE with all alert types
  const [preferences, setPreferences] = useState({
    // Emergency & Safety Alerts
    emergencyAlerts: true,
    safetyAlerts: true,
    impactAlerts: true,
    manualTriggerAlerts: true,
    
    // Driving Behavior Alerts
    speedAlerts: true,
    harshBrakingAlerts: true,
    rapidAccelAlerts: true,
    drivingScoreAlerts: true,
    
    // Location & Trip Alerts
    locationAlerts: true,
    geoFenceAlerts: true,
    boundaryAlerts: true,
    tripUpdates: true,
    
    // Other Alerts
    driverAlerts: true,
    voiceCommandAlerts: true,
  });

  // Modals
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showImagePickerModal, setShowImagePickerModal] = useState(false);

  // Check if profile has changes
  const hasProfileChanges = useCallback(() => {
    if (!initialProfile) return false;
    
    return (
      profile.name !== initialProfile.name ||
      profile.phone !== initialProfile.phone ||
      profile.address !== initialProfile.address ||
      profile.profileImage !== initialProfile.profileImage
    );
  }, [profile, initialProfile]);

  // Check if preferences have changes
  const hasPreferenceChanges = useCallback(() => {
    if (!initialPreferences) return false;
    
    return Object.keys(preferences).some(key => 
      preferences[key] !== initialPreferences[key]
    );
  }, [preferences, initialPreferences]);

  // Fetch user data from Firestore
  const fetchUserData = useCallback(async () => {
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
        
        // Set profile data
        const profileData = {
          name: data.name || data.fullName || user.displayName || "",
          email: user.email || "",
          phone: data.phone || data.phoneNumber || "",
          address: data.address || "",
          profileImage: data.profileImage || data.photoURL || "",
        };
        
        // Set preferences with proper fallbacks - CHECK EACH FIELD
        const preferenceData = {
          // Emergency & Safety Alerts
          emergencyAlerts: data.emergencyAlerts !== false,
          safetyAlerts: data.safetyAlerts !== false,
          impactAlerts: data.impactAlerts !== false,
          manualTriggerAlerts: data.manualTriggerAlerts !== false,
          
          // Driving Behavior Alerts
          speedAlerts: data.speedAlerts !== false,
          harshBrakingAlerts: data.harshBrakingAlerts !== false,
          rapidAccelAlerts: data.rapidAccelAlerts !== false,
          drivingScoreAlerts: data.drivingScoreAlerts !== false,
          
          // Location & Trip Alerts
          locationAlerts: data.locationAlerts !== false,
          geoFenceAlerts: data.geoFenceAlerts !== false,
          boundaryAlerts: data.boundaryAlerts !== false,
          tripUpdates: data.tripUpdates !== false,
          
          // Other Alerts
          driverAlerts: data.driverAlerts !== false,
          voiceCommandAlerts: data.voiceCommandAlerts !== false,
        };
        
        setProfile(profileData);
        setPreferences(preferenceData);
        setInitialProfile(profileData);
        setInitialPreferences(preferenceData);
      } else {
        // Create user document if it doesn't exist with ALL default preferences
        const userRef = doc(db, "users", user.uid);
        const defaultPreferences = {
          // Emergency & Safety Alerts
          emergencyAlerts: true,
          safetyAlerts: true,
          impactAlerts: true,
          manualTriggerAlerts: true,
          
          // Driving Behavior Alerts
          speedAlerts: true,
          harshBrakingAlerts: true,
          rapidAccelAlerts: true,
          drivingScoreAlerts: true,
          
          // Location & Trip Alerts
          locationAlerts: true,
          geoFenceAlerts: true,
          boundaryAlerts: true,
          tripUpdates: true,
          
          // Other Alerts
          driverAlerts: true,
          voiceCommandAlerts: true,
          
          // Basic info
          name: user.displayName || "",
          email: user.email || "",
          phone: "",
          address: "",
          profileImage: "",
          photoURL: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        
        await setDoc(userRef, defaultPreferences);
        
        // Set state with default values
        setProfile({
          name: user.displayName || "",
          email: user.email || "",
          phone: "",
          address: "",
          profileImage: "",
        });
        
        setPreferences({
          emergencyAlerts: true,
          safetyAlerts: true,
          impactAlerts: true,
          manualTriggerAlerts: true,
          speedAlerts: true,
          harshBrakingAlerts: true,
          rapidAccelAlerts: true,
          drivingScoreAlerts: true,
          locationAlerts: true,
          geoFenceAlerts: true,
          boundaryAlerts: true,
          tripUpdates: true,
          driverAlerts: true,
          voiceCommandAlerts: true,
        });
        
        setInitialProfile({
          name: user.displayName || "",
          email: user.email || "",
          phone: "",
          address: "",
          profileImage: "",
        });
        
        setInitialPreferences({
          emergencyAlerts: true,
          safetyAlerts: true,
          impactAlerts: true,
          manualTriggerAlerts: true,
          speedAlerts: true,
          harshBrakingAlerts: true,
          rapidAccelAlerts: true,
          drivingScoreAlerts: true,
          locationAlerts: true,
          geoFenceAlerts: true,
          boundaryAlerts: true,
          tripUpdates: true,
          driverAlerts: true,
          voiceCommandAlerts: true,
        });
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
      Alert.alert("Error", "Failed to load profile data");
    } finally {
      setLoading(false);
    }
  }, [user, navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchUserData();
    });

    return unsubscribe;
  }, [navigation, fetchUserData]);

  // Validate 11-digit phone number
  const validatePhoneNumber = useCallback((phone) => {
    const digits = phone.replace(/\D/g, '');
    if (!digits) return ""; // Empty is valid (optional field)
    
    const phoneRegex = /^[0-9]{11}$/;
    if (!phoneRegex.test(digits)) return "Phone number must be exactly 11 digits";
    
    return "";
  }, []);

  // Validate password strength
  const validatePasswordStrength = useCallback((password) => {
    const strength = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };
    setPasswordStrength(strength);
    return strength;
  }, []);

  const getPasswordStrengthScore = useCallback((strength) => {
    const requirements = Object.values(strength);
    const metRequirements = requirements.filter(Boolean).length;
    return (metRequirements / requirements.length) * 100;
  }, []);

  const getPasswordStrengthText = useCallback((strength) => {
    const score = getPasswordStrengthScore(strength);
    if (score < 40) return { text: "Weak", color: "#ff6b6b" };
    if (score < 70) return { text: "Fair", color: "#ffa726" };
    if (score < 90) return { text: "Good", color: "#42a5f5" };
    return { text: "Strong", color: "#4caf50" };
  }, [getPasswordStrengthScore]);

  // Compress image before saving
  const compressImage = async (uri) => {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 500 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      return result.uri;
    } catch (error) {
      console.error("Error compressing image:", error);
      return uri;
    }
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
        setShowImagePickerModal(false);
        
        // Show loading indicator
        setSaving(true);
        
        // Compress image
        const compressedUri = await compressImage(result.assets[0].uri);
        
        // Update profile state
        setProfile(prev => ({ ...prev, profileImage: compressedUri }));
        
        // Save to database immediately
        await saveProfileImage(compressedUri);
      }
    } catch (error) {
      console.error("Error picking image:", error);
      Alert.alert("Error", "Failed to update profile picture");
      setSaving(false);
    }
  };

  // Save profile image to database
  const saveProfileImage = async (imageUri) => {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        profileImage: imageUri,
        photoURL: imageUri,
        updatedAt: serverTimestamp()
      });
      
      // Update initial state
      setInitialProfile(prev => ({ ...prev, profileImage: imageUri }));
      
      Alert.alert("Success", "Profile picture updated successfully!");
    } catch (error) {
      console.error("Error saving profile image:", error);
      Alert.alert("Error", "Failed to update profile picture");
    } finally {
      setSaving(false);
    }
  };

  // Profile Management
  const handleProfileChange = useCallback((field, value) => {
    let formattedValue = value;
    
    if (field === 'phone') {
      // Remove non-digits and limit to 11 digits
      formattedValue = value.replace(/\D/g, '').slice(0, 11);
      const error = validatePhoneNumber(formattedValue);
      setValidationErrors(prev => ({ ...prev, phone: error }));
    }
    
    setProfile(prev => ({
      ...prev,
      [field]: formattedValue
    }));
  }, [validatePhoneNumber]);

  const validateProfile = useCallback(() => {
    const phoneError = profile.phone ? validatePhoneNumber(profile.phone) : "";
    setValidationErrors({ phone: phoneError });
    return !phoneError;
  }, [profile.phone, validatePhoneNumber]);

  const saveProfile = useCallback(async () => {
    if (!user) return;

    if (!validateProfile()) {
      Alert.alert("Validation Error", "Please fix the errors in the form before saving.");
      return;
    }

    if (!hasProfileChanges()) {
      Alert.alert("No Changes", "No changes detected in profile information.");
      return;
    }

    setSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      const updateData = {
        name: profile.name.trim() || "",
        fullName: profile.name.trim() || "",
        phone: profile.phone || "",
        phoneNumber: profile.phone || "",
        address: profile.address.trim() || "",
        profileImage: profile.profileImage || "",
        updatedAt: serverTimestamp()
      };

      await updateDoc(userRef, updateData);
      
      setInitialProfile(profile);
      setUserData(prev => ({ ...prev, ...updateData }));
      
      Alert.alert("Success", "Profile updated successfully!");
      Keyboard.dismiss();
    } catch (error) {
      console.error("Error saving profile:", error);
      Alert.alert("Error", "Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [user, profile, validateProfile, hasProfileChanges]);

  // Security Management
  const handleSecurityChange = useCallback((field, value) => {
    setSecurity(prev => ({
      ...prev,
      [field]: value
    }));

    if (field === 'newPassword') {
      validatePasswordStrength(value);
    }
  }, [validatePasswordStrength]);

  const updatePasswordHandler = useCallback(async () => {
    if (!user) return;

    // Validate inputs
    if (!security.currentPassword) {
      Alert.alert("Error", "Please enter your current password");
      return;
    }

    if (!security.newPassword) {
      Alert.alert("Error", "Please enter a new password");
      return;
    }

    if (security.newPassword !== security.confirmPassword) {
      Alert.alert("Error", "New passwords don't match");
      return;
    }

    const strength = validatePasswordStrength(security.newPassword);
    const strengthScore = getPasswordStrengthScore(strength);

    if (security.newPassword.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters long");
      return;
    }

    if (strengthScore < 60) {
      Alert.alert(
        "Weak Password", 
        "Please choose a stronger password (include uppercase, lowercase, number, and special character)",
        [{ text: "OK" }]
      );
      return;
    }

    setSaving(true);
    try {
      // Re-authenticate user
      const credential = EmailAuthProvider.credential(
        user.email, 
        security.currentPassword
      );
      await reauthenticateWithCredential(user, credential);
      
      // Update password
      await updatePassword(user, security.newPassword);
      
      // Log password change in database
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        lastPasswordChange: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      Alert.alert("Success", "Password updated successfully!");
      setSecurity({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordStrength({
        length: false,
        uppercase: false,
        lowercase: false,
        number: false,
        special: false,
      });
      setShowPasswordModal(false);
      Keyboard.dismiss();
    } catch (error) {
      console.error("Error updating password:", error);
      if (error.code === 'auth/wrong-password') {
        Alert.alert("Error", "Current password is incorrect");
      } else if (error.code === 'auth/weak-password') {
        Alert.alert("Error", "Password is too weak. Please use a stronger password.");
      } else if (error.code === 'auth/requires-recent-login') {
        Alert.alert("Error", "Please login again to change your password");
      } else {
        Alert.alert("Error", "Failed to update password. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }, [user, security, validatePasswordStrength, getPasswordStrengthScore]);

  // Preferences Management
  const handlePreferenceChange = useCallback((field, value) => {
    setPreferences(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);

  // Save ALL preferences to Firebase
  const savePreferences = useCallback(async () => {
    if (!user) return;

    if (!hasPreferenceChanges()) {
      Alert.alert("No Changes", "No changes detected in preferences.");
      return;
    }

    setSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      
      // Prepare ALL preference data for saving
      const preferenceData = {
        // Emergency & Safety Alerts
        emergencyAlerts: preferences.emergencyAlerts,
        safetyAlerts: preferences.safetyAlerts,
        impactAlerts: preferences.impactAlerts,
        manualTriggerAlerts: preferences.manualTriggerAlerts,
        
        // Driving Behavior Alerts
        speedAlerts: preferences.speedAlerts,
        harshBrakingAlerts: preferences.harshBrakingAlerts,
        rapidAccelAlerts: preferences.rapidAccelAlerts,
        drivingScoreAlerts: preferences.drivingScoreAlerts,
        
        // Location & Trip Alerts
        locationAlerts: preferences.locationAlerts,
        geoFenceAlerts: preferences.geoFenceAlerts,
        boundaryAlerts: preferences.boundaryAlerts,
        tripUpdates: preferences.tripUpdates,
        
        // Other Alerts
        driverAlerts: preferences.driverAlerts,
        voiceCommandAlerts: preferences.voiceCommandAlerts,
        
        // Update timestamp
        updatedAt: serverTimestamp()
      };

      await updateDoc(userRef, preferenceData);

      setInitialPreferences(preferences);
      
      Alert.alert("Success", "All preferences saved successfully!");
    } catch (error) {
      console.error("Error saving preferences:", error);
      Alert.alert("Error", "Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [user, preferences, hasPreferenceChanges]);

  // Handle logout
  const handleLogout = useCallback(() => {
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
              // Update online status before logout
              if (user) {
                const userRef = doc(db, "users", user.uid);
                await updateDoc(userRef, {
                  isOnline: false,
                  status: 'offline',
                  lastSeen: serverTimestamp(),
                });
              }
              
              await signOut(auth);
              navigation.reset({
                index: 0,
                routes: [{ name: "Login" }],
              });
            } catch (error) {
              console.error("Error logging out:", error);
              Alert.alert("Error", "Failed to logout");
            }
          }
        }
      ]
    );
  }, [auth, navigation, user]);

  const getUserName = useCallback(() => {
    if (!userData) return 'Family Member';
    return userData.name || userData.fullName || user.displayName || 'Family Member';
  }, [userData, user]);

  const getProfileImage = useCallback(() => {
    return profile.profileImage || userData?.profileImage || userData?.photoURL || null;
  }, [profile.profileImage, userData]);

  // Button disabled states
  const isProfileSaveDisabled = saving || 
    (profile.phone && !!validationErrors.phone) || 
    !hasProfileChanges();
    
  const isPasswordUpdateDisabled = saving || 
    !security.currentPassword || 
    !security.newPassword || 
    !security.confirmPassword ||
    security.newPassword !== security.confirmPassword ||
    getPasswordStrengthScore(passwordStrength) < 60;
    
  const isPreferenceSaveDisabled = saving || !hasPreferenceChanges();

  if (loading) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.headerWrapper}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.headerTitle}>Drivemate</Text>
              <Text style={styles.subTitle}>Family Settings</Text>
            </View>
          </View>
          <View style={styles.curve} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#d63384" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </View>
    );
  }

  const passwordStrengthInfo = getPasswordStrengthText(passwordStrength);

  const renderProfileTab = () => (
    <View style={styles.section}>
      {/* Profile Picture Section */}
      <View style={styles.profilePictureSection}>
        <View style={styles.profileImageContainer}>
          {getProfileImage() ? (
            <Image 
              source={{ uri: getProfileImage() }} 
              style={styles.largeProfileImage}
            />
          ) : (
            <View style={styles.largeProfileImagePlaceholder}>
              <Ionicons name="person" size={50} color="#d63384" />
            </View>
          )}
        </View>
        <TouchableOpacity 
          style={styles.imageActionButton}
          onPress={() => setShowImagePickerModal(true)}
          disabled={saving}
        >
          <Ionicons name="camera" size={18} color="#d63384" />
          <Text style={styles.imageActionText}>Change Photo</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Ionicons name="person-circle" size={24} color="#d63384" />
        <Text style={styles.sectionTitle}>Personal Information</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={profile.name}
            onChangeText={(text) => handleProfileChange("name", text)}
            placeholder="Enter your full name"
            placeholderTextColor="#999"
            editable={!saving}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={[styles.input, styles.disabledInput]}
            value={profile.email}
            placeholder="Your email address"
            editable={false}
            placeholderTextColor="#999"
          />
          <Text style={styles.helperText}>Email cannot be changed</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={[
              styles.input, 
              validationErrors.phone ? styles.errorInput : null
            ]}
            value={profile.phone}
            onChangeText={(text) => handleProfileChange("phone", text)}
            placeholder="Enter 11-digit phone number"
            keyboardType="phone-pad"
            maxLength={11}
            placeholderTextColor="#999"
            editable={!saving}
          />
          {validationErrors.phone ? (
            <Text style={styles.errorText}>{validationErrors.phone}</Text>
          ) : (
            <Text style={styles.helperText}>11-digit phone number (optional)</Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Address</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={profile.address}
            onChangeText={(text) => handleProfileChange("address", text)}
            placeholder="Enter your address"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            placeholderTextColor="#999"
            editable={!saving}
          />
        </View>
      </View>

      <TouchableOpacity 
        style={[
          styles.saveButton, 
          isProfileSaveDisabled && styles.disabledButton
        ]}
        onPress={saveProfile}
        disabled={isProfileSaveDisabled}
        activeOpacity={0.8}
      >
        <Ionicons name="save" size={20} color="#fff" />
        <Text style={styles.saveButtonText}>
          {saving ? "Saving..." : "Save Profile"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderPreferencesTab = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name="notifications" size={24} color="#d63384" />
        <Text style={styles.sectionTitle}>Alert Preferences</Text>
        <Text style={styles.sectionSubtitle}>
          Control which alerts you want to receive from your drivers
        </Text>
      </View>

      <View style={styles.preferencesList}>
        {/* Emergency & Safety Alerts */}
        <View style={styles.preferenceCategory}>
          <Text style={styles.preferenceCategoryTitle}>Emergency & Safety Alerts</Text>
          {[
            {
              key: 'emergencyAlerts',
              icon: 'alert-circle',
              title: 'Emergency Alerts',
              description: 'Critical emergency situations (accidents, collisions)'
            },
            {
              key: 'safetyAlerts',
              icon: 'shield-checkmark',
              title: 'Safety Alerts',
              description: 'General safety notifications and warnings'
            },
            {
              key: 'impactAlerts',
              icon: 'warning',
              title: 'Impact/Collision Alerts',
              description: 'Vehicle impact and collision detections'
            },
            {
              key: 'manualTriggerAlerts',
              icon: 'hand-left',
              title: 'Manual Emergency Triggers',
              description: 'When driver manually triggers emergency'
            }
          ].map((item) => (
            <View key={item.key} style={styles.preferenceItem}>
              <View style={styles.preferenceInfo}>
                <Ionicons name={item.icon} size={24} color="#d63384" />
                <View style={styles.preferenceText}>
                  <Text style={styles.preferenceTitle}>{item.title}</Text>
                  <Text style={styles.preferenceDescription}>{item.description}</Text>
                </View>
              </View>
              <Switch
                value={preferences[item.key]}
                onValueChange={(value) => handlePreferenceChange(item.key, value)}
                trackColor={{ false: "#e0e0e0", true: "#d63384" }}
                thumbColor="#fff"
                ios_backgroundColor="#e0e0e0"
                disabled={saving}
              />
            </View>
          ))}
        </View>

        {/* Driving Behavior Alerts */}
        <View style={styles.preferenceCategory}>
          <Text style={styles.preferenceCategoryTitle}>Driving Behavior Alerts</Text>
          {[
            {
              key: 'speedAlerts',
              icon: 'speedometer',
              title: 'Speed Alerts',
              description: 'Notifications for speeding incidents'
            },
            {
              key: 'harshBrakingAlerts',
              icon: 'pause-circle',
              title: 'Hard Braking Alerts',
              description: 'Sudden and hard braking incidents'
            },
            {
              key: 'rapidAccelAlerts',
              icon: 'rocket',
              title: 'Rapid Acceleration Alerts',
              description: 'Sudden and rapid acceleration'
            },
            {
              key: 'drivingScoreAlerts',
              icon: 'trophy',
              title: 'Driving Score Updates',
              description: 'Weekly driving performance reports'
            }
          ].map((item) => (
            <View key={item.key} style={styles.preferenceItem}>
              <View style={styles.preferenceInfo}>
                <Ionicons name={item.icon} size={24} color="#d63384" />
                <View style={styles.preferenceText}>
                  <Text style={styles.preferenceTitle}>{item.title}</Text>
                  <Text style={styles.preferenceDescription}>{item.description}</Text>
                </View>
              </View>
              <Switch
                value={preferences[item.key]}
                onValueChange={(value) => handlePreferenceChange(item.key, value)}
                trackColor={{ false: "#e0e0e0", true: "#d63384" }}
                thumbColor="#fff"
                ios_backgroundColor="#e0e0e0"
                disabled={saving}
              />
            </View>
          ))}
        </View>

        {/* Location & Trip Alerts */}
        <View style={styles.preferenceCategory}>
          <Text style={styles.preferenceCategoryTitle}>Location & Trip Alerts</Text>
          {[
            {
              key: 'locationAlerts',
              icon: 'location',
              title: 'Location Updates',
              description: 'Driver location and route updates'
            },
            {
              key: 'geoFenceAlerts',
              icon: 'map',
              title: 'Geo-Fence Alerts',
              description: 'Boundary crossing notifications'
            },
            {
              key: 'boundaryAlerts',
              icon: 'navigate-circle',
              title: 'Boundary Alerts',
              description: 'Specific boundary violations'
            },
            {
              key: 'tripUpdates',
              icon: 'car',
              title: 'Trip Updates',
              description: 'Trip start and end notifications'
            }
          ].map((item) => (
            <View key={item.key} style={styles.preferenceItem}>
              <View style={styles.preferenceInfo}>
                <Ionicons name={item.icon} size={24} color="#d63384" />
                <View style={styles.preferenceText}>
                  <Text style={styles.preferenceTitle}>{item.title}</Text>
                  <Text style={styles.preferenceDescription}>{item.description}</Text>
                </View>
              </View>
              <Switch
                value={preferences[item.key]}
                onValueChange={(value) => handlePreferenceChange(item.key, value)}
                trackColor={{ false: "#e0e0e0", true: "#d63384" }}
                thumbColor="#fff"
                ios_backgroundColor="#e0e0e0"
                disabled={saving}
              />
            </View>
          ))}
        </View>

        {/* Other Alerts */}
        <View style={styles.preferenceCategory}>
          <Text style={styles.preferenceCategoryTitle}>Other Alerts</Text>
          {[
            {
              key: 'driverAlerts',
              icon: 'person',
              title: 'Driver Status Alerts',
              description: 'Driver online/offline status changes'
            },
            {
              key: 'voiceCommandAlerts',
              icon: 'mic',
              title: 'Voice Command Alerts',
              description: 'When driver uses voice commands'
            }
          ].map((item) => (
            <View key={item.key} style={styles.preferenceItem}>
              <View style={styles.preferenceInfo}>
                <Ionicons name={item.icon} size={24} color="#d63384" />
                <View style={styles.preferenceText}>
                  <Text style={styles.preferenceTitle}>{item.title}</Text>
                  <Text style={styles.preferenceDescription}>{item.description}</Text>
                </View>
              </View>
              <Switch
                value={preferences[item.key]}
                onValueChange={(value) => handlePreferenceChange(item.key, value)}
                trackColor={{ false: "#e0e0e0", true: "#d63384" }}
                thumbColor="#fff"
                ios_backgroundColor="#e0e0e0"
                disabled={saving}
              />
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity 
        style={[styles.saveButton, isPreferenceSaveDisabled && styles.disabledButton]}
        onPress={savePreferences}
        disabled={isPreferenceSaveDisabled}
        activeOpacity={0.8}
      >
        <Ionicons name="checkmark-circle" size={20} color="#fff" />
        <Text style={styles.saveButtonText}>
          {saving ? "Saving..." : "Save All Preferences"}
        </Text>
      </TouchableOpacity>
      
      <Text style={styles.preferencesNote}>
        Note: Disabled alerts will not appear in your alerts list. Emergency alerts are always shown regardless of settings.
      </Text>
    </View>
  );

  const renderSecurityTab = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name="shield-checkmark" size={24} color="#d63384" />
        <Text style={styles.sectionTitle}>Security</Text>
      </View>

      <View style={styles.securityCards}>
        <TouchableOpacity 
          style={styles.securityCard}
          onPress={() => setShowPasswordModal(true)}
          activeOpacity={0.8}
        >
          <View style={styles.securityCardContent}>
            <View style={styles.securityCardIcon}>
              <Ionicons name="key" size={24} color="#d63384" />
            </View>
            <View style={styles.securityCardText}>
              <Text style={styles.securityCardTitle}>Change Password</Text>
              <Text style={styles.securityCardDescription}>
                Update your account password securely
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#d63384" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.securityCard}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <View style={styles.securityCardContent}>
            <View style={styles.securityCardIcon}>
              <Ionicons name="log-out" size={24} color="#ff6b6b" />
            </View>
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

      <View style={styles.securityTips}>
        <Text style={styles.securityTipsTitle}>Security Tips</Text>
        <View style={styles.tipsList}>
          {[
            "Use a strong, unique password",
            "Never share your password",
            "Change your password regularly",
            "Log out from shared devices",
            "Enable two-factor authentication for extra security"
          ].map((tip, index) => (
            <View key={index} style={styles.tipItem}>
              <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  const renderPasswordModal = () => (
    <Modal
      visible={showPasswordModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowPasswordModal(false)}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalContainer}
      >
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Ionicons name="key" size={24} color="#d63384" />
            <Text style={styles.modalTitle}>Change Password</Text>
            <TouchableOpacity 
              onPress={() => {
                setShowPasswordModal(false);
                Keyboard.dismiss();
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView 
            style={styles.modalForm}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Current Password</Text>
              <TextInput
                style={styles.input}
                value={security.currentPassword}
                onChangeText={(text) => handleSecurityChange("currentPassword", text)}
                placeholder="Enter current password"
                secureTextEntry
                placeholderTextColor="#999"
                editable={!saving}
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
                placeholderTextColor="#999"
                editable={!saving}
              />
              
              {security.newPassword.length > 0 && (
                <View style={styles.passwordStrengthContainer}>
                  <View style={styles.passwordStrengthHeader}>
                    <Text style={styles.passwordStrengthLabel}>Password Strength:</Text>
                    <Text style={[styles.passwordStrengthText, { color: passwordStrengthInfo.color }]}>
                      {passwordStrengthInfo.text}
                    </Text>
                  </View>
                  
                  <View style={styles.passwordRequirements}>
                    {[
                      { key: 'length', label: 'At least 8 characters' },
                      { key: 'uppercase', label: 'Uppercase letter' },
                      { key: 'lowercase', label: 'Lowercase letter' },
                      { key: 'number', label: 'Number' },
                      { key: 'special', label: 'Special character' }
                    ].map((req) => (
                      <View key={req.key} style={styles.requirementItem}>
                        <Ionicons 
                          name={passwordStrength[req.key] ? "checkmark-circle" : "close-circle"} 
                          size={16} 
                          color={passwordStrength[req.key] ? "#4CAF50" : "#ff6b6b"} 
                        />
                        <Text style={[
                          styles.requirementText,
                          passwordStrength[req.key] && styles.metRequirement
                        ]}>
                          {req.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm New Password</Text>
              <TextInput
                style={[
                  styles.input,
                  security.confirmPassword && security.newPassword !== security.confirmPassword && styles.errorInput
                ]}
                value={security.confirmPassword}
                onChangeText={(text) => handleSecurityChange("confirmPassword", text)}
                placeholder="Confirm new password"
                secureTextEntry
                placeholderTextColor="#999"
                editable={!saving}
              />
              {security.confirmPassword && security.newPassword !== security.confirmPassword && (
                <Text style={styles.errorText}>Passwords do not match</Text>
              )}
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity 
              style={styles.modalCancel}
              onPress={() => {
                setShowPasswordModal(false);
                Keyboard.dismiss();
              }}
              activeOpacity={0.8}
              disabled={saving}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.modalConfirm, isPasswordUpdateDisabled && styles.disabledButton]}
              onPress={updatePasswordHandler}
              disabled={isPasswordUpdateDisabled}
              activeOpacity={0.8}
            >
              <Text style={styles.modalConfirmText}>
                {saving ? "Updating..." : "Update Password"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderImagePickerModal = () => (
    <Modal
      visible={showImagePickerModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowImagePickerModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Ionicons name="camera" size={24} color="#d63384" />
            <Text style={styles.modalTitle}>Change Profile Picture</Text>
            <TouchableOpacity 
              onPress={() => setShowImagePickerModal(false)}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.imagePickerOptions}>
            <TouchableOpacity 
              style={styles.imagePickerOption}
              onPress={() => pickImage('camera')}
              disabled={saving}
            >
              <Ionicons name="camera" size={24} color="#d63384" />
              <Text style={styles.imagePickerText}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.imagePickerOption}
              onPress={() => pickImage('gallery')}
              disabled={saving}
            >
              <Ionicons name="images" size={24} color="#d63384" />
              <Text style={styles.imagePickerText}>Choose from Gallery</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const profileImage = getProfileImage();
  const userName = getUserName();

  return (
    <KeyboardAvoidingView 
      style={styles.mainContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <View style={styles.mainContainer}>
        {/* HEADER */}
        <View style={styles.headerWrapper}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.headerTitle}>Drivemate</Text>
              <Text style={styles.subTitle}>Family Settings</Text>
            </View>

            {/* Profile Section */}
            <View style={styles.profileWrapper}>
              {profileImage ? (
                <Image 
                  source={{ uri: profileImage }} 
                  style={styles.profileImage}
                />
              ) : (
                <View style={styles.profileImagePlaceholder}>
                  <Ionicons name="person" size={20} color="#d63384" />
                </View>
              )}
              <Text style={styles.profileName} numberOfLines={1}>
                {userName}
              </Text>
            </View>
          </View>
          <View style={styles.curve} />
        </View>

        {/* CONTENT */}
        <ScrollView 
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Settings Navigation */}
          <View style={styles.tabContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {[
                { id: "profile", icon: "person", label: "Profile" },
                { id: "preferences", icon: "notifications", label: "Alerts" },
                { id: "security", icon: "lock-closed", label: "Security" }
              ].map((tab) => (
                <TouchableOpacity 
                  key={tab.id}
                  style={[styles.tab, activeTab === tab.id && styles.activeTab]}
                  onPress={() => {
                    setActiveTab(tab.id);
                    Keyboard.dismiss();
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons 
                    name={tab.icon} 
                    size={20} 
                    color={activeTab === tab.id ? "#fff" : "#d63384"} 
                  />
                  <Text style={[styles.tabText, activeTab === tab.id && styles.activeTabText]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Active Tab Content */}
          {activeTab === "profile" && renderProfileTab()}
          {activeTab === "preferences" && renderPreferencesTab()}
          {activeTab === "security" && renderSecurityTab()}
        </ScrollView>

        {/* Modals */}
        {renderPasswordModal()}
        {renderImagePickerModal()}

        {/* FOOTER NAVIGATION */}
        <View style={styles.footerWrapper}>
          <View style={styles.footerNav}>
            <TouchableOpacity 
              onPress={() => navigation.navigate('FamilyDashboard')}
              style={styles.footerButton}
            >
              <Ionicons name="home" size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => navigation.navigate('DriverTracking')}
              style={styles.footerButton}
            >
              <Ionicons name="map" size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => navigation.navigate('FamilySettings')}
              style={styles.footerButton}
            >
              <View style={styles.activeTabIndicator}>
                <Ionicons name="settings" size={28} color="#fff" />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  mainContainer: { 
    flex: 1, 
    backgroundColor: '#fff' 
  },
  scrollContainer: { 
    paddingBottom: 120 
  },
  headerWrapper: { 
    position: 'relative', 
    backgroundColor: '#d63384' 
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
    marginTop: 2,
    opacity: 0.9,
  },
  profileWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileName: {
    color: '#fff',
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 120,
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileImagePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    color: '#d63384',
  },
  // Profile Picture Section
  profilePictureSection: {
    alignItems: 'center',
    marginBottom: 30,
    padding: 20,
    backgroundColor: '#f8fafc',
    borderRadius: 20,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileImageContainer: {
    marginBottom: 16,
  },
  largeProfileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#d63384',
  },
  largeProfileImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#d63384',
    backgroundColor: '#fff0f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d63384',
    gap: 6,
  },
  imageActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#d63384',
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
    backgroundColor: '#d63384',
    borderColor: '#d63384',
  },
  tabText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#d63384',
  },
  activeTabText: {
    color: '#fff',
  },
  // Sections
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 0,
    marginTop: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  // Preferences Categories
  preferenceCategory: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  preferenceCategoryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    paddingLeft: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#d63384',
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
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e9ecef',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#333',
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  disabledInput: {
    backgroundColor: '#f8f9fa',
    color: '#666',
    borderColor: '#e9ecef',
  },
  errorInput: {
    borderColor: '#dc3545',
    backgroundColor: '#fff5f5',
  },
  errorText: {
    fontSize: 12,
    color: '#dc3545',
  },
  helperText: {
    fontSize: 12,
    color: '#666',
  },
  // Password Strength
  passwordStrengthContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  passwordStrengthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  passwordStrengthLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  passwordStrengthText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  passwordRequirements: {
    gap: 6,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requirementText: {
    fontSize: 12,
    color: '#666',
  },
  metRequirement: {
    color: '#4CAF50',
    fontWeight: '500',
  },
  // Preferences
  preferencesList: {
    gap: 16,
  },
  preferenceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 8,
  },
  preferenceInfo: {
    flex: 1,
    marginRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  preferenceText: {
    flex: 1,
  },
  preferenceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  preferenceDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  preferencesNote: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    fontStyle: 'italic',
  },
  // Security Section
  securityCards: {
    gap: 12,
    paddingHorizontal: 16,
  },
  securityCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  securityCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  securityCardIcon: {
    marginRight: 12,
  },
  securityCardText: {
    flex: 1,
  },
  securityCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  securityCardDescription: {
    fontSize: 14,
    color: '#666',
  },
  // Security Tips
  securityTips: {
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 16,
  },
  securityTipsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  tipsList: {
    gap: 8,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipText: {
    fontSize: 14,
    color: '#333',
  },
  // Buttons
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d63384',
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    marginHorizontal: 16,
    gap: 8,
    shadowColor: '#d63384',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#ccc',
    shadowColor: '#ccc',
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
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#d63384',
    flex: 1,
    textAlign: 'center',
  },
  modalForm: {
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  modalCancelText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  modalConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#d63384',
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Image Picker Options
  imagePickerOptions: {
    gap: 16,
    marginBottom: 20,
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
    color: '#333',
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
    backgroundColor: '#d63384',
    width: width * 0.9,
    borderRadius: 35,
    paddingVertical: 14,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  footerButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  activeTabIndicator: {
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
  },
});

export default FamilySettingsScreen;