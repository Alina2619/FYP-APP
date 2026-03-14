import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  Alert,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { getFirestore, doc, setDoc, deleteDoc } from "firebase/firestore";
import Footer from '../Components/Footer';

const SignUpScreen = ({ navigation }) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  const db = getFirestore();

  // Validation functions
  const validateFirstName = (text) => {
    const trimmed = text.trim();
    let error = '';
    
    if (!trimmed) {
      error = 'First name is required';
    } else if (trimmed.length < 2) {
      error = 'First name must be at least 2 characters';
    } else if (trimmed.length > 50) {
      error = 'First name cannot exceed 50 characters';
    } else if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) {
      error = 'First name can only contain letters, spaces, hyphens, and apostrophes';
    }
    
    return error;
  };

  const validateLastName = (text) => {
    const trimmed = text.trim();
    let error = '';
    
    if (!trimmed) {
      error = 'Last name is required';
    } else if (trimmed.length < 2) {
      error = 'Last name must be at least 2 characters';
    } else if (trimmed.length > 50) {
      error = 'Last name cannot exceed 50 characters';
    } else if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) {
      error = 'Last name can only contain letters, spaces, hyphens, and apostrophes';
    }
    
    return error;
  };

  const validateEmail = (text) => {
    const trimmed = text.replace(/\s/g, '').toLowerCase();
    let error = '';
    
    if (!trimmed) {
      error = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      error = 'Please enter a valid email address';
    } else if (trimmed.length > 100) {
      error = 'Email cannot exceed 100 characters';
    }
    
    return error;
  };

  const validatePassword = (text) => {
    const trimmed = text.replace(/\s/g, '');
    let error = '';
    
    if (!trimmed) {
      error = 'Password is required';
    } else if (trimmed.length < 8) {
      error = 'Password must be at least 8 characters';
    } else if (trimmed.length > 50) {
      error = 'Password cannot exceed 50 characters';
    } else if (!/(?=.*[a-z])/.test(trimmed)) {
      error = 'Password must contain at least one lowercase letter';
    } else if (!/(?=.*[A-Z])/.test(trimmed)) {
      error = 'Password must contain at least one uppercase letter';
    } else if (!/(?=.*\d)/.test(trimmed)) {
      error = 'Password must contain at least one number';
    } else if (!/(?=.*[@$!%*?&])/.test(trimmed)) {
      error = 'Password must contain at least one special character (@$!%*?&)';
    }
    
    return error;
  };

  const validateConfirmPassword = (text, currentPassword) => {
    const trimmed = text.replace(/\s/g, '');
    let error = '';
    
    if (!trimmed) {
      error = 'Please confirm your password';
    } else if (trimmed !== currentPassword) {
      error = 'Passwords do not match';
    }
    
    return error;
  };

  // Handle input changes with validation
  const handleFirstNameChange = (text) => {
    setFirstName(text);
    setErrors(prev => ({
      ...prev,
      firstName: validateFirstName(text)
    }));
  };

  const handleLastNameChange = (text) => {
    setLastName(text);
    setErrors(prev => ({
      ...prev,
      lastName: validateLastName(text)
    }));
  };

  const handleEmailChange = (text) => {
    const trimmed = text.replace(/\s/g, '').toLowerCase();
    setEmail(trimmed);
    setErrors(prev => ({
      ...prev,
      email: validateEmail(trimmed)
    }));
  };

  const handlePasswordChange = (text) => {
    const trimmed = text.replace(/\s/g, '');
    setPassword(trimmed);
    setErrors(prev => ({
      ...prev,
      password: validatePassword(trimmed),
      confirmPass: confirmPass ? validateConfirmPassword(confirmPass, trimmed) : ''
    }));
  };

  const handleConfirmPassChange = (text) => {
    const trimmed = text.replace(/\s/g, '');
    setConfirmPass(trimmed);
    setErrors(prev => ({
      ...prev,
      confirmPass: validateConfirmPassword(trimmed, password)
    }));
  };

  // Validate all fields before submission
  const validateAllFields = () => {
    const newErrors = {
      firstName: validateFirstName(firstName),
      lastName: validateLastName(lastName),
      email: validateEmail(email),
      password: validatePassword(password),
      confirmPass: validateConfirmPassword(confirmPass, password)
    };

    setErrors(newErrors);

    return !Object.values(newErrors).some(error => error !== '');
  };

  const handleSignup = async () => {
    // Validate all fields before proceeding
    if (!validateAllFields()) {
      Alert.alert('Validation Error', 'Please fix the errors in the form before submitting.');
      return;
    }

    try {
      setIsLoading(true);

      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCred.user;

      // Update user profile with display name
      await updateProfile(user, {
        displayName: `${firstName} ${lastName}`
      });

      // Create user document in Firestore
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        fullName: `${firstName.trim()} ${lastName.trim()}`,
        email: email,
        role: "pending",
        emailVerified: false,
        createdAt: new Date().toISOString(),
        profileCompleted: false,
        setupCompleted: false
      });

      // Send email verification
      await sendEmailVerification(user);
      
      Alert.alert(
        'Verify Your Email', 
        'A verification email has been sent to your email address. Please verify your email within 5 minutes to complete your registration.',
        [
          { 
            text: 'OK', 
            onPress: () => navigation.navigate('EmailVerification', { 
              uid: user.uid, 
              email: user.email 
            })
          }
        ]
      );

      // Set timeout for email verification (5 minutes)
      setTimeout(async () => {
        try {
          // Reload user to get latest email verification status
          await user.reload();
          
          if (!user.emailVerified) {
            // Delete unverified user account
            await user.delete();
            
            // Delete the user document from Firestore
            await deleteDoc(doc(db, "users", user.uid));
            
            Alert.alert(
              'Verification Timeout', 
              'You did not verify your email within 5 minutes. Please register again.',
              [{ text: 'OK' }]
            );
          }
        } catch (error) {
          console.error('Error in verification timeout cleanup:', error);
          // Don't show alert for timeout cleanup errors to avoid confusing the user
        }
      }, 5 * 60 * 1000); // 5 minutes

    } catch (error) {
      console.error('Signup error:', error);
      
      let errorMessage = 'Signup Failed. Please try again.';
      
      // Firebase specific error messages
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = 'This email is already registered. Please login instead or use a different email.';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address format. Please check your email and try again.';
          break;
        case 'auth/weak-password':
          errorMessage = 'Password is too weak. Please use a stronger password with at least 8 characters including uppercase, lowercase, numbers, and special characters.';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Email/password accounts are not enabled. Please contact support.';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Network error. Please check your internet connection and try again.';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many unsuccessful attempts. Please try again later.';
          break;
        default:
          errorMessage = error.message || 'An unexpected error occurred. Please try again.';
      }
      
      Alert.alert('Signup Failed', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Check if form is valid for enabling the submit button
  const isFormValid = () => {
    return firstName.trim() && 
           lastName.trim() && 
           email && 
           password && 
           confirmPass && 
           !errors.firstName && 
           !errors.lastName && 
           !errors.email && 
           !errors.password && 
           !errors.confirmPass;
  };

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1d807c" />
          <Text style={styles.loadingText}>Creating your account...</Text>
        </View>
      )}
      
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
      
          <View style={styles.headerWrapper}>
            <View style={styles.pinkHeader}>
              <Text style={styles.headerTitle}>Drivemate</Text>
              <Text style={styles.subTitle}>CREATE ACCOUNT</Text>
              <Text style={styles.underline}>Sign Up Here</Text>
            </View>
            <View style={styles.curve} />
          </View>

          <View style={styles.formContainer}>
            {/* First Name */}
            <View>
              <TextInput
                placeholder="First Name *"
                placeholderTextColor="#000"
                value={firstName}
                onChangeText={handleFirstNameChange}
                style={[styles.input, errors.firstName && styles.inputError]}
                returnKeyType="next"
                autoCapitalize="words"
                maxLength={50}
                editable={!isLoading}
              />
              {errors.firstName ? <Text style={styles.errorText}>{errors.firstName}</Text> : null}
            </View>

            {/* Last Name */}
            <View>
              <TextInput
                placeholder="Last Name *"
                placeholderTextColor="#000"
                value={lastName}
                onChangeText={handleLastNameChange}
                style={[styles.input, errors.lastName && styles.inputError]}
                returnKeyType="next"
                autoCapitalize="words"
                maxLength={50}
                editable={!isLoading}
              />
              {errors.lastName ? <Text style={styles.errorText}>{errors.lastName}</Text> : null}
            </View>

            {/* Email */}
            <View>
              <TextInput
                placeholder="Email *"
                placeholderTextColor="#000"
                value={email}
                onChangeText={handleEmailChange}
                keyboardType="email-address"
                autoCapitalize="none"
                style={[styles.input, errors.email && styles.inputError]}
                returnKeyType="next"
                maxLength={100}
                editable={!isLoading}
              />
              {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
            </View>
            
            {/* Password */}
            <View>
              <View style={[styles.passwordContainer, errors.password && styles.inputError]}>
                <TextInput
                  placeholder="Password (min 8 characters) *"
                  placeholderTextColor="#000"
                  value={password}
                  onChangeText={handlePasswordChange}
                  secureTextEntry={!showPassword}
                  style={styles.passwordInput}
                  returnKeyType="next"
                  autoCapitalize="none"
                  maxLength={50}
                  editable={!isLoading}
                />
                <TouchableOpacity
                  style={styles.eyeIcon}
                  onPress={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  <Ionicons
                    name={showPassword ? "eye-off" : "eye"}
                    size={24}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
            </View>

            {/* Confirm Password */}
            <View>
              <View style={[styles.passwordContainer, errors.confirmPass && styles.inputError]}>
                <TextInput
                  placeholder="Confirm Password *"
                  placeholderTextColor="#000"
                  value={confirmPass}
                  onChangeText={handleConfirmPassChange}
                  secureTextEntry={!showConfirmPassword}
                  style={styles.passwordInput}
                  returnKeyType="done"
                  autoCapitalize="none"
                  maxLength={50}
                  editable={!isLoading}
                />
                <TouchableOpacity
                  style={styles.eyeIcon}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={isLoading}
                >
                  <Ionicons
                    name={showConfirmPassword ? "eye-off" : "eye"}
                    size={24}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
              {errors.confirmPass ? <Text style={styles.errorText}>{errors.confirmPass}</Text> : null}
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[
                  styles.signupButton,
                  (!isFormValid() || isLoading) && styles.signupButtonDisabled
                ]}
                onPress={handleSignup}
                disabled={!isFormValid() || isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.signupButtonText}>
                    Sign Up
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={isLoading}>
              <Text style={styles.loginLink}>
                Already have an account? <Text style={styles.loginText}>Login</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footerFixed}>
        <Footer />
      </View>
    </View>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#fff' 
  },
  scrollContent: { 
    flexGrow: 1,
    paddingBottom: 70 
  },
  headerWrapper: { 
    position: 'relative', 
    backgroundColor: '#1d807c' 
  },
  pinkHeader: { 
    paddingTop: 60, 
    paddingBottom: 30, 
    alignItems: 'center', 
    backgroundColor: '#1d807c' 
  },
  curve: {
    width: width,
    height: 40,
    backgroundColor: '#fff',
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    marginTop: -10,
  },
  headerTitle: { 
    fontSize: 34, 
    fontWeight: 'bold', 
    color: '#fff' 
  },
  subTitle: { 
    fontSize: 20, 
    color: '#fff', 
    marginTop: 8 
  },
  underline: { 
    fontSize: 16, 
    color: '#fff', 
    textDecorationLine: 'underline', 
    marginTop: 6 
  },
  formContainer: { 
    padding: 24 
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 16,
    marginBottom: 8,
    backgroundColor: '#fff',
    color: '#000',
  },
  inputError: {
    borderColor: '#dc3545',
    borderWidth: 2,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 16,
    color: "#000",
  },
  eyeIcon: {
    padding: 10,
  },
  errorText: {
    color: '#dc3545',
    fontSize: 14,
    marginBottom: 12,
    marginLeft: 4,
  },
  buttonContainer: { 
    marginTop: 10, 
    marginBottom: 20, 
    borderRadius: 8, 
    overflow: 'hidden' 
  },
  signupButton: {
    backgroundColor: '#1d807c', // Matching header color
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1d807c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  signupButtonDisabled: {
    backgroundColor: '#9bc5c3', // Lighter version when disabled
    shadowOpacity: 0.1,
  },
  signupButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loginLink: { 
    textAlign: 'center', 
    color: '#444', 
    fontSize: 16 
  },
  loginText: { 
    fontWeight: 'bold', 
    color: '#1d807c' // Changed to match header color
  },
  footerFixed: {
    position: 'absolute',
    left: 0, 
    right: 0, 
    bottom: 0,
    backgroundColor: '#fff',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#1d807c',
    fontWeight: 'bold',
  }
});

export default SignUpScreen;