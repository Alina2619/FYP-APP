import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import Footer from '../Components/Footer';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const DriverSetupLoading = () => {
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fetchName = async () => {
      try {
        const auth = getAuth();
        const db = getFirestore();
        const user = auth.currentUser;

        if (user) {
          const userDoc = await getDoc(doc(db, 'users', user.uid)); // 'users' collection
          if (userDoc.exists()) {
            setFullName(userDoc.data().name || 'User');
          }
        }
      } catch (error) {
        console.error('Error fetching name:', error);
        setFullName('User');
      }

      setLoading(false);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }).start();
    };

    fetchName();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {loading ? (
          <>
            <ActivityIndicator size="large" color="#2E8B57" />
            <Text style={styles.loadingText}>Just setting you up...</Text>
          </>
        ) : (
          <Animated.View style={{ opacity: fadeAnim }}>
            <Text style={styles.welcomeText}>Welcome, {fullName}!</Text>
          </Animated.View>
        )}
      </View>
      <Footer />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'lightblue',
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 18,
    color: '#2E8B57',
    fontWeight: '500',
  },
  welcomeText: {
    fontSize: 24,
    color: '#2E8B57',
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default DriverSetupLoading;
