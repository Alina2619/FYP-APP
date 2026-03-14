import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Image,
  ActivityIndicator,
  FlatList,
  Alert,
  Modal,
  RefreshControl,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  getDoc, 
  updateDoc, 
  collection,
  setDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
  writeBatch,
  arrayUnion,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { WebView } from 'react-native-webview';
import * as turf from '@turf/turf';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const GeofenceManagementScreen = ({ navigation }) => {
  const [userData, setUserData] = useState(null);
  const [linkedDrivers, setLinkedDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [region, setRegion] = useState({
    latitude: 31.5204,
    longitude: 74.3587,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });
  const [fenceCoordinates, setFenceCoordinates] = useState([]);
  const [editingFence, setEditingFence] = useState(false);
  const [violations, setViolations] = useState({});
  const [showInstructions, setShowInstructions] = useState(false);
  const [mapType, setMapType] = useState('standard');
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationToken, setNotificationToken] = useState(null);
  const [geofenceAlerts, setGeofenceAlerts] = useState([]);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [activeViolations, setActiveViolations] = useState({});
  const [lastLocationChecks, setLastLocationChecks] = useState({});
  const [mapReady, setMapReady] = useState(false);
  const [selectedPoints, setSelectedPoints] = useState([]);
  
  // User preferences from settings
  const [userPreferences, setUserPreferences] = useState({
    geoFenceAlerts: true,
    boundaryAlerts: true,
    locationAlerts: true,
    emergencyAlerts: true,
  });

  // Track last alert times for each driver to prevent spam
  const lastAlertTimeRef = useRef({});
  const lastExitAlertTimeRef = useRef({});
  const alertCountRef = useRef({});
  
  // Refs
  const locationCheckInterval = useRef(null);
  const notificationListener = useRef(null);
  const responseListener = useRef(null);
  const driverListeners = useRef({});
  const tripListeners = useRef({});
  const violationCheckTimeout = useRef({});
  const isMounted = useRef(true);
  const webViewRef = useRef(null);
  const userPreferencesRef = useRef(userPreferences);

  // Update ref when preferences change
  useEffect(() => {
    userPreferencesRef.current = userPreferences;
  }, [userPreferences]);

  // User helpers
  const getUserName = useCallback(() =>
    userData?.fullName ||
    userData?.name ||
    userData?.displayName ||
    `${userData?.firstName || ''} ${userData?.lastName || ''}`.trim() ||
    userData?.email?.split('@')[0] ||
    'Family Admin'
  , [userData]);

  const getProfileImage = useCallback(() =>
    userData?.profileImage ||
    userData?.photoURL ||
    userData?.avatar ||
    userData?.imageUrl ||
    null
  , [userData]);

  const getDriverName = useCallback((driver) =>
    driver?.name ||
    driver?.fullName ||
    `${driver?.firstName || ''} ${driver?.lastName || ''}`.trim() ||
    driver?.email?.split('@')[0] ||
    'Driver'
  , []);

  const getDriverProfileImage = useCallback((driver) =>
    driver?.profileImage ||
    driver?.profileImg ||
    driver?.photoURL ||
    driver?.avatar ||
    driver?.imageUrl ||
    null
  , []);

  // Check if geofence alerts are enabled in user preferences
  const areGeofenceAlertsEnabled = useCallback(() => {
    return userPreferencesRef.current.geoFenceAlerts !== false && 
           userPreferencesRef.current.boundaryAlerts !== false;
  }, []);

  // Get driver location from multiple sources
  const getDriverCurrentLocation = useCallback(async (driverId) => {
    try {
      // 1. First check if driver has currentLocation in user document
      const driverRef = doc(db, "users", driverId);
      const driverSnap = await getDoc(driverRef);
      
      if (driverSnap.exists()) {
        const driverData = driverSnap.data();
        
        // If driver has currentLocation in user document
        if (driverData.currentLocation && 
            driverData.currentLocation.latitude && 
            driverData.currentLocation.longitude) {
          return {
            source: 'user_doc',
            location: driverData.currentLocation,
            timestamp: driverData.lastLocationUpdate || new Date()
          };
        }
      }
      
      // 2. Check for active trip location
      const tripsRef = collection(db, 'trips');
      const activeTripQuery = query(
        tripsRef,
        where('userId', '==', driverId),
        where('status', 'in', ['active', 'started', 'ongoing'])
      );
      
      const tripSnapshot = await getDocs(activeTripQuery);
      
      if (!tripSnapshot.empty) {
        const tripDocs = tripSnapshot.docs;
        // Get the most recent trip (first one)
        const tripDoc = tripDocs[0];
        const tripData = tripDoc.data();
        
        // Check if trip has location data
        if (tripData.currentLocation) {
          return {
            source: 'active_trip',
            location: tripData.currentLocation,
            timestamp: tripData.lastLocationUpdate || new Date()
          };
        }
        
        // Check if trip has route coordinates (use last point)
        if (tripData.routeCoordinates && tripData.routeCoordinates.length > 0) {
          const lastPoint = tripData.routeCoordinates[tripData.routeCoordinates.length - 1];
          return {
            source: 'trip_route',
            location: lastPoint,
            timestamp: tripData.lastLocationUpdate || new Date()
          };
        }
      }
      
      // 3. Check trips collection for recent location
      const recentTripsQuery = query(
        tripsRef,
        where('userId', '==', driverId),
        orderBy('startTime', 'desc')
      );
      
      const recentSnapshot = await getDocs(recentTripsQuery);
      if (!recentSnapshot.empty) {
        const recentTrip = recentSnapshot.docs[0].data();
        if (recentTrip.endLocation) {
          return {
            source: 'recent_trip_end',
            location: recentTrip.endLocation,
            timestamp: recentTrip.endTime || new Date()
          };
        }
      }
      
      // 4. Return null if no location found
      return null;
      
    } catch (error) {
      console.error(`Error getting location for driver ${driverId}:`, error);
      return null;
    }
  }, []);

  // Check if point is inside polygon
  const isPointInPolygon = useCallback((point, polygon) => {
    if (!polygon || polygon.length < 3) return true;
    
    try {
      // Validate coordinates
      const validPolygon = polygon.filter(p => 
        p && 
        typeof p.latitude === 'number' && 
        !isNaN(p.latitude) &&
        typeof p.longitude === 'number' &&
        !isNaN(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180
      );
      
      if (validPolygon.length < 3) {
        console.log('Invalid polygon: less than 3 valid points');
        return true;
      }
      
      // Ensure polygon is closed (first and last points are the same)
      const closedPolygon = [...validPolygon];
      const firstPoint = validPolygon[0];
      const lastPoint = validPolygon[validPolygon.length - 1];
      
      if (firstPoint.latitude !== lastPoint.latitude || 
          firstPoint.longitude !== lastPoint.longitude) {
        // Add first point at the end to close the polygon
        closedPolygon.push({...firstPoint});
      }
      
      // Create turf point and polygon
      const turfPoint = turf.point([point.longitude, point.latitude]);
      const turfPolygon = turf.polygon([
        closedPolygon.map(coord => [coord.longitude, coord.latitude])
      ]);
      
      return turf.booleanPointInPolygon(turfPoint, turfPolygon);
    } catch (error) {
      console.error('Error checking point in polygon:', error);
      return true; // Return true to prevent false alerts
    }
  }, []);

  // Initialize notifications
  useEffect(() => {
    isMounted.current = true;
    registerForPushNotificationsAsync();
    
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Geofence notification received:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response:', response);
      const data = response.notification.request.content.data;
      if (data.driverId) {
        setShowAlertsModal(true);
      }
    });

    return () => {
      isMounted.current = false;
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
      cleanupAllListeners();
      clearAllIntervals();
    };
  }, []);

  // Clean up all listeners
  const cleanupAllListeners = useCallback(() => {
    Object.values(driverListeners.current).forEach(unsubscribe => {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
    driverListeners.current = {};
    
    Object.values(tripListeners.current).forEach(unsubscribe => {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
    tripListeners.current = {};
  }, []);

  // Clean up intervals
  const clearAllIntervals = useCallback(() => {
    if (locationCheckInterval.current) {
      clearInterval(locationCheckInterval.current);
    }
    Object.values(violationCheckTimeout.current).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    violationCheckTimeout.current = {};
  }, []);

  // Register for push notifications
  const registerForPushNotificationsAsync = async () => {
    try {
      if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        
        if (finalStatus !== 'granted') {
          console.log('Push notification permission not granted');
          return;
        }
        
        const token = (await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig?.extra?.eas?.projectId,
        })).data;
        
        setNotificationToken(token);
        
        // Save token to user profile
        const auth = getAuth();
        const user = auth.currentUser;
        if (user && token) {
          const userRef = doc(db, "users", user.uid);
          await updateDoc(userRef, {
            notificationToken: token,
            notificationTokenUpdatedAt: serverTimestamp()
          });
        }
      }
    } catch (error) {
      console.error('Error getting push token:', error);
    }
  };

  // Send push notification
  const sendPushNotification = useCallback(async (title, body, data = {}) => {
    if (!notificationToken) return;

    try {
      const message = {
        to: notificationToken,
        sound: 'default',
        title: title,
        body: body,
        data: data,
        priority: 'high',
        badge: 1,
      };

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }, [notificationToken]);

  // Send local notification
  const sendLocalNotification = useCallback(async (title, body, data = {}) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: title,
          body: body,
          data: data,
          sound: true,
          badge: 1,
          vibrate: [0, 250, 250, 250],
        },
        trigger: null,
      });
    } catch (error) {
      console.error('Error scheduling notification:', error);
    }
  }, []);

  // Check if enough time has passed since last alert
  const canSendAlert = useCallback((driverId, type = 'exit') => {
    const now = Date.now();
    const lastAlertTime = type === 'exit' 
      ? lastExitAlertTimeRef.current[driverId] || 0
      : lastAlertTimeRef.current[driverId] || 0;
    
    // Check if 60 seconds (1 minute) have passed
    const timeSinceLastAlert = now - lastAlertTime;
    const canSend = timeSinceLastAlert >= 60000; // 60 seconds in milliseconds
    
    console.log(`Driver ${driverId} - Time since last ${type} alert: ${Math.round(timeSinceLastAlert/1000)}s, Can send: ${canSend}`);
    
    return canSend;
  }, []);

  // Update last alert time
  const updateLastAlertTime = useCallback((driverId, type = 'exit') => {
    const now = Date.now();
    if (type === 'exit') {
      lastExitAlertTimeRef.current[driverId] = now;
      
      // Initialize or increment alert count
      if (!alertCountRef.current[driverId]) {
        alertCountRef.current[driverId] = 1;
      } else {
        alertCountRef.current[driverId] += 1;
      }
      
      // Schedule reset after 60 seconds (to allow next alert)
      setTimeout(() => {
        // Don't reset, just let the time check handle it
        console.log(`Alert window reset for driver ${driverId}`);
      }, 60000);
    } else {
      lastAlertTimeRef.current[driverId] = now;
    }
  }, []);

  // Load user preferences from Firestore
  const loadUserPreferences = useCallback(async () => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return;

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const data = userSnap.data();
        setUserPreferences({
          geoFenceAlerts: data.geoFenceAlerts !== false,
          boundaryAlerts: data.boundaryAlerts !== false,
          locationAlerts: data.locationAlerts !== false,
          emergencyAlerts: data.emergencyAlerts !== false,
        });
      }
    } catch (error) {
      console.error('Error loading user preferences:', error);
    }
  }, []);

  // Load user data and linked drivers
  useEffect(() => {
    const auth = getAuth();
    
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserData(null);
        setLinkedDrivers([]);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", user.uid);
        
        // Get initial user data
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData(data);
          
          // Load user preferences
          await loadUserPreferences();
          
          // Load linked drivers
          if (data.linkedDrivers && data.linkedDrivers.length > 0) {
            await loadLinkedDrivers(data.linkedDrivers);
          } else {
            setLinkedDrivers([]);
          }
          
          // Load geofence alerts
          await loadGeofenceAlerts();
        }
        
        setLoading(false);
        
        // Set up real-time listener for user data
        return onSnapshot(userRef, async (docSnap) => {
          if (docSnap.exists() && isMounted.current) {
            const data = docSnap.data();
            
            // Update user preferences if they changed
            setUserPreferences({
              geoFenceAlerts: data.geoFenceAlerts !== false,
              boundaryAlerts: data.boundaryAlerts !== false,
              locationAlerts: data.locationAlerts !== false,
              emergencyAlerts: data.emergencyAlerts !== false,
            });
            
            // Update linked drivers if they changed
            if (JSON.stringify(data.linkedDrivers || []) !== 
                JSON.stringify(userData?.linkedDrivers || [])) {
              await loadLinkedDrivers(data.linkedDrivers || []);
            }
            
            setUserData(data);
          }
        });
        
      } catch (e) {
        console.error("Error fetching data:", e);
        setLoading(false);
        setRefreshing(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Listen to driver's active trips for location updates
  const setupTripListenerForDriver = useCallback((driverId) => {
    try {
      // Clean up existing trip listener for this driver
      if (tripListeners.current[driverId]) {
        tripListeners.current[driverId]();
      }
      
      // Set up listener for active trips
      const tripsRef = collection(db, 'trips');
      const activeTripQuery = query(
        tripsRef,
        where('userId', '==', driverId),
        where('status', 'in', ['active', 'started', 'ongoing'])
      );
      
      const unsubscribe = onSnapshot(activeTripQuery, (snapshot) => {
        if (!snapshot.empty && isMounted.current) {
          // Driver has active trip, check for location updates
          snapshot.forEach(async (tripDoc) => {
            const tripData = tripDoc.data();
            // Check if trip has location data
            if (tripData.currentLocation || tripData.routeCoordinates) {
              // Get the latest location from trip
              let latestLocation = null;
              
              if (tripData.currentLocation) {
                latestLocation = tripData.currentLocation;
              } else if (tripData.routeCoordinates && tripData.routeCoordinates.length > 0) {
                // Use the last coordinate from route
                latestLocation = tripData.routeCoordinates[tripData.routeCoordinates.length - 1];
              }
              
              if (latestLocation) {
                // Get driver data for geofence check
                const driverRef = doc(db, "users", driverId);
                const driverSnap = await getDoc(driverRef);
                if (driverSnap.exists()) {
                  const driverData = driverSnap.data();
                  await checkGeofenceForLocation(driverId, driverData, latestLocation);
                }
              }
            }
          });
        }
      });
      
      tripListeners.current[driverId] = unsubscribe;
      
    } catch (error) {
      console.error(`Error setting up trip listener for ${driverId}:`, error);
    }
  }, []);

  // Check geofence for specific location - WITH 1-MINUTE COOLDOWN
  const checkGeofenceForLocation = useCallback(async (driverId, driverData, location) => {
    try {
      // Check if geofence alerts are enabled in user preferences
      if (!areGeofenceAlertsEnabled()) {
        console.log('Geofence alerts are disabled in user preferences');
        return;
      }
      
      // Check if driver has geofence
      if (!driverData.geofence || !driverData.geofence.coordinates) {
        console.log(`Driver ${driverId} has no geofence`);
        setActiveViolations(prev => ({
          ...prev,
          [driverId]: false
        }));
        return;
      }
      
      // Validate location
      if (!location || !location.latitude || !location.longitude) {
        console.log(`Driver ${driverId} has invalid location data`);
        return;
      }
      
      const wasInside = driverData.wasInsideGeofence !== false;
      const isInside = isPointInPolygon(location, driverData.geofence.coordinates);
      
      console.log(`Driver ${driverId}: Inside=${isInside}, WasInside=${wasInside}, Location=${JSON.stringify(location)}`);
      
      // Check for geofence exit
      if (!isInside && wasInside) {
        console.log(`🚨 Driver ${driverId} EXITED geofence!`);
        
        // Check if we can send an alert (60-second cooldown)
        if (canSendAlert(driverId, 'exit')) {
          console.log(`Sending exit alert for driver ${driverId} (cooldown passed)`);
          await handleGeofenceViolation(driverId, driverData, location, 'exit');
          
          // Update last alert time
          updateLastAlertTime(driverId, 'exit');
        } else {
          console.log(`Skipping exit alert for driver ${driverId} - cooldown active (only send once per minute)`);
          
          // Still log the violation but don't send notification
          await logViolationWithoutAlert(driverId, driverData, location, 'exit');
        }
        
        // Update driver's state in Firestore
        const driverRef = doc(db, "users", driverId);
        await updateDoc(driverRef, {
          wasInsideGeofence: false,
          lastGeofenceStatus: 'outside',
          lastGeofenceCheck: serverTimestamp(),
          hasActiveViolation: true
        });
        
        // Update local state
        setActiveViolations(prev => ({
          ...prev,
          [driverId]: true
        }));
        
        // Update linked drivers state
        setLinkedDrivers(prev => 
          prev.map(d => 
            d.driverId === driverId 
              ? { ...d, wasInsideGeofence: false, hasActiveViolation: true }
              : d
          )
        );
      }
      
      // Check for geofence return
      if (isInside && !wasInside) {
        console.log(`✅ Driver ${driverId} RETURNED to geofence!`);
        
        // Always allow return alerts (no cooldown needed for returns)
        await handleGeofenceReturn(driverId, driverData, location);
        
        // Update driver's state in Firestore
        const driverRef = doc(db, "users", driverId);
        await updateDoc(driverRef, {
          wasInsideGeofence: true,
          lastGeofenceStatus: 'inside',
          lastGeofenceCheck: serverTimestamp(),
          hasActiveViolation: false
        });
        
        // Update local state
        setActiveViolations(prev => ({
          ...prev,
          [driverId]: false
        }));
        
        // Update linked drivers state
        setLinkedDrivers(prev => 
          prev.map(d => 
            d.driverId === driverId 
              ? { ...d, wasInsideGeofence: true, hasActiveViolation: false }
              : d
          )
        );
      }
      
      // If status didn't change but should update wasInsideGeofence for consistency
      if (isInside !== wasInside) {
        const driverRef = doc(db, "users", driverId);
        await updateDoc(driverRef, {
          wasInsideGeofence: isInside,
          lastGeofenceCheck: serverTimestamp()
        });
        
        setLinkedDrivers(prev => 
          prev.map(d => 
            d.driverId === driverId 
              ? { ...d, wasInsideGeofence: isInside }
              : d
          )
        );
      }
      
      // Update last check time
      setLastLocationChecks(prev => ({
        ...prev,
        [driverId]: new Date().toISOString()
      }));
      
    } catch (error) {
      console.error(`Error checking geofence for driver ${driverId}:`, error);
    }
  }, [isPointInPolygon, canSendAlert, updateLastAlertTime, areGeofenceAlertsEnabled]);

  // Log violation without sending alert (for cooldown periods)
  const logViolationWithoutAlert = useCallback(async (driverId, driverData, location, type) => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) return;
      
      const driverName = getDriverName(driverData);
      const familyName = getUserName();
      const currentTime = new Date();
      
      // Create violation data (without notification)
      const violationData = {
        id: `${driverId}_${currentTime.getTime()}_silent`,
        driverId: driverId,
        driverName: driverName,
        type: type,
        location: location,
        fenceCoordinates: driverData.geofence.coordinates,
        message: `${driverName} exited the geofence area (silent alert)`,
        severity: 'LOW',
        timestamp: currentTime.toISOString(),
        read: false,
        acknowledged: false,
        resolved: false,
        familyId: currentUser.uid,
        familyName: familyName,
        createdAt: currentTime.toISOString(),
        silent: true, // Mark as silent alert
        alertCount: alertCountRef.current[driverId] || 1
      };
      
      // Use batch write
      const batch = writeBatch(db);
      
      // Add to driver's geofenceViolations
      const driverRef = doc(db, "users", driverId);
      batch.update(driverRef, {
        geofenceViolations: arrayUnion(violationData),
        updatedAt: serverTimestamp()
      });
      
      // Add to geofence_alerts subcollection (silent)
      const alertId = `${driverId}_silent_${currentTime.getTime()}`;
      const geofenceAlertRef = doc(collection(db, "users", driverId, "geofence_alerts"), alertId);
      batch.set(geofenceAlertRef, {
        ...violationData,
        driverUid: driverId,
        familyUid: currentUser.uid,
        source: 'geofence_violation_silent',
        alertTimestamp: serverTimestamp()
      });
      
      await batch.commit();
      
      console.log(`✅ Silent violation logged for ${driverName} (alert #${alertCountRef.current[driverId] || 1})`);
      
    } catch (error) {
      console.error('Error logging silent violation:', error);
    }
  }, [getDriverName, getUserName]);

  // Load linked drivers with trip monitoring
  const loadLinkedDrivers = useCallback(async (rawLinkedDrivers) => {
    try {
      console.log(`Loading ${rawLinkedDrivers.length} linked drivers`);
      
      // Clean up previous listeners
      cleanupAllListeners();
      
      const enrichedDrivers = [];
      const newDriverListeners = {};
      
      for (const driver of rawLinkedDrivers) {
        try {
          const driverId = driver.driverId;
          const driverRef = doc(db, "users", driverId);
          
          // Get initial driver data
          const driverSnap = await getDoc(driverRef);
          
          if (driverSnap.exists()) {
            const driverData = driverSnap.data();
            
            // Get current location from multiple sources
            const locationInfo = await getDriverCurrentLocation(driverId);
            
            // Set up real-time listener for driver
            const unsubscribeDriver = onSnapshot(driverRef, async (updatedSnap) => {
              if (updatedSnap.exists() && isMounted.current) {
                const updatedData = updatedSnap.data();
                
                // Get latest location
                const latestLocation = await getDriverCurrentLocation(driverId);
                if (latestLocation) {
                  await checkGeofenceForLocation(driverId, updatedData, latestLocation.location);
                }
              }
            });
            
            newDriverListeners[driverId] = unsubscribeDriver;
            
            // Set up trip listener for this driver
            setupTripListenerForDriver(driverId);
            
            // Check initial geofence status
            if (locationInfo) {
              await checkGeofenceForLocation(driverId, driverData, locationInfo.location);
            }
            
            // Check if driver has active trip
            const isOnline = await checkDriverOnlineStatus(driverId);
            
            enrichedDrivers.push({
              ...driver,
              ...driverData,
              driverId: driverId,
              geofence: driverData.geofence || null,
              currentLocation: locationInfo?.location || null,
              hasActiveViolation: driverData.hasActiveViolation || false,
              lastLocationUpdate: driverData.lastLocationUpdate || null,
              wasInsideGeofence: driverData.wasInsideGeofence !== false,
              isOnline: isOnline,
              locationSource: locationInfo?.source || 'unknown'
            });
          }
        } catch (err) {
          console.error("Error setting up driver listener:", driver.driverId, err);
        }
      }
      
      driverListeners.current = newDriverListeners;
      setLinkedDrivers(enrichedDrivers);
      
      // Set up periodic check (every 2 minutes)
      if (locationCheckInterval.current) {
        clearInterval(locationCheckInterval.current);
      }
      
      locationCheckInterval.current = setInterval(async () => {
        if (isMounted.current) {
          await periodicLocationCheck(enrichedDrivers);
        }
      }, 120000); // 2 minutes
      
      // Load violations history
      await loadViolationsHistory(enrichedDrivers);
      
    } catch (error) {
      console.error("Error loading drivers:", error);
    }
  }, [cleanupAllListeners, getDriverCurrentLocation, setupTripListenerForDriver, checkGeofenceForLocation]);

  // Handle geofence violation - WITH PREFERENCE CHECK
  const handleGeofenceViolation = useCallback(async (driverId, driverData, location, type) => {
    try {
      // Double-check if alerts are enabled before proceeding
      if (!areGeofenceAlertsEnabled()) {
        console.log('Geofence alerts are disabled - skipping violation notification');
        return;
      }

      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        console.error('No authenticated user found');
        return;
      }
      
      const driverName = getDriverName(driverData);
      const familyName = getUserName();
      const currentTime = new Date();
      const alertNumber = alertCountRef.current[driverId] || 1;
      
      // Create violation ID
      const violationId = `${driverId}_${currentTime.getTime()}`;
      
      // Create violation data
      const violationData = {
        id: violationId,
        driverId: driverId,
        driverName: driverName,
        type: type,
        location: location,
        fenceCoordinates: driverData.geofence.coordinates,
        message: `${driverName} exited the geofence area (Alert #${alertNumber})`,
        severity: 'MEDIUM',
        timestamp: currentTime.toISOString(),
        read: false,
        acknowledged: false,
        resolved: false,
        familyId: currentUser.uid,
        familyName: familyName,
        createdAt: currentTime.toISOString(),
        alertNumber: alertNumber
      };
      
      // Use batch write for atomic operations
      const batch = writeBatch(db);
      
      // 1. Add violation to driver's geofenceViolations array
      const driverRef = doc(db, "users", driverId);
      batch.update(driverRef, {
        geofenceViolations: arrayUnion(violationData),
        hasActiveViolation: true,
        lastViolationTime: serverTimestamp(),
        violationCount: (driverData.violationCount || 0) + 1,
        updatedAt: serverTimestamp()
      });
      
      // 2. Create alert for family (in alerts collection)
      const alertId = `${currentUser.uid}_${driverId}_${currentTime.getTime()}`;
      const alertRef = doc(collection(db, "alerts"), alertId);
      const alertData = {
        id: alertId,
        driverId: driverId,
        driverName: driverName,
        type: 'geofence',
        message: `${driverName} exited the geofence area (Alert #${alertNumber})`,
        severity: 'MEDIUM',
        location: location,
        fenceCoordinates: driverData.geofence.coordinates,
        timestamp: serverTimestamp(),
        read: false,
        acknowledged: false,
        familyId: currentUser.uid,
        familyName: familyName,
        driverProfileImage: driverData.profileImage || null,
        createdAt: serverTimestamp(),
        alertNumber: alertNumber
      };
      
      batch.set(alertRef, alertData);
      
      // 3. Also store in geofence_alerts subcollection
      const geofenceAlertRef = doc(collection(db, "users", driverId, "geofence_alerts"), alertId);
      const geofenceAlertData = {
        ...violationData,
        driverUid: driverId,
        familyUid: currentUser.uid,
        source: 'geofence_violation',
        alertTimestamp: serverTimestamp()
      };
      
      batch.set(geofenceAlertRef, geofenceAlertData);
      
      // 4. Store in user's alerts subcollection
      const userAlertRef = doc(collection(db, "users", currentUser.uid, "alerts"), alertId);
      const userAlertData = {
        ...violationData,
        driverUid: driverId,
        alertType: 'geofence_violation',
        source: 'driver_geofence',
        alertTimestamp: serverTimestamp()
      };
      
      batch.set(userAlertRef, userAlertData);
      
      // Commit batch
      await batch.commit();
      
      console.log(`✅ Violation logged for ${driverName} in database (Alert #${alertNumber})`);
      
      // Send notifications ONLY if alerts are enabled
      if (areGeofenceAlertsEnabled()) {
        await sendGeofenceAlert(driverId, driverName, { ...alertData, id: alertId }, alertNumber);
      }
      
      // Update local alerts
      setGeofenceAlerts(prev => [{ ...alertData, timestamp: currentTime }, ...prev.slice(0, 49)]);
      
      // Update local violations
      setViolations(prev => ({
        ...prev,
        [driverId]: [...(prev[driverId] || []), violationData]
      }));
      
    } catch (error) {
      console.error('Error handling geofence violation:', error);
      Alert.alert('Error', 'Failed to log geofence violation');
    }
  }, [getDriverName, getUserName, areGeofenceAlertsEnabled]);

  // Send geofence alert - WITH PREFERENCE CHECK
  const sendGeofenceAlert = useCallback(async (driverId, driverName, alertData, alertNumber = 1) => {
    // Check if alerts are enabled
    if (!areGeofenceAlertsEnabled()) {
      console.log('Geofence alerts are disabled - skipping notification');
      return;
    }

    const title = `🚨 Geofence Alert #${alertNumber} - ${driverName}`;
    const body = `${driverName} has exited the geofence area (Alert #${alertNumber})`;
    
    // Send local notification
    await sendLocalNotification(title, body, {
      driverId: driverId,
      driverName: driverName,
      alertType: 'geofence',
      screen: 'GeofenceManagementScreen',
      alertId: alertData.id,
      alertNumber: alertNumber
    });
    
    // Send push notification
    if (notificationToken) {
      await sendPushNotification(title, body, {
        driverId: driverId,
        driverName: driverName,
        alertType: 'geofence',
        screen: 'GeofenceManagementScreen',
        alertId: alertData.id,
        alertNumber: alertNumber
      });
    }
    
    // Show in-app alert (only for first alert or every hour)
    // To avoid spam, we'll only show Alert dialog for first alert and then every 5th alert
    if (alertNumber === 1 || alertNumber % 5 === 0) {
      Alert.alert(
        title,
        body,
        [
          { 
            text: "View Details", 
            onPress: () => {
              setShowAlertsModal(true);
            }
          },
          { text: "Dismiss", style: "cancel" }
        ]
      );
    }
  }, [sendLocalNotification, sendPushNotification, notificationToken, areGeofenceAlertsEnabled]);

  // Handle geofence return
  const handleGeofenceReturn = useCallback(async (driverId, driverData, location) => {
    try {
      const driverName = getDriverName(driverData);
      const currentTime = new Date();
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        console.error('No authenticated user found');
        return;
      }
      
      console.log(`Driver ${driverName} returned to geofence`);
      
      // Find latest exit violation
      const driverRef = doc(db, "users", driverId);
      const driverSnap = await getDoc(driverRef);
      if (!driverSnap.exists()) return;
      
      const driverFullData = driverSnap.data();
      const latestExit = (driverFullData.geofenceViolations || [])
        .filter(v => v.type === 'exit' && !v.resolved)
        .sort((a, b) => {
          const timeA = new Date(a.timestamp || a.createdAt);
          const timeB = new Date(b.timestamp || b.createdAt);
          return timeB - timeA;
        })[0];
      
      if (latestExit) {
        const exitTime = new Date(latestExit.timestamp || latestExit.createdAt);
        const durationMinutes = Math.floor((currentTime - exitTime) / (1000 * 60));
        
        // Create return violation
        const returnViolationId = `${driverId}_return_${currentTime.getTime()}`;
        const returnViolation = {
          id: returnViolationId,
          driverId: driverId,
          driverName: driverName,
          type: 'return',
          location: location,
          fenceCoordinates: driverData.geofence.coordinates,
          message: `${driverName} returned to geofence area after ${durationMinutes} minutes`,
          severity: 'LOW',
          timestamp: currentTime.toISOString(),
          read: false,
          acknowledged: false,
          resolved: true,
          exitDuration: durationMinutes,
          relatedExitId: latestExit.id,
          familyId: currentUser.uid,
          familyName: getUserName(),
          createdAt: currentTime.toISOString()
        };
        
        // Use batch write
        const batch = writeBatch(db);
        
        // 1. Add return violation to driver's document
        batch.update(driverRef, {
          geofenceViolations: arrayUnion(returnViolation),
          hasActiveViolation: false,
          updatedAt: serverTimestamp()
        });
        
        // 2. Mark exit violation as resolved
        const updatedViolations = (driverFullData.geofenceViolations || []).map(v => 
          v.id === latestExit.id ? { ...v, resolved: true } : v
        );
        batch.update(driverRef, {
          geofenceViolations: updatedViolations
        });
        
        // 3. Create return alert in alerts collection
        const returnAlertId = `${driverId}_return_${currentTime.getTime()}`;
        const alertRef = doc(collection(db, "alerts"), returnAlertId);
        const returnAlertData = {
          id: returnAlertId,
          driverId: driverId,
          driverName: driverName,
          type: 'geofence_return',
          message: `${driverName} returned to geofence area after ${durationMinutes} minutes`,
          severity: 'LOW',
          location: location,
          fenceCoordinates: driverData.geofence.coordinates,
          timestamp: serverTimestamp(),
          read: false,
          familyId: currentUser.uid,
          familyName: getUserName(),
          exitDuration: durationMinutes,
          relatedExitId: latestExit.id,
          createdAt: serverTimestamp()
        };
        
        batch.set(alertRef, returnAlertData);
        
        // 4. Store in geofence_alerts subcollection
        const geofenceAlertRef = doc(collection(db, "users", driverId, "geofence_alerts"), returnAlertId);
        const geofenceAlertData = {
          ...returnViolation,
          driverUid: driverId,
          familyUid: currentUser.uid,
          source: 'geofence_return',
          alertTimestamp: serverTimestamp()
        };
        
        batch.set(geofenceAlertRef, geofenceAlertData);
        
        // 5. Store in user's alerts subcollection
        const userAlertRef = doc(collection(db, "users", currentUser.uid, "alerts"), returnAlertId);
        const userAlertData = {
          ...returnViolation,
          driverUid: driverId,
          alertType: 'geofence_return',
          source: 'driver_geofence',
          alertTimestamp: serverTimestamp()
        };
        
        batch.set(userAlertRef, userAlertData);
        
        await batch.commit();
        
        console.log(`✅ Return logged for ${driverName} in database`);
        
        // Update local alerts
        setGeofenceAlerts(prev => [{ ...returnAlertData, timestamp: currentTime }, ...prev.slice(0, 49)]);
        
        // Update local violations
        setViolations(prev => ({
          ...prev,
          [driverId]: [...(prev[driverId] || []), returnViolation]
        }));
        
        // Send return notification (always allowed, no cooldown needed)
        if (areGeofenceAlertsEnabled()) {
          await sendLocalNotification(
            "✅ Geofence Return",
            `${driverName} returned to safe zone after ${durationMinutes} minutes`,
            {
              driverId: driverId,
              driverName: driverName,
              alertType: 'geofence_return',
              alertId: returnAlertId,
              duration: durationMinutes
            }
          );
        }
      }
    } catch (error) {
      console.error('Error handling geofence return:', error);
    }
  }, [getDriverName, getUserName, areGeofenceAlertsEnabled]);

  // Periodic location check
  const periodicLocationCheck = useCallback(async (drivers) => {
    console.log(`Periodic check for ${drivers.length} drivers`);
    
    for (const driver of drivers) {
      try {
        if (!driver.geofence || !driver.geofence.coordinates) {
          continue;
        }
        
        // Get latest location
        const locationInfo = await getDriverCurrentLocation(driver.driverId);
        if (locationInfo) {
          // Get updated driver data
          const driverRef = doc(db, "users", driver.driverId);
          const driverSnap = await getDoc(driverRef);
          if (driverSnap.exists()) {
            const driverData = driverSnap.data();
            await checkGeofenceForLocation(driver.driverId, driverData, locationInfo.location);
          }
        }
      } catch (error) {
        console.error(`Error checking driver ${driver.driverId}:`, error);
      }
    }
  }, [getDriverCurrentLocation, checkGeofenceForLocation]);

  // Check if driver is online (has active trip)
  const checkDriverOnlineStatus = useCallback(async (driverId) => {
    try {
      const tripsRef = collection(db, 'trips');
      const activeTripQuery = query(
        tripsRef,
        where('userId', '==', driverId),
        where('status', 'in', ['active', 'started', 'ongoing'])
      );
      
      const querySnapshot = await getDocs(activeTripQuery);
      return !querySnapshot.empty;
    } catch (error) {
      console.error('Error checking driver online status:', error);
      return false;
    }
  }, []);

  // Load violations history
  const loadViolationsHistory = useCallback(async (drivers) => {
    const violationsMap = {};
    const auth = getAuth();
    const user = auth.currentUser;
    
    for (const driver of drivers) {
      if (driver.driverId) {
        try {
          // Load from driver's document
          const driverRef = doc(db, "users", driver.driverId);
          const driverSnap = await getDoc(driverRef);
          if (driverSnap.exists()) {
            const driverData = driverSnap.data();
            violationsMap[driver.driverId] = driverData.geofenceViolations || [];
            
            // Check for active violations
            if (driverData.hasActiveViolation) {
              setActiveViolations(prev => ({
                ...prev,
                [driver.driverId]: true
              }));
            }
          }
        } catch (error) {
          console.error("Error loading violations:", error);
          violationsMap[driver.driverId] = [];
        }
      }
    }
    setViolations(violationsMap);
  }, []);

  // Load geofence alerts
  const loadGeofenceAlerts = useCallback(async () => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return;

      const alerts = [];
      
      // 1. Load from main alerts collection
      const alertsRef = collection(db, "alerts");
      const mainQuery = query(
        alertsRef,
        where("familyId", "==", user.uid),
        where("type", "in", ["geofence", "geofence_return"]),
        orderBy("timestamp", "desc")
      );
      
      const mainSnapshot = await getDocs(mainQuery);
      mainSnapshot.forEach((doc) => {
        alerts.push({
          id: doc.id,
          source: 'main',
          ...doc.data()
        });
      });
      
      // Sort by timestamp (newest first)
      const sortedAlerts = alerts.sort((a, b) => {
        const timeA = a.timestamp?.toDate?.() || new Date(0);
        const timeB = b.timestamp?.toDate?.() || new Date(0);
        return timeB - timeA;
      });
      
      // Limit to 50 items
      const limitedAlerts = sortedAlerts.slice(0, 50);
      
      setGeofenceAlerts(limitedAlerts);
    } catch (error) {
      console.error("Error loading geofence alerts:", error);
    }
  }, []);

  // Mark alert as read
  const markAlertAsRead = useCallback(async (alertId) => {
    try {
      const alertRef = doc(db, "alerts", alertId);
      await updateDoc(alertRef, {
        read: true,
        updatedAt: serverTimestamp()
      });
      
      console.log(`✅ Alert ${alertId} marked as read`);
      
      // Update local state
      setGeofenceAlerts(prev => 
        prev.map(alert => 
          alert.id === alertId ? { ...alert, read: true } : alert
        )
      );
    } catch (error) {
      console.error('Error marking alert as read:', error);
    }
  }, []);

  // Generate map HTML
  const getMapHTML = useCallback(() => {
    if (!selectedDriver) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              margin: 0; 
              padding: 0;
              font-family: Arial, sans-serif;
              background-color: #f5f5f5;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
            }
            .no-data {
              text-align: center;
              color: #666;
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <div class="no-data">
            <h3>📍 No Driver Selected</h3>
            <p>Select a driver to set geofence</p>
          </div>
        </body>
        </html>
      `;
    }

    const centerLat = selectedDriver.currentLocation?.latitude || region.latitude;
    const centerLng = selectedDriver.currentLocation?.longitude || region.longitude;

    // Build fence coordinates for polygon
    const fencePoints = fenceCoordinates.map(p => `[${p.latitude}, ${p.longitude}]`).join(',');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { width: 100vw; height: 100vh; background: #f0f0f0; }
          .driver-marker {
            background: #d63384;
            border: 3px solid white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
          }
          .driver-marker::after {
            content: '🚗';
            position: absolute;
            top: -20px;
            left: 2px;
            font-size: 16px;
          }
          .fence-marker {
            background: #28a745;
            border: 2px solid white;
            border-radius: 50%;
            width: 12px;
            height: 12px;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          try {
            // Initialize map
            var map = L.map('map').setView([${centerLat}, ${centerLng}], 15);
            
            // Add tile layer based on map type
            ${mapType === 'standard' 
              ? `L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                  attribution: '© OpenStreetMap contributors',
                  maxZoom: 19
                }).addTo(map);`
              : `L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                  attribution: '© Esri',
                  maxZoom: 19
                }).addTo(map);`
            }

            // Add driver location marker
            ${selectedDriver.currentLocation ? `
              var driverIcon = L.divIcon({
                className: 'driver-marker',
                iconSize: [20, 20]
              });

              var driverMarker = L.marker([${selectedDriver.currentLocation.latitude}, ${selectedDriver.currentLocation.longitude}], {
                icon: driverIcon,
                zIndexOffset: 1000
              }).addTo(map);
              
              driverMarker.bindPopup('<b>${getDriverName(selectedDriver)}</b><br>Current Location').openPopup();
            ` : ''}

            // Add fence polygon
            ${fenceCoordinates.length >= 3 ? `
              var fencePoints = [${fencePoints}];
              
              // Close the polygon if not already closed
              if (fencePoints.length > 0) {
                var firstPoint = fencePoints[0];
                var lastPoint = fencePoints[fencePoints.length - 1];
                if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
                  fencePoints.push(firstPoint);
                }
              }
              
              var polygon = L.polygon(fencePoints, {
                color: '#d63384',
                weight: 3,
                opacity: 0.8,
                fillColor: 'rgba(214,51,132,0.2)',
                fillOpacity: 0.4
              }).addTo(map);
              
              polygon.bindPopup('<b>Geofence Area</b><br>${fenceCoordinates.length} points');
              
              // Fit bounds to show polygon
              if (fencePoints.length > 2) {
                map.fitBounds(polygon.getBounds(), { padding: [50, 50] });
              }
            ` : ''}

            // Add individual points as markers
            ${fenceCoordinates.map((coord, index) => `
              var pointIcon = L.divIcon({
                className: 'fence-marker',
                iconSize: [12, 12]
              });

              var marker = L.marker([${coord.latitude}, ${coord.longitude}], {
                icon: pointIcon,
                zIndexOffset: 500
              }).addTo(map);
              
              marker.bindPopup('<b>Point ${index + 1}</b><br>${coord.latitude.toFixed(6)}, ${coord.longitude.toFixed(6)}');
            `).join('')}

            // Handle map clicks for adding points
            map.on('click', function(e) {
              if (!${editingFence}) {
                var lat = e.latlng.lat;
                var lng = e.latlng.lng;
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'MAP_CLICK',
                  latitude: lat,
                  longitude: lng
                }));
              }
            });

            // Send ready message
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MAP_READY',
              center: [${centerLat}, ${centerLng}]
            }));

          } catch (error) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MAP_ERROR',
              error: error.toString()
            }));
          }
        </script>
      </body>
      </html>
    `;
  }, [selectedDriver, region, fenceCoordinates, mapType, getDriverName, editingFence]);

  // Handle WebView messages
  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'MAP_READY') {
        setMapReady(true);
      } else if (data.type === 'MAP_ERROR') {
        console.error('Map error:', data.error);
        Alert.alert('Map Error', 'Failed to load map. Please try again.');
      } else if (data.type === 'MAP_CLICK' && !editingFence) {
        // Add point to fence
        const newPoint = {
          latitude: data.latitude,
          longitude: data.longitude
        };
        
        setFenceCoordinates(prev => [...prev, newPoint]);
        
        // Update region to include new point
        if (fenceCoordinates.length > 0) {
          const allLats = [...fenceCoordinates.map(p => p.latitude), data.latitude];
          const allLngs = [...fenceCoordinates.map(p => p.longitude), data.longitude];
          const minLat = Math.min(...allLats);
          const maxLat = Math.max(...allLats);
          const minLng = Math.min(...allLngs);
          const maxLng = Math.max(...allLngs);
          
          setRegion({
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
            latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.01),
            longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.01),
          });
        }
      }
    } catch (error) {
      console.error('Error parsing WebView message:', error);
    }
  };

  const getViolationCount = useCallback((driverId) => {
    return violations[driverId]?.filter(v => v.type === 'exit' && !v.read).length || 0;
  }, [violations]);

  const handleSetGeofence = useCallback((driver) => {
    setSelectedDriver(driver);
    setEditingFence(false);
    setMapReady(false);
    
    if (driver.geofence && driver.geofence.coordinates) {
      setFenceCoordinates(driver.geofence.coordinates);
      setEditingFence(true);
      
      // Calculate region from fence coordinates
      const lats = driver.geofence.coordinates.map(coord => coord.latitude);
      const lons = driver.geofence.coordinates.map(coord => coord.longitude);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      
      setRegion({
        latitude: (minLat + maxLat) / 2,
        longitude: (minLon + maxLon) / 2,
        latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.01),
        longitudeDelta: Math.max((maxLon - minLon) * 1.5, 0.01),
      });
    } else {
      setFenceCoordinates([]);
      if (driver.currentLocation) {
        setRegion({
          latitude: driver.currentLocation.latitude,
          longitude: driver.currentLocation.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        });
      }
    }
    
    setShowMap(true);
  }, []);

  const clearGeofence = useCallback((driverId, driverName) => {
    Alert.alert(
      "Clear Geofence",
      `Are you sure you want to remove the geofence for ${driverName}?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Clear", 
          style: "destructive",
          onPress: async () => {
            try {
              const driverRef = doc(db, "users", driverId);
              await updateDoc(driverRef, {
                geofence: null,
                hasActiveViolation: false,
                wasInsideGeofence: true,
                geofenceViolations: [], // Clear all violations
                updatedAt: serverTimestamp()
              });
              
              // Clear alert tracking for this driver
              lastAlertTimeRef.current[driverId] = 0;
              lastExitAlertTimeRef.current[driverId] = 0;
              alertCountRef.current[driverId] = 0;
              
              setLinkedDrivers(prev => 
                prev.map(driver => 
                  driver.driverId === driverId 
                    ? { ...driver, geofence: null, hasActiveViolation: false }
                    : driver
                )
              );
              
              setActiveViolations(prev => ({
                ...prev,
                [driverId]: false
              }));
              
              Alert.alert("✅ Success", "Geofence cleared successfully");
            } catch (error) {
              console.error("Error clearing geofence:", error);
              Alert.alert("❌ Error", "Failed to clear geofence");
            }
          }
        }
      ]
    );
  }, []);

  const handleSaveGeofence = useCallback(async () => {
    if (!selectedDriver || fenceCoordinates.length < 3) {
      Alert.alert("Error", "Please set at least 3 points to create a geofence polygon");
      return;
    }

    try {
      const driverRef = doc(db, "users", selectedDriver.driverId);
      const driverName = getDriverName(selectedDriver);
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        Alert.alert("Error", "User not authenticated");
        return;
      }
      
      // Ensure polygon is closed (first and last points are the same)
      let closedCoordinates = [...fenceCoordinates];
      const firstPoint = fenceCoordinates[0];
      const lastPoint = fenceCoordinates[fenceCoordinates.length - 1];
      
      if (firstPoint.latitude !== lastPoint.latitude || 
          firstPoint.longitude !== lastPoint.longitude) {
        // Add first point at the end to close the polygon
        closedCoordinates.push({...firstPoint});
      }
      
      const geofenceData = {
        type: 'polygon',
        coordinates: closedCoordinates,
        createdAt: serverTimestamp(),
        setBy: currentUser.uid,
        setByName: getUserName(),
        pointCount: closedCoordinates.length,
        area: calculatePolygonArea(closedCoordinates),
        updatedAt: serverTimestamp()
      };

      await updateDoc(driverRef, {
        geofence: geofenceData,
        hasActiveViolation: false,
        wasInsideGeofence: true,
        lastGeofenceCheck: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Reset alert tracking for this driver
      lastAlertTimeRef.current[selectedDriver.driverId] = 0;
      lastExitAlertTimeRef.current[selectedDriver.driverId] = 0;
      alertCountRef.current[selectedDriver.driverId] = 0;

      // Also store geofence creation as an alert (if alerts enabled)
      if (areGeofenceAlertsEnabled()) {
        const alertId = `${currentUser.uid}_${selectedDriver.driverId}_geofence_created_${Date.now()}`;
        const alertRef = doc(collection(db, "alerts"), alertId);
        const alertData = {
          id: alertId,
          driverId: selectedDriver.driverId,
          driverName: driverName,
          type: 'geofence_created',
          message: `Geofence with ${closedCoordinates.length} points created for ${driverName}`,
          severity: 'INFO',
          location: selectedDriver.currentLocation || { latitude: 0, longitude: 0 },
          fenceCoordinates: closedCoordinates,
          timestamp: serverTimestamp(),
          read: false,
          familyId: currentUser.uid,
          familyName: getUserName(),
          createdAt: serverTimestamp()
        };
        
        await setDoc(alertRef, alertData);
      }
      
      // Update local state
      setLinkedDrivers(prev => 
        prev.map(driver => 
          driver.driverId === selectedDriver.driverId 
            ? { ...driver, geofence: geofenceData, hasActiveViolation: false }
            : driver
        )
      );

      setActiveViolations(prev => ({
        ...prev,
        [selectedDriver.driverId]: false
      }));

      Alert.alert(
        "✅ Geofence Created", 
        `Geofence with ${closedCoordinates.length} points set for ${driverName}`,
        [
          { 
            text: "OK", 
            onPress: () => {
              setShowMap(false);
              setFenceCoordinates([]);
              setSelectedDriver(null);
              setEditingFence(false);
            }
          }
        ]
      );
    } catch (error) {
      console.error("Error saving geofence:", error);
      Alert.alert("Error", "Failed to save geofence");
    }
  }, [selectedDriver, fenceCoordinates, getUserName, getDriverName, areGeofenceAlertsEnabled]);

  const calculatePolygonArea = useCallback((coordinates) => {
    if (coordinates.length < 3) return 0;
    
    let area = 0;
    const n = coordinates.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += coordinates[i].latitude * coordinates[j].longitude;
      area -= coordinates[j].latitude * coordinates[i].longitude;
    }
    
    return Math.abs(area) * 111.32 * 111.32 * 0.5;
  }, []);

  const removeLastPoint = useCallback(() => {
    if (fenceCoordinates.length > 0) {
      const newCoordinates = fenceCoordinates.slice(0, -1);
      setFenceCoordinates(newCoordinates);
      
      if (newCoordinates.length > 0) {
        const lats = newCoordinates.map(coord => coord.latitude);
        const lons = newCoordinates.map(coord => coord.longitude);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        
        setRegion({
          latitude: (minLat + maxLat) / 2,
          longitude: (minLon + maxLon) / 2,
          latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.01),
          longitudeDelta: Math.max((maxLon - minLon) * 1.5, 0.01),
        });
      }
    }
  }, [fenceCoordinates]);

  const clearCurrentFence = useCallback(() => {
    setFenceCoordinates([]);
    setEditingFence(false);
    setShowInstructions(true);
  }, []);

  const toggleMapType = useCallback(() => {
    setMapType(prev => prev === 'standard' ? 'satellite' : 'standard');
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const auth = getAuth();
    const user = auth.currentUser;
    if (user) {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        await loadLinkedDrivers(userSnap.data().linkedDrivers || []);
        await loadGeofenceAlerts();
        await loadUserPreferences();
      }
    }
    setRefreshing(false);
  }, [loadLinkedDrivers, loadGeofenceAlerts, loadUserPreferences]);

  const getDriverStatus = useCallback((driver) => {
    if (!driver.currentLocation) return 'offline';
    
    const lastUpdate = lastLocationChecks[driver.driverId];
    if (!lastUpdate) return 'inactive';
    
    const lastUpdateTime = new Date(lastUpdate);
    const now = new Date();
    const minutesDiff = Math.floor((now - lastUpdateTime) / (1000 * 60));
    
    if (minutesDiff > 30) return 'offline';
    if (activeViolations[driver.driverId]) return 'violation';
    if (driver.isOnline) return 'online';
    return 'inactive';
  }, [lastLocationChecks, activeViolations]);

  const getStatusColor = useCallback((status) => {
    switch (status) {
      case 'online': return '#28a745';
      case 'inactive': return '#6c757d';
      case 'violation': return '#dc3545';
      case 'offline': return '#adb5bd';
      default: return '#6c757d';
    }
  }, []);

  const viewGeofenceAlerts = useCallback(() => {
    setShowAlertsModal(true);
  }, []);

  // Render alert item
  const renderAlertItem = useCallback(({ item }) => {
    // Check if this is a silent alert (only log but not notify)
    const isSilent = item.silent === true;
    
    return (
      <TouchableOpacity 
        style={[
          styles.alertItem, 
          !item.read && styles.unreadAlert,
          isSilent && styles.silentAlert
        ]}
        onPress={() => markAlertAsRead(item.id)}
        activeOpacity={0.8}
      >
        <Ionicons 
          name={item.type === 'geofence_return' ? "checkmark-circle" : 
                item.type === 'geofence_created' ? "location" : 
                isSilent ? "time-outline" : "warning"} 
          size={20} 
          color={item.type === 'geofence_return' ? '#28a745' : 
                 item.type === 'geofence_created' ? '#007bff' : 
                 isSilent ? '#6c757d' : '#dc3545'} 
          style={styles.alertIcon}
        />
        <View style={styles.alertContent}>
          <View style={styles.alertHeader}>
            <Text style={styles.alertTitle}>{item.driverName}</Text>
            {!item.read && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.alertMessage}>{item.message}</Text>
          {item.alertNumber && (
            <Text style={styles.alertNumber}>
              Alert #{item.alertNumber}
            </Text>
          )}
          {item.exitDuration && (
            <Text style={styles.alertDuration}>
              Duration outside: {item.exitDuration} minutes
            </Text>
          )}
          {isSilent && (
            <Text style={styles.silentAlertText}>
              (Silent - logged only, no notification)
            </Text>
          )}
          {item.severity === 'INFO' && (
            <Text style={styles.infoAlert}>
              Information
            </Text>
          )}
          <Text style={styles.alertTime}>
            {item.timestamp?.toDate?.() ? 
              item.timestamp.toDate().toLocaleString() : 
              item.createdAt?.toDate?.() ?
              item.createdAt.toDate().toLocaleString() :
              'Unknown time'
            }
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [markAlertAsRead]);

  // Filter drivers
  const filteredDrivers = linkedDrivers.filter(driver => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    return (
      getDriverName(driver).toLowerCase().includes(query) ||
      driver.email?.toLowerCase().includes(query) ||
      driver.relation?.toLowerCase().includes(query)
    );
  });

  // Map Screen
  if (showMap && selectedDriver) {
    return (
      <View style={styles.mainContainer}>
        {/* HEADER */}
        <View style={styles.headerWrapper}>
          <View style={styles.headerContent}>
            <TouchableOpacity 
              onPress={() => setShowMap(false)} 
              style={styles.backButton}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>
                {editingFence ? 'View Geofence' : 'Create Geofence'}
              </Text>
              <Text style={styles.subTitle}>{getDriverName(selectedDriver)}</Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity 
                style={styles.mapTypeButton}
                onPress={toggleMapType}
                activeOpacity={0.8}
              >
                <Ionicons 
                  name={mapType === 'standard' ? 'map' : 'map-outline'} 
                  size={20} 
                  color="#fff" 
                />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.helpButton}
                onPress={() => setShowInstructions(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="help-circle" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.curve} />
        </View>

        {/* MAP */}
        <View style={styles.mapContainer}>
          <WebView
            ref={webViewRef}
            source={{ html: getMapHTML() }}
            style={styles.map}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onMessage={handleWebViewMessage}
            onError={(syntheticEvent) => {
              const { nativeEvent } = syntheticEvent;
              console.error('WebView error: ', nativeEvent);
              Alert.alert('Map Error', 'Failed to load map. Please try again.');
            }}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.mapPlaceholder}>
                <ActivityIndicator size="large" color="#d63384" />
                <Text style={styles.mapPlaceholderText}>Loading map...</Text>
              </View>
            )}
          />

          {/* MAP CONTROLS */}
          <View style={styles.mapControls}>
            <View style={styles.pointsInfo}>
              <View style={styles.pointsCounter}>
                <Ionicons name="location" size={16} color="#d63384" />
                <Text style={styles.pointsText}>
                  Points: {fenceCoordinates.length} {fenceCoordinates.length < 3 && '(Min 3)'}
                </Text>
              </View>
              {fenceCoordinates.length > 0 && (
                <TouchableOpacity 
                  style={styles.removePointButton}
                  onPress={removeLastPoint}
                  activeOpacity={0.8}
                >
                  <Ionicons name="remove-circle" size={18} color="#dc3545" />
                  <Text style={styles.removePointText}>Remove Last</Text>
                </TouchableOpacity>
              )}
            </View>
            
            <Text style={styles.instructions}>
              {editingFence 
                ? 'Viewing existing geofence. Clear to create new one.' 
                : 'Tap on the map to add points. Create polygon with 3+ points.'
              }
            </Text>
            
            <View style={styles.controlButtons}>
              <TouchableOpacity 
                style={[styles.controlButton, styles.secondaryButton]}
                onPress={clearCurrentFence}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={16} color="#fff" />
                <Text style={styles.secondaryButtonText}>
                  {editingFence ? 'Clear Geofence' : 'Clear All'}
                </Text>
              </TouchableOpacity>
              
              {!editingFence && (
                <TouchableOpacity 
                  style={[
                    styles.controlButton, 
                    styles.primaryButton,
                    fenceCoordinates.length < 3 && styles.disabledButton
                  ]}
                  onPress={handleSaveGeofence}
                  disabled={fenceCoordinates.length < 3}
                  activeOpacity={0.8}
                >
                  <Ionicons name="save-outline" size={16} color="#fff" />
                  <Text style={styles.primaryButtonText}>
                    Save Geofence
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* INSTRUCTIONS MODAL */}
        <Modal
          visible={showInstructions}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowInstructions(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>How to Create Geofence</Text>
                <TouchableOpacity 
                  onPress={() => setShowInstructions(false)}
                  style={styles.closeButton}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              
              <View style={styles.instructionList}>
                <View style={styles.instructionItem}>
                  <View style={styles.instructionIcon}>
                    <Ionicons name="locate" size={20} color="#d63384" />
                  </View>
                  <Text style={styles.instructionText}>
                    <Text style={styles.bold}>Tap on the map</Text> to add points
                  </Text>
                </View>
                
                <View style={styles.instructionItem}>
                  <View style={styles.instructionIcon}>
                    <Ionicons name="triangle" size={20} color="#d63384" />
                  </View>
                  <Text style={styles.instructionText}>
                    <Text style={styles.bold}>Minimum 3 points</Text> required
                  </Text>
                </View>
                
                <View style={styles.instructionItem}>
                  <View style={styles.instructionIcon}>
                    <Ionicons name="save" size={20} color="#d63384" />
                  </View>
                  <Text style={styles.instructionText}>
                    <Text style={styles.bold}>Click Save</Text> to create the geofence
                  </Text>
                </View>
              </View>

              <TouchableOpacity 
                style={styles.gotItButton}
                onPress={() => setShowInstructions(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.gotItButtonText}>Got It!</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  const userName = getUserName();
  const profileImage = getProfileImage();

  return (
    <View style={styles.mainContainer}>
      {/* HEADER */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Geofence Management</Text>
          </View>

          {/* Profile Section */}
          <View style={styles.profileWrapper}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                {profileImage ? (
                  <Image source={{ uri: profileImage }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="person" size={20} color="#d63384" />
                  </View>
                )}
                <Text style={styles.headerProfileName} numberOfLines={1}>
                  {userName}
                </Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.curve} />
      </View>

      {/* CONTENT */}
      <ScrollView 
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#d63384']}
            tintColor="#d63384"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View>
            <Text style={styles.sectionTitle}>Manage Driver Geofences</Text>
            <Text style={styles.sectionSubtitle}>
              Set safe zones and get alerts for boundary violations
            </Text>
            {/* Alert Status Indicator */}
            <View style={styles.alertStatusContainer}>
              <View style={[styles.alertStatusDot, { backgroundColor: areGeofenceAlertsEnabled() ? '#28a745' : '#dc3545' }]} />
              <Text style={styles.alertStatusText}>
                Geofence Alerts: {areGeofenceAlertsEnabled() ? 'Enabled' : 'Disabled'}
              </Text>
            </View>
          </View>
          <View style={styles.headerActionsRight}>
            <TouchableOpacity 
              style={styles.alertsButton}
              onPress={viewGeofenceAlerts}
              activeOpacity={0.8}
            >
              <Ionicons name="notifications" size={20} color="#d63384" />
              {geofenceAlerts.length > 0 && (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>
                    {geofenceAlerts.length > 99 ? '99+' : geofenceAlerts.length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.statsButton}
              onPress={() => {
                const driversWithGeofence = linkedDrivers.filter(d => d.geofence).length;
                const activeViolationsCount = Object.values(activeViolations).filter(v => v).length;
                const totalViolations = Object.values(violations).flat().length;
                Alert.alert(
                  "Geofence Stats",
                  `Total Drivers: ${linkedDrivers.length}\nActive Geofences: ${driversWithGeofence}\nActive Violations: ${activeViolationsCount}\nTotal Alerts: ${geofenceAlerts.length}\nTotal Violations: ${totalViolations}`
                );
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="stats-chart" size={20} color="#d63384" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search drivers..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#999"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.8}>
              <Ionicons name="close-circle" size={20} color="#666" />
            </TouchableOpacity>
          )}
        </View>

        {/* Drivers List */}
        {loading ? (
          <ActivityIndicator size="large" color="#d63384" style={styles.loader} />
        ) : filteredDrivers.length > 0 ? (
          <View>
            {filteredDrivers.map((driver, index) => {
              const violationCount = getViolationCount(driver.driverId);
              const hasActiveViolation = activeViolations[driver.driverId] || false;
              const status = getDriverStatus(driver);
              const statusColor = getStatusColor(status);
              const hasGeofence = !!driver.geofence;

              return (
                <TouchableOpacity
                  key={driver.driverId || index}
                  style={[
                    styles.profileCard,
                    hasActiveViolation && styles.violationCard,
                    !hasGeofence && styles.noFenceCard
                  ]}
                  onPress={() => handleSetGeofence(driver)}
                  activeOpacity={0.8}
                >
                  <View style={styles.profileInfo}>
                    <View style={styles.avatarContainer}>
                      {getDriverProfileImage(driver) ? (
                        <Image
                          source={{ uri: getDriverProfileImage(driver) }}
                          style={styles.profileAvatar}
                        />
                      ) : (
                        <View style={styles.profileAvatarPlaceholder}>
                          <Ionicons name="person" size={24} color="#d63384" />
                        </View>
                      )}
                      <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
                    </View>
                    <View style={styles.profileText}>
                      <View style={styles.nameContainer}>
                        <Text style={styles.profileCardName} numberOfLines={1}>
                          {getDriverName(driver)}
                        </Text>
                        {violationCount > 0 && (
                          <TouchableOpacity 
                            style={styles.violationBadge}
                            onPress={viewGeofenceAlerts}
                          >
                            <Ionicons name="warning" size={10} color="#fff" />
                            <Text style={styles.violationBadgeText}>{violationCount}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.statusRow}>
                        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                          <Text style={[styles.statusText, { color: statusColor }]}>
                            {status === 'online' ? 'Driving' : 
                             status === 'violation' ? 'Outside Fence' :
                             status === 'offline' ? 'Offline' : 'Inactive'}
                          </Text>
                        </View>
                        {driver.isOnline && (
                          <View style={styles.onlineBadge}>
                            <Ionicons name="wifi" size={10} color="#fff" />
                          </View>
                        )}
                      </View>
                      <Text style={styles.profileEmail} numberOfLines={1}>
                        {driver.email}
                      </Text>
                      <Text style={styles.profileRelation}>
                        Relation: {driver.relation || 'Not specified'}
                      </Text>
                      <View style={styles.geofenceInfo}>
                        <View style={styles.geofenceStatusRow}>
                          <Ionicons 
                            name={hasGeofence ? "location" : "location-outline"} 
                            size={14} 
                            color={hasGeofence ? '#28a745' : '#dc3545'} 
                          />
                          <Text style={[
                            styles.geofenceStatus,
                            { color: hasGeofence ? '#28a745' : '#dc3545' }
                          ]}>
                            {hasGeofence ? 'Geofence Active' : 'No Geofence'}
                          </Text>
                        </View>
                        {hasGeofence && driver.geofence && (
                          <Text style={styles.geofenceDetails}>
                            {driver.geofence.pointCount} points • {driver.geofence.area?.toFixed(2)} km²
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                  <View style={styles.actionButtons}>
                    {hasGeofence && (
                      <TouchableOpacity 
                        style={styles.clearButton}
                        onPress={(e) => {
                          e.stopPropagation();
                          clearGeofence(driver.driverId, getDriverName(driver));
                        }}
                      >
                        <Ionicons name="trash-outline" size={20} color="#dc3545" />
                      </TouchableOpacity>
                    )}
                    {hasActiveViolation && (
                      <TouchableOpacity 
                        style={styles.activeViolationIndicator}
                        onPress={viewGeofenceAlerts}
                      >
                        <Ionicons name="warning" size={16} color="#fff" />
                      </TouchableOpacity>
                    )}
                    <Ionicons name="chevron-forward" size={24} color="#d63384" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="location-outline" size={80} color="#e9ecef" />
            </View>
            <Text style={styles.emptyText}>
              {searchQuery ? 'No drivers found' : 'No drivers linked yet'}
            </Text>
            <Text style={styles.emptySubText}>
              {searchQuery 
                ? 'Try adjusting your search terms'
                : 'Link drivers to set geofence areas'
              }
            </Text>
            {!searchQuery && (
              <TouchableOpacity 
                style={styles.linkButton}
                onPress={() => navigation.navigate('ProfileLinkageScreen')}
                activeOpacity={0.8}
              >
                <Ionicons name="link" size={20} color="#fff" style={styles.buttonIcon} />
                <Text style={styles.linkButtonText}>Go to Profile Linkage</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Alerts Modal */}
      <Modal
        visible={showAlertsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAlertsModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.alertsModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Geofence Alerts</Text>
              <TouchableOpacity 
                onPress={() => setShowAlertsModal(false)}
                style={styles.closeButton}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <FlatList
              data={geofenceAlerts}
              renderItem={renderAlertItem}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.noAlerts}>
                  <Ionicons name="checkmark-circle" size={48} color="#28a745" />
                  <Text style={styles.noAlertsText}>No recent geofence alerts</Text>
                  <Text style={styles.noAlertsSubText}>
                    All alerts are stored in Firebase database
                  </Text>
                </View>
              }
            />
            
            <TouchableOpacity 
              style={styles.closeModalButton}
              onPress={() => setShowAlertsModal(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.closeModalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
            <Ionicons name="settings" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  mainContainer: { 
    flex: 1, 
    backgroundColor: '#fff' 
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
  backButton: {
    padding: 8,
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapTypeButton: {
    padding: 8,
    marginRight: 8,
  },
  helpButton: {
    padding: 8,
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
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#fff', 
    textAlign: 'center' 
  },
  subTitle: { 
    fontSize: 14, 
    color: '#fff', 
    marginTop: 2, 
    textAlign: 'center' 
  },
  profileWrapper: { 
    flexDirection: 'row', 
    alignItems: 'center', 
  },
  headerProfileName: {
    color: '#fff',
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 100,
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
  content: { 
    flex: 1, 
    padding: 16 
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  alertStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  alertStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  alertStatusText: {
    fontSize: 12,
    color: '#666',
  },
  statsButton: {
    padding: 10,
    backgroundColor: '#f8d7da',
    borderRadius: 20,
  },
  alertsButton: {
    padding: 10,
    backgroundColor: '#f8d7da',
    borderRadius: 20,
    marginRight: 10,
    position: 'relative',
  },
  alertBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#dc3545',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  alertBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    padding: 0,
  },
  loader: { 
    marginTop: 40 
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderLeftWidth: 4,
    borderLeftColor: '#d63384',
  },
  violationCard: {
    borderLeftColor: '#dc3545',
    backgroundColor: '#fff5f5',
  },
  noFenceCard: {
    borderLeftColor: '#6c757d',
  },
  profileInfo: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    flex: 1 
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  profileAvatar: { 
    width: 56, 
    height: 56, 
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#f0f0f0',
  },
  profileAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f8d7da',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileText: { 
    flex: 1 
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  profileCardName: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#333',
    flex: 1,
  },
  violationBadge: {
    backgroundColor: '#dc3545',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  violationBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  onlineBadge: {
    backgroundColor: '#28a745',
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  profileEmail: { 
    fontSize: 14, 
    color: '#666', 
    marginBottom: 2 
  },
  profileRelation: { 
    fontSize: 12, 
    color: '#888', 
    fontStyle: 'italic', 
    marginBottom: 4 
  },
  geofenceInfo: {
    marginTop: 4,
  },
  geofenceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  geofenceStatus: { 
    fontSize: 12, 
    fontWeight: '600',
    marginLeft: 4,
  },
  geofenceDetails: { 
    fontSize: 11, 
    color: '#888' 
  },
  activeViolationIndicator: {
    backgroundColor: '#dc3545',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  actionButtons: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  clearButton: { 
    marginRight: 12, 
    padding: 4 
  },
  emptyState: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyText: { 
    fontSize: 18, 
    color: '#333', 
    marginTop: 8, 
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 14,
    color: '#6c757d',
    marginTop: 8,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d63384',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#d63384',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonIcon: {
    marginRight: 8,
  },
  linkButtonText: { 
    color: '#fff', 
    fontWeight: '600' 
  },
  mapContainer: { 
    flex: 1,
    position: 'relative',
  },
  map: { 
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  mapPlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  mapPlaceholderText: {
    marginTop: 10,
    fontSize: 14,
    color: '#666',
  },
  mapControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  pointsInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pointsCounter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pointsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 6,
  },
  removePointButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  removePointText: {
    color: '#dc3545',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  instructions: {
    textAlign: 'center',
    marginBottom: 16,
    color: '#666',
    fontSize: 14,
    lineHeight: 20,
  },
  controlButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  controlButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#d63384',
  },
  secondaryButton: {
    backgroundColor: '#6c757d',
  },
  disabledButton: {
    backgroundColor: '#ccc',
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    margin: 20,
    width: width - 40,
  },
  alertsModalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    margin: 20,
    width: width - 40,
    maxHeight: height * 0.8,
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
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  instructionList: {
    marginBottom: 20,
  },
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  instructionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f8d7da',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  instructionText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
    lineHeight: 20,
  },
  bold: {
    fontWeight: 'bold',
    color: '#333',
  },
  gotItButton: {
    backgroundColor: '#d63384',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  gotItButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  unreadAlert: {
    backgroundColor: '#f8f9fa',
  },
  silentAlert: {
    opacity: 0.7,
    backgroundColor: '#f5f5f5',
  },
  alertIcon: {
    marginRight: 12,
    marginTop: 4,
  },
  alertContent: {
    flex: 1,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#dc3545',
    marginLeft: 8,
  },
  alertMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
    lineHeight: 20,
  },
  alertNumber: {
    fontSize: 12,
    color: '#d63384',
    fontWeight: '600',
    marginBottom: 2,
  },
  alertDuration: {
    fontSize: 12,
    color: '#28a745',
    marginBottom: 2,
    fontStyle: 'italic',
  },
  silentAlertText: {
    fontSize: 11,
    color: '#6c757d',
    marginBottom: 2,
    fontStyle: 'italic',
  },
  infoAlert: {
    fontSize: 12,
    color: '#007bff',
    marginBottom: 2,
    fontStyle: 'italic',
  },
  alertTime: {
    fontSize: 12,
    color: '#888',
  },
  noAlerts: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noAlertsText: {
    fontSize: 16,
    color: '#28a745',
    marginTop: 16,
  },
  noAlertsSubText: {
    fontSize: 12,
    color: '#6c757d',
    marginTop: 8,
    textAlign: 'center',
  },
  closeModalButton: {
    backgroundColor: '#d63384',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  closeModalButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  footerWrapper: { 
    position: 'absolute', 
    bottom: 16, 
    width: '100%', 
    alignItems: 'center' 
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
});

export default GeofenceManagementScreen;