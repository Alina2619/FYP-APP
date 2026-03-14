import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import Footer from '../Components/Footer';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const SetupScreen = ({ navigation, route }) => {
  const [selectedRole, setSelectedRole] = useState(null);

  const auth = getAuth();
  const db = getFirestore();

  
  const { name, phone } = route.params || {};

  const handleNext = async () => {
    if (!selectedRole) {
      Alert.alert('Please select a role');
      return;
    }

    try {
      const user = auth.currentUser;

      if (!user) {
        Alert.alert('Error', 'User not authenticated. Please log in again.');
        return;
      }

  
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          email: user.email,
          name: name || '',
          phone: phone || '',
          role: selectedRole,
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );

      console.log('✅ Profile saved in Firestore');

      if (selectedRole === 'Driver') {
        navigation.replace('DriverSetup1', { from: 'Setup' });
      } else if (selectedRole === 'Family') {
        navigation.replace('FamilyDetails', { from: 'Setup' });
      }
    } catch (error) {
      console.error('❌ Error saving profile:', error);
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerWrapper}>
        <Text style={styles.title}>Drivemate</Text>
        <Text style={styles.subTitle}>Setting you up</Text>
        <Text style={styles.smallText}>Who are you?</Text>
      </View>

      {/* Role Selection */}
      <View style={styles.optionsContainer}>
        <TouchableOpacity
          style={[
            styles.optionBox,
            selectedRole === 'Driver' && styles.selectedBox,
          ]}
          onPress={() => setSelectedRole('Driver')}
        >
          <Text style={styles.optionText}>🚗 Driver</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.optionBox,
            selectedRole === 'Family' && styles.selectedBox,
          ]}
          onPress={() => setSelectedRole('Family')}
        >
          <Text style={styles.optionText}>👨‍👩‍👧‍👦 Family</Text>
        </TouchableOpacity>
      </View>

      {/* Next Button */}
      <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
        <Text style={styles.nextText}>Next ➜</Text>
      </TouchableOpacity>

      {/* Footer */}
      <Footer />
    </View>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'space-between',
  },
  headerWrapper: {
    paddingTop: 60,
    paddingBottom: 20,
    alignItems: 'center',
    backgroundColor: '#1d807c',
    borderBottomLeftRadius: 80,
    borderBottomRightRadius: 80,
  },
  title: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#fff',
  },
  subTitle: {
    fontSize: 20,
    color: '#fff',
    marginTop: 8,
  },
  smallText: {
    fontSize: 16,
    color: '#fff',
    marginTop: 6,
    textDecorationLine: 'underline',
  },
  optionsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  optionBox: {
    borderWidth: 3,
    borderColor: '#ccc',
    borderRadius: 14,
    paddingVertical: 50,
    paddingHorizontal: 18,
    marginBottom: 20,
    alignItems: 'center',
  },
  selectedBox: {
    borderColor: '#1d807c',
    backgroundColor: '#e0f7f5',
  },
  optionText: {
    fontSize: 25,
    color: '#333',
  },
  nextButton: {
    backgroundColor: '#1d807c',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    position: 'absolute',
    bottom: 100,
    right: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  nextText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SetupScreen;
