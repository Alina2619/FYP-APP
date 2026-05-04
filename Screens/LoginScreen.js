import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  Alert,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import Footer from '../Components/Footer';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Remove spaces from email and password
  const handleEmailChange = (text) => {
    setEmail(text.replace(/\s/g, ''));
  };

  const handlePasswordChange = (text) => {
    setPassword(text);
  };

  const handleLogin = async () => {
    // Remove any spaces that might have been entered
    const trimmedEmail = email.replace(/\s/g, '');
    const trimmedPassword = password.replace(/\s/g, '');
    
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      Alert.alert('Error', 'Enter a valid email address');
      return;
    }
    if (trimmedPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long');
      return;
    }

    setLoading(true);
    
    try {
      // Sign in user
      const userCred = await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);

      if (!userCred.user.emailVerified) {
        Alert.alert('Email Not Verified', 'Please verify your email before logging in.');
        setLoading(false);
        return;
      }

      // Fetch user data from Firestore
      const uid = userCred.user.uid;
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const userData = docSnap.data();
        const role = userData.role;
        const accountStatus = userData.accountStatus;
        
        // ** IMPORTANT: Check account status FIRST **
        // Block login if account is deactivated or suspended
        if (accountStatus === 'deactivated') {
          // Sign out the user immediately
          await auth.signOut();
          Alert.alert(
            'Account Deactivated',
            'Your account has been deactivated. Please contact support for assistance.',
            [{ text: 'OK' }]
          );
          setLoading(false);
          return;
        }
        
        if (accountStatus === 'suspended') {
          // Sign out the user immediately
          await auth.signOut();
          const suspensionReason = userData.suspensionReason || 'No reason provided';
          Alert.alert(
            'Account Suspended',
            `Your account has been temporarily suspended.\n\nReason: ${suspensionReason}\n\nPlease contact support for more information.`,
            [{ text: 'OK' }]
          );
          setLoading(false);
          return;
        }

        // Only proceed if account is active
        if (accountStatus !== 'active') {
          await auth.signOut();
          Alert.alert(
            'Account Issue',
            `Your account status is "${accountStatus}". Please contact support.`,
            [{ text: 'OK' }]
          );
          setLoading(false);
          return;
        }

        // Redirect according to role
        if (!role || role === 'pending') {
          navigation.replace('Setup');
        } 
        // Check for Driver (case insensitive)
        else if (role === 'Driver' || role === 'driver' || role === 'DRIVER') {
          navigation.replace('DriverDashboard');
        } 
        // Check for Family (case insensitive)
        else if (role === 'Family' || role === 'family' || role === 'FAMILY') {
          navigation.replace('FamilyDashboard');
        } 
        else {
          Alert.alert('Login Error', 'Invalid role found in your account.');
          await auth.signOut();
        }
      } else {
        Alert.alert('Login Error', 'User data not found in database.');
        await auth.signOut();
      }

    } catch (error) {
      let errorMessage = 'Login Failed';
      
      // More specific error messages
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email address';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password. Please try again.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address format';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later.';
      } else {
        errorMessage = error.message;
      }
      
      Alert.alert('Login Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.headerWrapper}>
        <View style={styles.greenHeader}>
          <Text style={styles.headerTitle}>Drivemate</Text>
          <Text style={styles.subTitle}>WELCOME BACK</Text>
          <Text style={styles.underline}>Login Here</Text>
        </View>
        <View style={styles.curve} />
      </View>

      <View style={styles.formContainer}>
        <TextInput
          placeholder="Email"
          placeholderTextColor="#999"
          value={email}
          onChangeText={handleEmailChange}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
        />
        
        <View style={styles.passwordContainer}>
          <TextInput
            placeholder="Password"
            placeholderTextColor="#999"
            value={password}
            onChangeText={handlePasswordChange}
            secureTextEntry={!showPassword}
            style={styles.passwordInput}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="none"
            passwordRules={null}
          />
          <TouchableOpacity
            style={styles.eyeIcon}
            onPress={() => setShowPassword(!showPassword)}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={24}
              color="#666"
            />
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          <Button 
            title={loading ? "Logging in..." : "Login"} 
            color="#1d807c" 
            onPress={handleLogin}
            disabled={loading}
          />
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
          <Text style={styles.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.replace('SignUp')}>
          <Text style={styles.loginLink}>
            Don't have an account? <Text style={styles.loginText}>Sign Up</Text>
          </Text>
        </TouchableOpacity>
      </View>

      <Footer />
    </ScrollView>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  scrollContainer: {
    backgroundColor: '#fff',
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  headerWrapper: {
    position: 'relative',
    backgroundColor: '#1d807c',
  },
  greenHeader: {
    paddingTop: 60,
    paddingBottom: 30,
    alignItems: 'center',
    backgroundColor: '#1d807c',
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
    color: '#fff',
  },
  subTitle: {
    fontSize: 20,
    color: '#fff',
    marginTop: 8,
  },
  underline: {
    fontSize: 16,
    color: '#fff',
    textDecorationLine: 'underline',
    marginTop: 6,
  },
  formContainer: {
    padding: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 16,
    marginBottom: 18,
    color: '#000',
    backgroundColor: '#fff',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    marginBottom: 18,
    backgroundColor: '#fff',
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fff',
  },
  eyeIcon: {
    padding: 10,
  },
  buttonContainer: {
    marginTop: 10,
    marginBottom: 20,
    borderRadius: 8,
    overflow: 'hidden',
  },
  forgotText: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 16,
  },
  loginLink: {
    textAlign: 'center',
    color: '#444',
    fontSize: 16,
  },
  loginText: {
    fontWeight: 'bold',
    color: '#e91e63',
  },
});

export default LoginScreen;
