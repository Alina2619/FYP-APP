import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import { TripProvider } from './contexts/TripContext';


// ✅ Import Firebase services from your config
import './firebaseConfig'; // This initializes Firebase ONCE
import { auth } from './firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';

// Import your screens
import SignUpScreen from './Screens/SignUpScreen';
import EmailVerificationScreen from './Screens/EmailVerificationScreen';
import LoginScreen from './Screens/LoginScreen';
import SetupScreen from './Screens/SetupScreen';
import DriverSetup1 from './Screens/DriverSetup1'; 
import DriverSetupLoading from './Screens/DriverSetupLoading'; 
import DriverDashboard from './Screens/DriverDashboard';
import WelcomeScreen from './Screens/WelcomeScreen';
import TripLogger from './Screens/TripLogger';
import FamilySetupWizarda from './Screens/FamilyDetails';
import FamilyDashboardScreen from './Screens/FamilyDashboard'; 
import DriveMateDashboard from './Screens/Emergency';
import ForgotPasswordScreen from './Screens/ForgotPassword';
import ResetLinkSentScreen from './Screens/RecentLink';
import DriverDetailsScreen from './Screens/DriverDetailsScreen';
import ProfileLinkageScreen from './Screens/ProfileLinkageScreen';
import DriverTrackingScreen from './Screens/DriverTrackingScreen';
import DriverSettings from './Screens/DriverSettings';
import FamilySettings from './Screens/FamilySettings';
import GeoFence from './Screens/GeoFence';
import FamilyAlerts from './Screens/FamilyAlerts';
import Analytcis from './Screens/Analytics';
import DriveModeScreen from './Screens/DriveModeScreen';  

// Ignore specific warnings
LogBox.ignoreLogs([
  'Firebase: Firebase App named',
  'AsyncStorage has been extracted',
]);
LogBox.ignoreAllLogs();

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Tab Navigator for Dashboard
const MainTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          
          if (route.name === 'DriverDashboard') {
            iconName = focused ? 'car-sport' : 'car-sport-outline';
          } else if (route.name === 'TripLogger') {
            iconName = focused ? 'document-text' : 'document-text-outline';
          } else if (route.name === 'Emergency') {
            iconName = focused ? 'alert-circle' : 'alert-circle-outline';
          } else if (route.name === 'Analytics') {
            iconName = focused ? 'stats-chart' : 'stats-chart-outline';
          } else if (route.name === 'DriverSettings') {
            iconName = focused ? 'settings' : 'settings-outline';
          }
          
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#4f46e5',
        tabBarInactiveTintColor: '#6b7280',
        tabBarStyle: styles.tabBar,
        headerShown: false,
      })}
    >
      <Tab.Screen name="DriverDashboard" component={DriverDashboard} />
      <Tab.Screen name="TripLogger" component={TripLogger} />
      <Tab.Screen name="Emergency" component={DriveMateDashboard} />
      <Tab.Screen name="Analytics" component={Analytcis} />
      <Tab.Screen name="DriverSettings" component={DriverSettings} />
    </Tab.Navigator>
  );
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    console.log('App: Setting up auth listener...');
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('Auth state changed, user:', user ? user.uid : 'null');
      
      if (user) {
        // User is signed in (either by email or anonymous)
        console.log('User authenticated:', user.uid, 'Email:', user.email || 'Anonymous');
        setIsAuthenticated(true);
        setAuthError(null);
        setLoading(false);
      } else {
        // No user is signed in - don't attempt anonymous sign-in
        console.log('No user signed in. User will need to log in.');
        setIsAuthenticated(false);
        setAuthError(null);
        setLoading(false);
      }
    }, (error) => {
      console.error('Auth state listener error:', error);
      
      // Handle specific auth errors
      if (error.code === 'auth/admin-restricted-operation') {
        console.log('Anonymous auth is disabled. This is expected behavior.');
        setAuthError(null); // Not really an error, just anonymous auth is disabled
        setIsAuthenticated(false);
      } else {
        setAuthError(error.message);
      }
      setLoading(false);
    });

    return () => {
      console.log('App: Cleaning up auth listener');
      unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, styles.centerContent]}>
        <ActivityIndicator size="large" color="#4f46e5" />
        <Text style={styles.loadingText}>Initializing DriveMate...</Text>
      </View>
    );
  }

  // Only show error if it's a real error (not just anonymous auth disabled)
  if (authError && !authError.includes('admin-restricted-operation')) {
    return (
      <View style={[styles.loadingContainer, styles.centerContent]}>
        <Text style={styles.errorText}>Authentication Error</Text>
        <Text style={styles.errorSubtext}>{authError}</Text>
        <Text style={styles.errorHint}>Please restart the app</Text>
      </View>
    );
  }

  // Determine initial route based on authentication
  const initialRoute = isAuthenticated ? "MainTabs" : "welcome";

  return (
    <TripProvider>       
      <NavigationContainer>
        <Stack.Navigator 
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false
          }}
        >
          {/* Auth Screens */}
          <Stack.Screen name="welcome" component={WelcomeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="SignUp" component={SignUpScreen} />
          <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} /> 
          <Stack.Screen name="ResetLinkSent" component={ResetLinkSentScreen} />
          
          {/* Setup Screens */}
          <Stack.Screen name="Setup" component={SetupScreen} />
          <Stack.Screen name="WelcomeScreen" component={WelcomeScreen} />
          <Stack.Screen name="DriverSetup1" component={DriverSetup1} />
          <Stack.Screen name="DriverSetupLoading" component={DriverSetupLoading} />
          
          {/* Main App Screens */}
          <Stack.Screen name="MainTabs" component={MainTabNavigator} />
          <Stack.Screen name="DriverDashboard" component={DriverDashboard} />   
          <Stack.Screen name="TripLogger" component={TripLogger} />
          <Stack.Screen name="Analytics" component={Analytcis} />
          <Stack.Screen name="Emergency" component={DriveMateDashboard} />
          <Stack.Screen name="DriveModeScreen" component={DriveModeScreen} />
          {/* Family Screens */}
          <Stack.Screen name="FamilyDetails" component={FamilySetupWizarda} />
          <Stack.Screen name="FamilyDashboard" component={FamilyDashboardScreen} />
          <Stack.Screen name="DriverDetailsScreen" component={DriverDetailsScreen} />
          <Stack.Screen name="ProfileLinkageScreen" component={ProfileLinkageScreen}/>
          <Stack.Screen name='DriverTracking' component={DriverTrackingScreen} />
          <Stack.Screen name='DriverSettings' component={DriverSettings} />
          <Stack.Screen name='FamilySettings' component={FamilySettings} />
          <Stack.Screen name='GeoFence' component={GeoFence} />
          <Stack.Screen name='FamilyAlerts' component={FamilyAlerts} />
        </Stack.Navigator>
      </NavigationContainer>
    </TripProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f9fafb',
    padding: 20,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#4f46e5',
    fontWeight: '500',
  },
  errorText: {
    fontSize: 20,
    color: '#ef4444',
    fontWeight: '700',
    marginBottom: 10,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  errorHint: {
    fontSize: 12,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  tabBar: {
    height: 60,
    paddingBottom: 5,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  }
});