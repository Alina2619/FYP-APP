import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  Alert,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  ActivityIndicator
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import RNPickerSelect from "react-native-picker-select";
import DateTimePicker from "@react-native-community/datetimepicker";
import { collection, getDocs, query, where, updateDoc, doc, arrayUnion } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebaseConfig";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function FamilySetupWizard() {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const navigation = useNavigation();
  const auth = getAuth();
  const user = auth.currentUser;
  const storage = getStorage();

  // Step 1 fields
  const [image, setImage] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [cnic, setCnic] = useState("");
  const [dob, setDob] = useState(null);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [gender, setGender] = useState("");

  // Step 2 fields
  const [relationship, setRelationship] = useState("");
  const [driverEmail, setDriverEmail] = useState("");
  const [driverId, setDriverId] = useState(null);
  const [driverData, setDriverData] = useState(null);

  // Step 3 fields
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [modalContent, setModalContent] = useState(null);

  // ✅ Improved image upload function with better error handling
  const uploadImageToFirebase = async (uri) => {
    if (!uri) return '';
    
    setImageUploading(true);
    
    try {
      console.log("Starting image upload for URI:", uri);
      
      // Check if user is authenticated
      if (!user) {
        console.error("No authenticated user found");
        throw new Error('User not authenticated');
      }
      
      // Fetch the image with timeout
      const fetchController = new AbortController();
      const timeoutId = setTimeout(() => fetchController.abort(), 30000);
      
      const response = await fetch(uri, {
        signal: fetchController.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      
      const blob = await response.blob();
      console.log("Image blob created, size:", blob.size, "bytes");
      
      // Check blob size (max 5MB)
      if (blob.size > 5 * 1024 * 1024) {
        Alert.alert(
          "Image Too Large",
          "Please select an image under 5MB for better performance."
        );
        return '';
      }
      
      // Create a unique filename with proper path
      const timestamp = Date.now();
      const imageName = `family_profiles/${user.uid}_${timestamp}.jpg`;
      
      const storageRef = ref(storage, imageName);
      
      console.log("Uploading to path:", imageName);
      
      // Upload with metadata
      const metadata = {
        contentType: 'image/jpeg',
        customMetadata: {
          uploadedBy: user.uid,
          uploadedAt: new Date().toISOString(),
          type: 'family_profile'
        }
      };
      
      await uploadBytes(storageRef, blob, metadata);
      console.log("Upload complete, getting download URL...");
      
      const downloadURL = await getDownloadURL(storageRef);
      console.log("Download URL obtained successfully");
      
      return downloadURL;
      
    } catch (error) {
      console.error('Error uploading image:', error);
      
      // Show user-friendly error message
      if (error.message.includes('Network request failed')) {
        Alert.alert(
          "Network Error",
          "Unable to upload image due to network issues. You can continue without a profile picture and add one later."
        );
      } else {
        Alert.alert(
          "Image Upload Failed",
          "Could not upload profile picture. You can continue without it and add one later from settings."
        );
      }
      
      return ''; // Return empty string to continue without image
      
    } finally {
      setImageUploading(false);
    }
  };

  const pickImage = async () => {
    try {
      // Request permissions first
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'Please grant permission to access your photo library to upload a profile picture.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5, // Lower quality for faster upload
        base64: false,
      });
      
      if (!result.canceled && result.assets[0].uri) {
        setImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'Please grant camera permission to take a photo.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets[0].uri) {
        setImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const showImagePickerOptions = () => {
    Alert.alert(
      "Profile Picture",
      "Choose an option",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: takePhoto },
        { text: "Choose from Gallery", onPress: pickImage },
        { text: "Remove Photo", onPress: () => setImage(null), style: "destructive" }
      ]
    );
  };

  // Helper function to remove spaces and validate
  const removeSpacesAndValidate = (text, fieldName) => {
    if (fieldName === 'phone') {
      return text.replace(/[^0-9]/g, '');
    } else if (fieldName === 'cnic') {
      return text.replace(/[^0-9\-]/g, '');
    } else if (fieldName === 'name') {
      // Allow only letters and spaces for name (don't remove spaces)
      return text.replace(/[^A-Za-z\s]/g, '');
    }
    return text;
  };

  // ✅ Verify driver email & fetch UID
  const verifyDriverEmail = async () => {
    try {
      const trimmedEmail = driverEmail.replace(/\s/g, '').toLowerCase();
      console.log("Searching for email:", trimmedEmail);
      
      const q = query(
        collection(db, "users"),
        where("email", "==", trimmedEmail)
      );
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        Alert.alert("Validation Error", "No user found with this email address.");
        return null;
      }

      const docSnap = querySnapshot.docs[0];
      const driverInfo = { uid: docSnap.id, ...docSnap.data() };
      
      console.log("Found user data:", {
        uid: driverInfo.uid,
        email: driverInfo.email,
        role: driverInfo.role,
        userRole: driverInfo.userRole,
        accountType: driverInfo.accountType
      });
      
      // Check multiple possible role field names
      const userRole = driverInfo.role || driverInfo.userRole || driverInfo.accountType;
      console.log("Determined role value:", userRole);
      
      // Check if user is actually a driver (case insensitive)
      if (!userRole) {
        Alert.alert("Validation Error", "User role not found in database.");
        return null;
      }
      
      if (userRole.toLowerCase() !== 'driver') {
        Alert.alert(
          "Validation Error", 
          `The email belongs to a user who is not registered as a driver. Current role: ${userRole}`
        );
        return null;
      }
      
      console.log("Driver verified successfully!");
      return driverInfo;
    } catch (error) {
      console.error("Error verifying driver email:", error);
      Alert.alert("Error", "Failed to verify driver email. Please try again.");
      return null;
    }
  };

  const validateStep = async () => {
    const nameRegex = /^[A-Za-z\s]+$/;
    
    if (step === 1) {
      if (!fullName.trim() || !phone || !cnic || !dob || !gender) {
        Alert.alert("Validation Error", "Please fill all required fields.");
        return false;
      }
      if (!nameRegex.test(fullName)) {
        Alert.alert(
          "Validation Error",
          "Full Name can only contain letters and spaces."
        );
        return false;
      }
      const trimmedPhone = phone.replace(/\s/g, '');
      if (!trimmedPhone.match(/^\d{11}$/)) {
        Alert.alert("Validation Error", "Phone number must be 11 digits without spaces.");
        return false;
      }
      const trimmedCnic = cnic.replace(/\s/g, '');
      if (!trimmedCnic.match(/^\d{5}-\d{7}-\d{1}$/)) {
        Alert.alert("Validation Error", "CNIC must be in format 12345-1234567-1 without spaces.");
        return false;
      }
    }
    if (step === 2) {
      if (!relationship || !driverEmail.trim()) {
        Alert.alert("Validation Error", "Please fill all required fields.");
        return false;
      }
      const emailRegex = /\S+@\S+\.\S+/;
      const trimmedEmail = driverEmail.replace(/\s/g, '');
      if (!emailRegex.test(trimmedEmail)) {
        Alert.alert("Validation Error", "Enter a valid driver email without spaces.");
        return false;
      }

      // ✅ Check Firestore for driver
      const driverInfo = await verifyDriverEmail();
      if (!driverInfo) {
        return false;
      }

      // ✅ Save driver UID and data if valid
      setDriverId(driverInfo.uid);
      setDriverData(driverInfo);
    }
    if (step === 3) {
      if (!acceptedTerms) {
        Alert.alert("Validation Error", "Please accept Terms & Conditions.");
        return false;
      }
    }
    return true;
  };

  const handleNext = async () => {
    if (await validateStep()) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async () => {
    if (!(await validateStep())) return;
    
    try {
      setIsLoading(true);
      console.log("=== STARTING SUBMISSION ===");
      console.log("Step 1 Data:", { fullName, phone, cnic, dob, gender });
      console.log("Step 2 Data:", { relationship, driverEmail, driverId });
      console.log("User:", user?.uid, user?.email);

      // Upload profile image if exists
      let imageUrl = '';
      if (image) {
        console.log("Attempting to upload image...");
        imageUrl = await uploadImageToFirebase(image);
        if (imageUrl) {
          console.log("Image upload successful:", imageUrl);
        } else {
          console.log("Image upload failed or was skipped");
        }
      } else {
        console.log("No image selected, skipping upload");
      }

      // Remove spaces from fields before saving
      const trimmedFullName = fullName.trim();
      const trimmedPhone = phone.replace(/\s/g, '');
      const trimmedCnic = cnic.replace(/\s/g, '');
      const trimmedDriverEmail = driverEmail.replace(/\s/g, '').toLowerCase();

      console.log("Trimmed data:", { trimmedFullName, trimmedPhone, trimmedCnic, trimmedDriverEmail });

      // Get driver name from driver data
      const getDriverName = (driverData) => {
        if (!driverData) return "Driver";
        return (
          driverData.name ||
          driverData.fullName ||
          driverData.displayName ||
          `${driverData.firstName || ""} ${driverData.lastName || ""}`.trim() ||
          driverData.email?.split("@")[0] ||
          "Driver"
        );
      };

      // Get driver profile image from driver data
      const getDriverProfileImage = (driverData) => {
        if (!driverData) return null;
        return (
          driverData.profileImage ||
          driverData.profileImg ||
          driverData.photoURL ||
          driverData.avatar ||
          driverData.imageUrl ||
          (driverData.driverProfile && driverData.driverProfile.profileImage) ||
          null
        );
      };

      // Create the driver link object
      const driverLink = {
        driverId: driverId,
        email: trimmedDriverEmail,
        name: getDriverName(driverData),
        relation: relationship,
        profileImg: getDriverProfileImage(driverData) || "",
        permissions: {
          shareLocation: true,
          shareTripHistory: false,
          emergencyAlert: true
        },
        linkedAt: new Date().toISOString()
      };

      console.log("Driver link object:", JSON.stringify(driverLink, null, 2));

      // Update the user document with the profile data AND linked driver
      const userRef = doc(db, "users", user.uid);
      console.log("Updating user document...");
      
      const userUpdateData = {
        name: trimmedFullName,
        fullName: trimmedFullName,
        firstName: trimmedFullName.split(' ')[0] || trimmedFullName,
        lastName: trimmedFullName.split(' ').slice(1).join(' ') || '',
        phone: trimmedPhone,
        cnic: trimmedCnic,
        dob: dob ? dob.toISOString() : null,
        gender: gender,
        profileImage: imageUrl || null,
        role: "family",
        familyRole: "family_admin",
        isFamilySetupComplete: true,
        setupCompleted: true,
        linkedDrivers: arrayUnion(driverLink),
        updatedAt: new Date().toISOString()
      };
      
      console.log("User update data:", JSON.stringify(userUpdateData, null, 2));
      
      await updateDoc(userRef, userUpdateData);
      console.log("User document updated successfully");

      // Also update the driver's document to include the family link
      const driverRef = doc(db, "users", driverId);
      const familyLink = {
        familyId: user.uid,
        email: user.email,
        name: trimmedFullName,
        relation: relationship,
        profileImage: imageUrl || "",
        permissions: {
          shareLocation: true,
          shareTripHistory: false,
          emergencyAlert: true
        },
        linkedAt: new Date().toISOString()
      };
      
      console.log("Updating driver document...");
      console.log("Driver update data:", JSON.stringify({ linkedFamilies: arrayUnion(familyLink) }, null, 2));
      
      await updateDoc(driverRef, {
        linkedFamilies: arrayUnion(familyLink)
      });
      console.log("Driver document updated successfully");

      console.log("=== SUBMISSION COMPLETE ===");
      Alert.alert("Success", "Family setup completed successfully!", [
        {
          text: "OK",
          onPress: () => navigation.replace("FamilyDashboard"),
        },
      ]);

    } catch (error) {
      console.error("=== ERROR IN SUBMISSION ===");
      console.error("Error name:", error.name);
      console.error("Error code:", error.code);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      
      let errorMessage = "Failed to save data. Please try again.";
      
      if (error.code === 'permission-denied') {
        errorMessage = "Permission denied. Please check your account permissions.";
      } else if (error.code === 'not-found') {
        errorMessage = "User document not found. Please try logging in again.";
      } else if (error.code === 'unavailable') {
        errorMessage = "Network error. Please check your connection and try again.";
      } else {
        errorMessage = `Error: ${error.message}`;
      }
      
      Alert.alert("Setup Failed", errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoidingView}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        {(isLoading || imageUploading) && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#d63384" />
            <Text style={styles.loadingText}>
              {imageUploading ? "Uploading image..." : "Setting up your account..."}
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={styles.headerWrapper}>
          <Text style={styles.title}>DriveMate</Text>
          <Text style={styles.subTitle}>
            {step === 1 && "Provide Your Details"}
            {step === 2 && "Link a Driver"}
            {step === 3 && "Terms & Conditions"}
          </Text>
        </View>

        <ScrollView 
          contentContainerStyle={styles.formContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step 1 */}
          {step === 1 && (
            <View>
              <TouchableOpacity
                style={styles.imageUploadBox}
                onPress={showImagePickerOptions}
                disabled={isLoading || imageUploading}
              >
                {image ? (
                  <Image source={{ uri: image }} style={styles.imagePreview} />
                ) : (
                  <View style={styles.uploadPlaceholder}>
                    <Ionicons name="camera" size={40} color="#d63384" />
                    <Text style={styles.uploadText}>Add Profile Picture</Text>
                    <Text style={styles.uploadSubText}>(Optional)</Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name <Text style={styles.requiredStar}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your full name"
                  placeholderTextColor="#999"
                  value={fullName}
                  onChangeText={(text) => setFullName(removeSpacesAndValidate(text, 'name'))}
                  editable={!isLoading}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number <Text style={styles.requiredStar}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="03XXXXXXXXX"
                  placeholderTextColor="#999"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(text) => setPhone(removeSpacesAndValidate(text, 'phone'))}
                  maxLength={11}
                  editable={!isLoading}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>CNIC <Text style={styles.requiredStar}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="XXXXX-XXXXXXX-X"
                  placeholderTextColor="#999"
                  keyboardType="default"
                  value={cnic}
                  onChangeText={(text) => setCnic(removeSpacesAndValidate(text, 'cnic'))}
                  maxLength={15}
                  editable={!isLoading}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Date of Birth <Text style={styles.requiredStar}>*</Text></Text>
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => setShowDobPicker(true)}
                  disabled={isLoading}
                >
                  <Text style={{ color: dob ? '#000' : '#999' }}>
                    {dob ? dob.toDateString() : "Select Date of Birth"}
                  </Text>
                </TouchableOpacity>
                {showDobPicker && (
                  <DateTimePicker
                    value={dob || new Date(2000, 0, 1)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={new Date()}
                    minimumDate={new Date(1900, 0, 1)}
                    onChange={(event, selectedDate) => {
                      setShowDobPicker(false);
                      if (selectedDate) setDob(selectedDate);
                    }}
                  />
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Gender <Text style={styles.requiredStar}>*</Text></Text>
                <RNPickerSelect
                  onValueChange={(value) => setGender(value)}
                  items={[
                    { label: "Male", value: "male" },
                    { label: "Female", value: "female" },
                    { label: "Other", value: "other" },
                  ]}
                  style={pickerStyle}
                  placeholder={{ label: "Select Gender", value: "", color: '#999' }}
                  value={gender}
                  disabled={isLoading}
                />
              </View>
            </View>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <View>
              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={24} color="#d63384" />
                <Text style={styles.infoText}>
                  Enter the email of the driver you want to monitor. They must have a driver account.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Your Relationship to Driver <Text style={styles.requiredStar}>*</Text></Text>
                <RNPickerSelect
                  onValueChange={(value) => setRelationship(value)}
                  items={[
                    { label: "Father", value: "father" },
                    { label: "Mother", value: "mother" },
                    { label: "Brother", value: "brother" },
                    { label: "Sister", value: "sister" },
                    { label: "Son", value: "son" },
                    { label: "Daughter", value: "daughter" },
                    { label: "Spouse", value: "spouse" },
                    { label: "Guardian", value: "guardian" },
                    { label: "Other", value: "other" },
                  ]}
                  style={pickerStyle}
                  placeholder={{ label: "Select Relationship", value: "", color: '#999' }}
                  value={relationship}
                  disabled={isLoading}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Driver Email <Text style={styles.requiredStar}>*</Text></Text> 
                <TextInput
                  style={styles.input}
                  placeholder="driver@example.com"
                  placeholderTextColor="#999"
                  value={driverEmail}
                  onChangeText={(text) => setDriverEmail(text.replace(/\s/g, ''))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
              </View>

              {driverData && (
                <View style={styles.driverInfoContainer}>
                  <Ionicons name="checkmark-circle" size={24} color="#28a745" />
                  <View style={styles.driverInfoTextContainer}>
                    <Text style={styles.driverInfoTitle}>Driver Verified</Text>
                    <Text style={styles.driverInfoText}>
                      {driverData.name || driverData.fullName || driverData.email}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <View style={styles.termsContainer}>
              <Ionicons name="document-text" size={60} color="#d63384" style={styles.termsIcon} />
              
              <Text style={styles.termsIntro}>
                Please review and accept the Terms & Conditions and Privacy Policy to continue.
              </Text>

              <Pressable
                style={styles.termsRow}
                onPress={() => setAcceptedTerms(!acceptedTerms)}
                disabled={isLoading}
              >
                <View
                  style={[
                    styles.checkbox,
                    acceptedTerms && styles.checkboxChecked,
                  ]}
                >
                  {acceptedTerms && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <Text style={styles.termsText}>
                  I agree to the{" "}
                  <Text
                    style={styles.linkText}
                    onPress={() => setModalContent("terms")}
                  >
                    Terms & Conditions
                  </Text>{" "}
                  and{" "}
                  <Text
                    style={styles.linkText}
                    onPress={() => setModalContent("privacy")}
                  >
                    Privacy Policy
                  </Text>
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        {/* Navigation Buttons */}
        <View style={styles.navigationWrapper}>
          {step > 1 && (
            <Pressable 
              style={[styles.backButton, (isLoading || imageUploading) && styles.disabledButton]} 
              onPress={handleBack}
              disabled={isLoading || imageUploading}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
              <Text style={styles.nextText}>Back</Text>
            </Pressable>
          )}
          {step < 3 && (
            <Pressable 
              style={[styles.nextButton, (isLoading || imageUploading) && styles.disabledButton]} 
              onPress={handleNext}
              disabled={isLoading || imageUploading}
            >
              <Text style={styles.nextText}>Next</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </Pressable>
          )}
          {step === 3 && (
            <Pressable 
              style={[styles.nextButton, (isLoading || imageUploading) && styles.disabledButton]} 
              onPress={handleSubmit}
              disabled={isLoading || imageUploading}
            >
              <Text style={styles.nextText}>
                {isLoading ? "Setting Up..." : "Complete Setup"}
              </Text>
              {!isLoading && <Ionicons name="checkmark" size={20} color="#fff" />}
            </Pressable>
          )}
        </View>

        {/* Modal for Terms & Privacy */}
        <Modal visible={modalContent !== null} animationType="slide">
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {modalContent === "privacy" ? "Privacy Policy" : "Terms & Conditions"}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setModalContent(null)}
              >
                <Ionicons name="close" size={24} color="#d63384" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent}>
              {modalContent === "privacy" ? (
                <Text style={styles.modalText}>
                  Our application ("DriveMate / FamilyTrack") respects your privacy. 
                  By using this app, you agree to the collection and use of information 
                  as described in this policy.{"\n\n"}
                  
                  1. **Information We Collect**{"\n"}
                  - Personal details: name, email, phone number, and role (Driver, Parent, Admin).{"\n"}
                  - GPS data: real-time location, routes, and trip history.{"\n"}
                  - Driving data: speed, acceleration, safety alerts, and accident detection.{"\n\n"}
                  
                  2. **How We Use Your Data**{"\n"}
                  - To provide real-time driver monitoring and trip analytics.{"\n"}
                  - To notify parents about overspeeding, accidents, and geo-fence violations.{"\n"}
                  - To allow admins to manage users and ensure safe usage.{"\n\n"}
                  
                  3. **Data Sharing**{"\n"}
                  - Location and driving alerts are shared only with linked parents or admins.{"\n"}
                  - We do not sell or rent your data to third parties.{"\n\n"}
                  
                  4. **Data Security**{"\n"}
                  - All data is stored securely in our system.{"\n"}
                  - We take reasonable steps to protect against unauthorized access.{"\n\n"}
                  
                  5. **Your Rights**{"\n"}
                  - You can request deletion of your data at any time by contacting support.{"\n"}
                  - Parents may unlink drivers from their profile with proper authorization.{"\n\n"}
                  
                  By continuing to use our app, you consent to this Privacy Policy.
                </Text>
              ) : (
                <Text style={styles.modalText}>
                  By creating an account and using this application, you agree to the following terms:{"\n\n"}

                  1. **User Responsibilities**{"\n"}
                  - Drivers must provide accurate trip data and use the app safely.{"\n"}
                  - Parents may monitor driver activity only for safety purposes.{"\n"}
                  - Admins must manage accounts fairly and responsibly.{"\n\n"}

                  2. **Location Tracking**{"\n"}
                  - Drivers consent to sharing their real-time location with linked parents and admins.{"\n"}
                  - Tracking will remain active during trips for safety monitoring.{"\n\n"}

                  3. **Prohibited Use**{"\n"}
                  - Do not misuse the app for illegal activity.{"\n"}
                  - Do not attempt to hack, alter, or resell the service.{"\n\n"}

                  4. **Disclaimer of Liability**{"\n"}
                  - The app assists with monitoring and alerts but cannot prevent accidents.{"\n"}
                  - We are not liable for inaccurate GPS data or misuse of alerts.{"\n\n"}

                  5. **Account Suspension**{"\n"}
                  - We reserve the right to suspend accounts that violate these terms.{"\n\n"}

                  By using this app, you agree to these Terms & Conditions.
                </Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setModalContent(null)}
            >
              <Text style={styles.modalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  keyboardAvoidingView: { flex: 1 },
  headerWrapper: {
    paddingTop: 60,
    paddingBottom: 30,
    alignItems: "center",
    backgroundColor: "#d63384",
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  title: { 
    fontSize: 34, 
    fontWeight: "bold", 
    color: "#fff",
    letterSpacing: 1,
  },
  subTitle: { 
    fontSize: 18, 
    color: "#fff", 
    marginTop: 8,
    fontWeight: "500",
  },
  formContainer: { 
    paddingHorizontal: 20, 
    paddingVertical: 30, 
    paddingBottom: 100 
  },
  inputGroup: { marginBottom: 20 },
  label: { 
    fontSize: 16, 
    marginBottom: 8, 
    color: "#333",
    fontWeight: "600",
  },
  requiredStar: {
    color: "#dc3545",
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#f8f9fa",
    color: "#000",
  },
  // Image upload styles
  imageUploadBox: {
    height: 140,
    borderWidth: 2,
    borderColor: "#d63384",
    borderStyle: "dashed",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff0f5",
    marginBottom: 25,
    overflow: "hidden",
  },
  imagePreview: { 
    width: "100%", 
    height: "100%", 
    borderRadius: 14,
  },
  uploadPlaceholder: {
    alignItems: "center",
    padding: 20,
  },
  uploadText: { 
    color: "#d63384", 
    fontSize: 16,
    fontWeight: "600",
    marginTop: 8,
  },
  uploadSubText: {
    color: "#999",
    fontSize: 12,
    marginTop: 4,
  },
  // Info card
  infoCard: {
    flexDirection: "row",
    backgroundColor: "#fff0f5",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d63384",
    gap: 12,
  },
  infoText: {
    flex: 1,
    color: "#555",
    fontSize: 14,
    lineHeight: 20,
  },
  // Driver info
  driverInfoContainer: {
    flexDirection: "row",
    backgroundColor: "#f0fff0",
    padding: 16,
    borderRadius: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#28a745",
    gap: 12,
    alignItems: "center",
  },
  driverInfoTextContainer: {
    flex: 1,
  },
  driverInfoTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#28a745",
    marginBottom: 4,
  },
  driverInfoText: {
    color: "#333",
    fontSize: 14,
  },
  // Terms container
  termsContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  termsIcon: {
    marginBottom: 20,
  },
  termsIntro: {
    fontSize: 16,
    color: "#555",
    marginBottom: 25,
    lineHeight: 24,
    textAlign: "center",
    paddingHorizontal: 10,
  },
  termsRow: { 
    flexDirection: "row", 
    alignItems: "center", 
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#d63384',
    marginRight: 12,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { 
    backgroundColor: '#d63384',
  },
  termsText: { 
    flex: 1, 
    fontSize: 15, 
    color: "#444",
    lineHeight: 22,
  },
  linkText: {
    color: '#d63384',
    fontWeight: "bold",
    textDecorationLine: "underline",
  },
  // Navigation buttons
  navigationWrapper: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  nextButton: {
    backgroundColor: "#d63384",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    elevation: 3,
  },
  backButton: {
    backgroundColor: "#d63384",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    elevation: 3,
  },
  disabledButton: {
    opacity: 0.5,
  },
  nextText: { 
    color: "#fff", 
    fontSize: 16, 
    fontWeight: "bold",
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
    paddingTop: 50,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#d63384",
  },
  modalCloseButton: {
    padding: 8,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  modalText: {
    fontSize: 15,
    lineHeight: 24,
    color: "#444",
  },
  modalButton: {
    backgroundColor: "#d63384",
    paddingVertical: 16,
    marginHorizontal: 20,
    marginVertical: 20,
    borderRadius: 30,
    alignItems: "center",
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  // Loading overlay
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#d63384',
    fontWeight: 'bold',
  },
});

const pickerStyle = {
  inputIOS: {
    fontSize: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    color: "#000",
    backgroundColor: "#f8f9fa",
    marginBottom: 10,
  },
  inputAndroid: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    color: "#000",
    backgroundColor: "#f8f9fa",
    marginBottom: 10,
  },
  placeholder: {
    color: "#999",
  },
};
