import React, { useState } from 'react';
import {
  View,
  Text,
  Button,
  Alert,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { auth, db } from '../firebaseConfig';
import { setDoc, doc } from 'firebase/firestore';
import { reload } from 'firebase/auth';
import Footer from '../Components/Footer';

const EmailVerificationScreen = ({ route, navigation }) => {
  const { email, firstName, lastName, phone, uid, role, createdAt } = route.params;
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(false);

  const checkVerification = async () => {
    setChecking(true);

    try {
      
      if (!auth.currentUser) {
        Alert.alert('Error', 'User session expired. Please log in again.');
        setChecking(false);
        return;
      }

      await reload(auth.currentUser);
      const currentUser = auth.currentUser;

      if (!currentUser) {
        Alert.alert('Error', 'User is not signed in.');
        setChecking(false);
        return;
      }

      const isVerified = currentUser.emailVerified;
      setVerified(isVerified);

      if (isVerified) {
        const userData = {
          uid: uid ?? '',
          firstName: firstName ?? '',
          lastName: lastName ?? '',
          email: email ?? '',
          phone: phone ?? '',
          role: role ?? 'pending',
          createdAt: createdAt ?? new Date().toISOString(),
        };

        await setDoc(doc(db, 'users', uid), userData);
        Alert.alert('Success', 'Email verified and data saved!');
        navigation.replace('Setup');
      } else {
        Alert.alert('Not Verified', 'Please verify your email first.');
      }

    } catch (error) {
      console.error('Verification error:', error);
      Alert.alert('Error', error.message);
    }

    setChecking(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.container}>
        <Text style={styles.title}>Verify Your Email</Text>
        <Text style={styles.text}>
          A verification link has been sent to:{'\n'}
          <Text style={styles.email}>{email}</Text>
        </Text>
        <Text style={styles.subText}>
          Please check your inbox or spam and click the link to verify.
        </Text>

        {checking ? (
          <ActivityIndicator size="large" color="#1d807c" style={{ marginTop: 20 }} />
        ) : (
          <Button title="I have verified" color="#1d807c" onPress={checkVerification} />
        )}
      </View>

      <Footer />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'space-between',
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    padding: 30,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#1d807c',
    textAlign: 'center',
  },
  text: {
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center',
  },
  email: {
    color: '#e91e63',
    fontWeight: 'bold',
  },
  subText: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 30,
  },
});

export default EmailVerificationScreen;
