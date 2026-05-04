import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import Footer from '../Components/Footer';


export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');

  const handleSendLink = async () => {
    if (!email) {
      console.warn('Validation Error: Please enter your email address.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      navigation.navigate('ResetLinkSent', { email });
    } catch (error) {
      console.error('Firebase reset error:', error);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerWrapper}>
        <Text style={styles.title}>Forgot Password</Text>
        <Text style={styles.subTitle}>Enter your registered email</Text>
        <Text style={styles.smallText}>We’ll send you a reset link</Text>
      </View>

      {/* Centered Form */}
      <View style={styles.formContainer}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <Pressable style={styles.nextButton} onPress={handleSendLink}>
          <Text style={styles.nextText}>Send Reset Link</Text>
        </Pressable>
      </View>
        <View style={styles.footerFixed}>
                          <Footer />
                        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerWrapper: {
    paddingTop: 60,
    paddingBottom: 20,
    alignItems: 'center',
    backgroundColor: '#1d807c',
    borderBottomLeftRadius: 80,
    borderBottomRightRadius: 80,
  },
  title: { fontSize: 34, fontWeight: 'bold', color: '#fff' },
  subTitle: { fontSize: 20, color: '#fff', marginTop: 8 },
  smallText: { fontSize: 16, color: '#fff', marginTop: 6, textDecorationLine: 'underline' },
  formContainer: { flex: 1, paddingHorizontal: 20, justifyContent: 'center' },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 16, marginBottom: 8, color: '#333', textAlign: 'center' },
  input: {
    borderWidth: 2,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    textAlign: 'center',
  },
  nextButton: {
    backgroundColor: '#1d807c',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    alignSelf: 'center',
    marginTop: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
});
