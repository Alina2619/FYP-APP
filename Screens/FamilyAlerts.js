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
  RefreshControl,
  AppState,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  writeBatch,
  limit,
  Timestamp,
  updateDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import * as Location from 'expo-location';

const { width } = Dimensions.get('window');

const FamilyAlertsTab = ({ navigation }) => {
  // State Management
  const [allAlerts, setAllAlerts] = useState([]);
  const [filteredAlerts, setFilteredAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userData, setUserData] = useState(null);
  const [linkedDrivers, setLinkedDrivers] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readAlerts, setReadAlerts] = useState(new Set());
  const [alertStats, setAlertStats] = useState({
    total: 0,
    emergency: 0,
    geofence: 0,
    driving: 0,
  });
  const [locationPermission, setLocationPermission] = useState(null);

  // Refs for cleanup and performance
  const listenersRef = useRef([]);
  const isMountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);
  const lastFetchRef = useRef(null);
  const loadTimeoutRef = useRef(null);
  const fetchInProgressRef = useRef(false);
  const initDoneRef = useRef(false);
  const readAlertsUnsubscribeRef = useRef(null);
  const mainAlertsUnsubscribeRef = useRef(null);
  const userUnsubscribeRef = useRef(null);
  const authUnsubscribeRef = useRef(null);

  // Cache for reverse geocoded addresses
  const addressCache = useRef(new Map());

  // Alert Settings State
  const [alertSettings, setAlertSettings] = useState({
    emergencyAlerts: true,
    safetyAlerts: true,
    impactAlerts: true,
    sosAlerts: true,
    speedAlerts: true,
    harshBrakingAlerts: true,
    rapidAccelAlerts: true,
    harshTurnAlerts: true,
    drivingScoreAlerts: true,
    locationAlerts: true,
    geofenceAlerts: true,
    boundaryAlerts: true,
    tripUpdates: true,
    driverOnlineAlerts: true,
    driverOfflineAlerts: false,
    geofenceEntryAlerts: true,
    geofenceExitAlerts: true,
    geofenceOvernightAlerts: true,
  });

  // Alert Type Mapping
  const ALERT_TYPE_MAPPING = {
    'emergency': 'emergencyAlerts',
    'sos': 'sosAlerts',
    'panic': 'sosAlerts',
    'help': 'sosAlerts',
    'impact': 'impactAlerts',
    'collision': 'impactAlerts',
    'accident': 'impactAlerts',
    'safety': 'safetyAlerts',
    'speed': 'speedAlerts',
    'speeding': 'speedAlerts',
    'overspeed': 'speedAlerts',
    'brake': 'harshBrakingAlerts',
    'braking': 'harshBrakingAlerts',
    'harsh_braking': 'harshBrakingAlerts',
    'acceleration': 'rapidAccelAlerts',
    'rapid_acceleration': 'rapidAccelAlerts',
    'hard_acceleration': 'rapidAccelAlerts',
    'turn': 'harshTurnAlerts',
    'harsh_turn': 'harshTurnAlerts',
    'cornering': 'harshTurnAlerts',
    'score': 'drivingScoreAlerts',
    'driving_score': 'drivingScoreAlerts',
    'geofence': 'geofenceAlerts',
    'geofence_entry': 'geofenceEntryAlerts',
    'geofence_exit': 'geofenceExitAlerts',
    'geo-fence': 'geofenceAlerts',
    'geofence_overnight': 'geofenceOvernightAlerts',
    'geofence_return': 'geofenceAlerts',
    'geofence_created': 'geofenceAlerts',
    'boundary': 'boundaryAlerts',
    'zone': 'boundaryAlerts',
    'area': 'boundaryAlerts',
    'location': 'locationAlerts',
    'trip': 'tripUpdates',
    'trip_start': 'tripUpdates',
    'trip_end': 'tripUpdates',
    'journey': 'tripUpdates',
    'driver_online': 'driverOnlineAlerts',
    'driver_offline': 'driverOfflineAlerts',
    'driver_status': 'driverOnlineAlerts',
  };

  // Severity Levels
  const SEVERITY_LEVELS = {
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
    INFO: 'INFO',
  };

  // Cache for driver info
  const driverInfoCache = useRef(new Map());

  // ==================== UTILITY FUNCTIONS ====================

  const getUserName = useCallback(() => {
    if (!userData) return 'Family Admin';
    return userData.fullName ||
           userData.name ||
           userData.displayName ||
           `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
           userData.email?.split('@')[0] ||
           'Family Admin';
  }, [userData]);

  const getProfileImage = useCallback(() => {
    if (!userData) return null;
    return userData.profileImage ||
           userData.photoURL ||
           userData.avatar ||
           userData.imageUrl ||
           null;
  }, [userData]);

  const getDriverInfo = useCallback((driverId) => {
    if (!driverId) {
      return {
        name: 'Unknown Driver',
        email: '',
        relation: 'Driver',
        profileImage: null,
      };
    }

    if (driverInfoCache.current.has(driverId)) {
      return driverInfoCache.current.get(driverId);
    }

    const driver = linkedDrivers.find(d => d.driverId === driverId);
    let info;
    
    if (driver) {
      info = {
        name: driver.name || driver.fullName || driver.displayName || 'Unknown Driver',
        email: driver.email || '',
        relation: driver.relation || 'Linked Driver',
        profileImage: driver.profileImage || driver.profileImg || driver.photoURL || null,
      };
    } else {
      info = {
        name: 'Unknown Driver',
        email: '',
        relation: 'Driver',
        profileImage: null,
      };
    }

    driverInfoCache.current.set(driverId, info);
    return info;
  }, [linkedDrivers]);

  // ==================== LOCATION PERMISSIONS ====================

  const checkLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      setLocationPermission(status === 'granted');
      return status === 'granted';
    } catch (error) {
      console.log('Location permission check error:', error);
      setLocationPermission(false);
      return false;
    }
  }, []);

  const requestLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status === 'granted');
      return status === 'granted';
    } catch (error) {
      console.log('Location permission request error:', error);
      setLocationPermission(false);
      return false;
    }
  }, []);

  // ==================== REVERSE GEOCODING ====================
  
  const getAddressFromCoordinates = useCallback(async (latitude, longitude) => {
    if (!latitude || !longitude) return null;
    
    const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    
    if (addressCache.current.has(cacheKey)) {
      return addressCache.current.get(cacheKey);
    }
    
    const hasPermission = await checkLocationPermission();
    if (!hasPermission) {
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }
    
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude,
        longitude
      });
      
      if (results && results.length > 0) {
        const result = results[0];
        const parts = [];
        if (result.street) parts.push(result.street);
        if (result.district) parts.push(result.district);
        if (result.city) parts.push(result.city);
        if (result.region && !parts.includes(result.region)) parts.push(result.region);
        if (result.country && parts.length < 3) parts.push(result.country);
        
        const address = parts.join(', ');
        addressCache.current.set(cacheKey, address);
        
        if (addressCache.current.size > 100) {
          const firstKey = addressCache.current.keys().next().value;
          addressCache.current.delete(firstKey);
        }
        
        return address;
      }
    } catch (error) {
      console.log('Reverse geocoding error:', error);
    }
    
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  }, [checkLocationPermission]);

  const getTimeAgo = useCallback((timestamp) => {
    if (!timestamp) return 'Just now';
    
    try {
      let alertTime;
      
      if (timestamp?.toDate) {
        alertTime = timestamp.toDate();
      } else if (timestamp?.seconds) {
        alertTime = new Date(timestamp.seconds * 1000);
      } else if (timestamp instanceof Date) {
        alertTime = timestamp;
      } else if (typeof timestamp === 'string') {
        alertTime = new Date(timestamp);
      } else if (timestamp?._seconds) {
        alertTime = new Date(timestamp._seconds * 1000);
      } else {
        return 'Just now';
      }

      if (isNaN(alertTime.getTime())) return 'Just now';

      const now = new Date();
      const diffSeconds = Math.floor((now - alertTime) / 1000);
      
      if (diffSeconds < 5) return 'Just now';
      if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
      if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} minutes ago`;
      if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} hours ago`;
      if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)} days ago`;
      if (diffSeconds < 2592000) return `${Math.floor(diffSeconds / 604800)} weeks ago`;
      return alertTime.toLocaleDateString();
    } catch (error) {
      return 'Just now';
    }
  }, []);

  const getAlertSettingKey = useCallback((alertType) => {
    if (!alertType) return null;
    
    const typeLower = alertType.toLowerCase().trim();
    
    if (ALERT_TYPE_MAPPING[typeLower]) {
      return ALERT_TYPE_MAPPING[typeLower];
    }
    
    for (const [key, value] of Object.entries(ALERT_TYPE_MAPPING)) {
      if (typeLower.includes(key)) {
        return value;
      }
    }
    
    if (typeLower.includes('emergency') || typeLower.includes('critical')) {
      return 'emergencyAlerts';
    }
    
    return null;
  }, []);

  // ==================== READ ALERTS DOCUMENT ====================

  const loadReadAlerts = useCallback(async (userId) => {
    try {
      const readAlertsRef = doc(db, 'users', userId, 'preferences', 'readAlerts');
      const readAlertsDoc = await getDoc(readAlertsRef);
      
      if (readAlertsDoc.exists()) {
        const data = readAlertsDoc.data();
        const readAlertIds = data.alertIds || [];
        setReadAlerts(new Set(readAlertIds));
      } else {
        await setDoc(readAlertsRef, {
          alertIds: [],
          updatedAt: Timestamp.now()
        });
        setReadAlerts(new Set());
      }
    } catch (error) {
      console.error('Error loading read alerts:', error);
      setReadAlerts(new Set());
    }
  }, []);

  const saveReadAlerts = useCallback(async (alertIds) => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return;
      
      const readAlertsRef = doc(db, 'users', user.uid, 'preferences', 'readAlerts');
      await updateDoc(readAlertsRef, {
        alertIds: Array.from(alertIds),
        updatedAt: Timestamp.now()
      });
    } catch (error) {
      console.error('Error saving read alerts:', error);
    }
  }, []);

  // ==================== ALERT FILTERING ====================

  const shouldShowAlert = useCallback((alert) => {
    if (!alert) return false;

    const severity = alert.severity?.toUpperCase?.() || alert.alertLevel?.toUpperCase?.();
    if (severity === SEVERITY_LEVELS.CRITICAL || severity === SEVERITY_LEVELS.HIGH) {
      return true;
    }

    const alertType = alert.type || alert.alertType || '';
    const settingKey = getAlertSettingKey(alertType);

    if (settingKey) {
      if (alertType.toLowerCase().includes('geofence')) {
        return alertSettings.geofenceAlerts !== false ||
               alertSettings.geofenceEntryAlerts !== false ||
               alertSettings.geofenceExitAlerts !== false ||
               alertSettings.geofenceOvernightAlerts !== false;
      }
      return alertSettings[settingKey] !== false;
    }

    return true;
  }, [alertSettings, getAlertSettingKey]);

  const applyAlertFilters = useCallback((alerts) => {
    if (!alerts || alerts.length === 0) {
      setFilteredAlerts([]);
      setUnreadCount(0);
      setAlertStats({
        total: 0,
        emergency: 0,
        geofence: 0,
        driving: 0,
      });
      return;
    }

    const alertsWithReadStatus = alerts.map(alert => ({
      ...alert,
      read: alert.read || readAlerts.has(alert.id)
    }));

    const filtered = alertsWithReadStatus.filter(shouldShowAlert);
    
    const stats = {
      total: filtered.length,
      emergency: filtered.filter(a => 
        a.severity === SEVERITY_LEVELS.CRITICAL || 
        a.severity === SEVERITY_LEVELS.HIGH ||
        a.type?.toLowerCase().includes('emergency') ||
        a.type?.toLowerCase().includes('sos') ||
        a.type?.toLowerCase().includes('impact')
      ).length,
      geofence: filtered.filter(a => 
        a.type?.toLowerCase().includes('geofence')
      ).length,
      driving: filtered.filter(a => 
        a.type?.toLowerCase().includes('speed') ||
        a.type?.toLowerCase().includes('brake') ||
        a.type?.toLowerCase().includes('acceleration')
      ).length,
    };

    setFilteredAlerts(filtered);
    setUnreadCount(filtered.filter(a => !a.read).length);
    setAlertStats(stats);
  }, [shouldShowAlert, readAlerts]);

  // ==================== OPTIMIZED ALERT LOADING ====================

  const loadAlerts = useCallback(async (showLoading = true) => {
    if (fetchInProgressRef.current) {
      console.log('🔄 Fetch already in progress, skipping...');
      return;
    }

    fetchInProgressRef.current = true;

    try {
      if (showLoading) setLoading(true);
      
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) {
        setAllAlerts([]);
        setFilteredAlerts([]);
        setLoading(false);
        fetchInProgressRef.current = false;
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        setAllAlerts([]);
        setFilteredAlerts([]);
        setLoading(false);
        fetchInProgressRef.current = false;
        return;
      }

      const userData = userDoc.data();
      const currentLinkedDrivers = userData.linkedDrivers || [];
      setLinkedDrivers(currentLinkedDrivers);
      driverInfoCache.current.clear();

      const driverIds = currentLinkedDrivers.map(d => d.driverId).filter(id => id);
      
      if (driverIds.length === 0) {
        setAllAlerts([]);
        setFilteredAlerts([]);
        setLoading(false);
        fetchInProgressRef.current = false;
        return;
      }

      const alertsMap = new Map();
      const queryPromises = [];

      queryPromises.push(
        getDocs(
          query(
            collection(db, 'alerts'),
            where('familyId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(100)
          )
        ).catch(error => {
          console.log('Main alerts error:', error.message);
          return null;
        })
      );

      if (driverIds.length > 0) {
        queryPromises.push(
          getDocs(
            query(
              collection(db, 'emergencies'),
              where('userId', 'in', driverIds.slice(0, 10)),
              orderBy('timestamp', 'desc'),
              limit(50)
            )
          ).catch(error => {
            console.log('Emergencies error:', error.message);
            return null;
          })
        );

        queryPromises.push(
          getDocs(
            query(
              collection(db, 'emergency_logs'),
              where('userId', 'in', driverIds.slice(0, 10)),
              orderBy('timestamp', 'desc'),
              limit(50)
            )
          ).catch(error => {
            console.log('Emergency logs error:', error.message);
            return null;
          })
        );
      }

      const mainResults = await Promise.all(queryPromises);
      
      if (mainResults[0] && !mainResults[0].empty) {
        mainResults[0].forEach(doc => {
          const data = doc.data();
          alertsMap.set(doc.id, {
            id: doc.id,
            ...data,
            source: 'main_alert',
            timestamp: data.timestamp || data.createdAt || Timestamp.now(),
            read: data.read || false,
          });
        });
      }

      if (mainResults[1] && !mainResults[1].empty) {
        mainResults[1].forEach(doc => {
          const data = doc.data();
          const alertId = `emergency_${doc.id}`;
          if (!alertsMap.has(alertId)) {
            alertsMap.set(alertId, {
              id: alertId,
              ...data,
              type: data.emergencyType || 'emergency',
              driverId: data.userId,
              driverName: data.driverName,
              source: 'emergency',
              message: data.message || `Emergency: ${data.emergencyType || 'Unknown'}`,
              severity: data.severity || 'HIGH',
              timestamp: data.timestamp || data.createdAt || Timestamp.now(),
              read: data.read || false,
              location: data.location,
              speed: data.speed,
              gForce: data.gForce,
            });
          }
        });
      }

      if (mainResults[2] && !mainResults[2].empty) {
        mainResults[2].forEach(doc => {
          const data = doc.data();
          const alertId = `emergency_log_${doc.id}`;
          if (!alertsMap.has(alertId)) {
            alertsMap.set(alertId, {
              id: alertId,
              ...data,
              type: data.type || 'emergency_log',
              driverId: data.userId,
              driverName: data.driverName,
              source: 'emergency_log',
              message: data.message || `Emergency Log: ${data.type || 'Unknown'}`,
              severity: data.severity || 'MEDIUM',
              timestamp: data.timestamp || data.createdAt || Timestamp.now(),
              read: false,
              location: data.coords,
              speed: data.speed,
              gForce: data.gForce,
              userResponse: data.userResponse,
            });
          }
        });
      }

      let uniqueAlerts = Array.from(alertsMap.values());

      uniqueAlerts.sort((a, b) => {
        const getTime = (item) => {
          if (!item.timestamp) return 0;
          if (item.timestamp?.toDate) return item.timestamp.toDate().getTime();
          if (item.timestamp?.seconds) return item.timestamp.seconds * 1000;
          if (item.timestamp instanceof Date) return item.timestamp.getTime();
          if (typeof item.timestamp === 'string') return new Date(item.timestamp).getTime();
          return 0;
        };
        return getTime(b) - getTime(a);
      });
      
      if (isMountedRef.current) {
        setAllAlerts(uniqueAlerts);
        applyAlertFilters(uniqueAlerts);
        lastFetchRef.current = Date.now();
      }

    } catch (error) {
      console.error('❌ Error loading alerts:', error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      fetchInProgressRef.current = false;
    }
  }, [applyAlertFilters]);

  // ==================== REAL-TIME LISTENERS ====================

  const setupListeners = useCallback((user) => {
    if (!user || !isMountedRef.current) return;

    // Clean up existing listeners
    if (mainAlertsUnsubscribeRef.current) mainAlertsUnsubscribeRef.current();
    if (readAlertsUnsubscribeRef.current) readAlertsUnsubscribeRef.current();
    if (userUnsubscribeRef.current) userUnsubscribeRef.current();

    // Main alerts listener with debounce
    const mainAlertsQuery = query(
      collection(db, 'alerts'),
      where('familyId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    let alertDebounceTimeout;
    mainAlertsUnsubscribeRef.current = onSnapshot(mainAlertsQuery, () => {
      if (!isMountedRef.current) return;
      
      if (alertDebounceTimeout) clearTimeout(alertDebounceTimeout);
      alertDebounceTimeout = setTimeout(() => {
        if (!fetchInProgressRef.current) {
          console.log('🔄 Main alerts update detected');
          loadAlerts(false);
        }
      }, 3000);
    }, (error) => {
      console.log('Main alerts listener error:', error.message);
    });

    // Read alerts listener
    const readAlertsRef = doc(db, 'users', user.uid, 'preferences', 'readAlerts');
    readAlertsUnsubscribeRef.current = onSnapshot(readAlertsRef, (doc) => {
      if (!isMountedRef.current) return;
      
      if (doc.exists()) {
        const data = doc.data();
        const readAlertIds = data.alertIds || [];
        setReadAlerts(new Set(readAlertIds));
      }
    }, (error) => {
      console.log('Read alerts listener error:', error.message);
    });

    // User data listener
    const userRef = doc(db, 'users', user.uid);
    userUnsubscribeRef.current = onSnapshot(userRef, (doc) => {
      if (!isMountedRef.current || !doc.exists()) return;
      
      const data = doc.data();
      setUserData(data);
      
      const newLinkedDrivers = data.linkedDrivers || [];
      setLinkedDrivers(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(newLinkedDrivers)) {
          driverInfoCache.current.clear();
          return newLinkedDrivers;
        }
        return prev;
      });
      
      const settings = {
        emergencyAlerts: data.emergencyAlerts !== false,
        safetyAlerts: data.safetyAlerts !== false,
        impactAlerts: data.impactAlerts !== false,
        sosAlerts: data.sosAlerts !== false,
        speedAlerts: data.speedAlerts !== false,
        harshBrakingAlerts: data.harshBrakingAlerts !== false,
        rapidAccelAlerts: data.rapidAccelAlerts !== false,
        harshTurnAlerts: data.harshTurnAlerts !== false,
        drivingScoreAlerts: data.drivingScoreAlerts !== false,
        locationAlerts: data.locationAlerts !== false,
        geofenceAlerts: data.geofenceAlerts !== false,
        boundaryAlerts: data.boundaryAlerts !== false,
        tripUpdates: data.tripUpdates !== false,
        driverOnlineAlerts: data.driverOnlineAlerts !== false,
        driverOfflineAlerts: data.driverOfflineAlerts === true,
        geofenceEntryAlerts: data.geofenceEntryAlerts !== false,
        geofenceExitAlerts: data.geofenceExitAlerts !== false,
        geofenceOvernightAlerts: data.geofenceOvernightAlerts !== false,
      };
      
      setAlertSettings(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(settings)) {
          return settings;
        }
        return prev;
      });
    }, (error) => {
      console.log('User listener error:', error.message);
    });

  }, [loadAlerts]);

  // ==================== ALERT ACTIONS ====================

  const markAlertAsRead = useCallback(async (alertId) => {
    try {
      setReadAlerts(prev => {
        const newSet = new Set(prev);
        newSet.add(alertId);
        saveReadAlerts(newSet);
        return newSet;
      });
      
      setAllAlerts(prev => {
        const updated = prev.map(alert => 
          alert.id === alertId ? { ...alert, read: true } : alert
        );
        applyAlertFilters(updated);
        return updated;
      });

      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return;

      const batch = writeBatch(db);

      try {
        const mainRef = doc(db, 'alerts', alertId);
        batch.update(mainRef, { 
          read: true, 
          readAt: Timestamp.now() 
        });
      } catch (e) {}

      await batch.commit();
    } catch (error) {
      console.error('Error marking alert as read:', error);
    }
  }, [applyAlertFilters, saveReadAlerts]);

  const markAllAlertsAsRead = useCallback(async () => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return;

      const unreadAlertIds = filteredAlerts
        .filter(alert => !alert.read)
        .map(alert => alert.id);
      
      if (unreadAlertIds.length === 0) {
        Alert.alert('Info', 'No unread alerts');
        return;
      }

      setReadAlerts(prev => {
        const newSet = new Set(prev);
        unreadAlertIds.forEach(id => newSet.add(id));
        saveReadAlerts(newSet);
        return newSet;
      });

      setAllAlerts(prev => {
        const updated = prev.map(alert => 
          unreadAlertIds.includes(alert.id) ? { ...alert, read: true } : alert
        );
        applyAlertFilters(updated);
        return updated;
      });

      const batch = writeBatch(db);
      
      unreadAlertIds.forEach(alertId => {
        try {
          const mainRef = doc(db, 'alerts', alertId);
          batch.update(mainRef, { 
            read: true, 
            readAt: Timestamp.now() 
          });
        } catch (e) {}
      });

      await batch.commit();
      
      Alert.alert('Success', `Marked ${unreadAlertIds.length} alerts as read`);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }, [filteredAlerts, applyAlertFilters, saveReadAlerts]);

  const deleteAlert = useCallback(async (alertId) => {
    Alert.alert(
      'Delete Alert',
      'Are you sure you want to delete this alert?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setReadAlerts(prev => {
                const newSet = new Set(prev);
                newSet.delete(alertId);
                saveReadAlerts(newSet);
                return newSet;
              });

              setAllAlerts(prev => {
                const updated = prev.filter(alert => alert.id !== alertId);
                applyAlertFilters(updated);
                return updated;
              });

              const auth = getAuth();
              const user = auth.currentUser;
              if (!user) return;

              const batch = writeBatch(db);

              try {
                const mainRef = doc(db, 'alerts', alertId);
                batch.delete(mainRef);
              } catch (e) {}

              await batch.commit();
            } catch (error) {
              console.error('Error deleting alert:', error);
            }
          },
        },
      ]
    );
  }, [applyAlertFilters, saveReadAlerts]);

  // ==================== ALERT RENDERING HELPERS ====================

  const getAlertIcon = useCallback((type, source) => {
    if (!type) return 'notifications-outline';
    
    const typeLower = type.toLowerCase();
    
    if (typeLower.includes('geofence_exit')) return 'exit-outline';
    if (typeLower.includes('geofence_entry')) return 'enter-outline';
    if (typeLower.includes('geofence_return')) return 'return-up-back-outline';
    if (typeLower.includes('geofence_overnight')) return 'moon-outline';
    if (typeLower.includes('geofence_created')) return 'add-circle-outline';
    if (typeLower.includes('geofence')) return 'location-outline';
    if (typeLower.includes('emergency')) return 'alert-circle';
    if (typeLower.includes('sos')) return 'sad-outline';
    if (typeLower.includes('impact')) return 'battery-dead-outline';
    if (typeLower.includes('collision')) return 'flash-outline';
    if (typeLower.includes('accident')) return 'warning-outline';
    if (typeLower.includes('speed')) return 'speedometer-outline';
    if (typeLower.includes('brake')) return 'hand-right-outline';
    if (typeLower.includes('acceleration')) return 'rocket-outline';
    if (typeLower.includes('turn')) return 'repeat-outline';
    if (typeLower.includes('score')) return 'star-outline';
    if (typeLower.includes('boundary')) return 'navigate-outline';
    if (typeLower.includes('location')) return 'pin-outline';
    if (typeLower.includes('trip_start')) return 'play-outline';
    if (typeLower.includes('trip_end')) return 'stop-outline';
    if (typeLower.includes('trip')) return 'car-outline';
    if (typeLower.includes('driver_online')) return 'radio-outline';
    if (typeLower.includes('driver_offline')) return 'radio-button-off-outline';
    
    if (source === 'geofence_alert' || source === 'geofence_violation') return 'location-outline';
    if (source === 'emergency') return 'alert-circle';
    if (source === 'emergency_log') return 'document-text-outline';
    
    return 'notifications-outline';
  }, []);

  const getAlertColor = useCallback((severity, type) => {
    if (severity) {
      const sev = severity.toUpperCase();
      if (sev === SEVERITY_LEVELS.CRITICAL) return '#dc3545';
      if (sev === SEVERITY_LEVELS.HIGH) return '#ff6b6b';
      if (sev === SEVERITY_LEVELS.MEDIUM) return '#ffc107';
      if (sev === SEVERITY_LEVELS.LOW) return '#17a2b8';
      if (sev === SEVERITY_LEVELS.INFO) return '#28a745';
    }

    if (!type) return '#d63384';
    
    const typeLower = type.toLowerCase();
    
    if (typeLower.includes('geofence_exit')) return '#dc3545';
    if (typeLower.includes('geofence_entry')) return '#28a745';
    if (typeLower.includes('geofence_return')) return '#28a745';
    if (typeLower.includes('geofence_overnight')) return '#6f42c1';
    if (typeLower.includes('geofence_created')) return '#007bff';
    if (typeLower.includes('geofence')) return '#007bff';
    if (typeLower.includes('emergency')) return '#dc3545';
    if (typeLower.includes('sos')) return '#dc3545';
    if (typeLower.includes('impact')) return '#fd7e14';
    if (typeLower.includes('speed')) return '#ffc107';
    if (typeLower.includes('brake')) return '#fd7e14';
    if (typeLower.includes('acceleration')) return '#ffc107';
    
    return '#d63384';
  }, []);

  const getAlertTitle = useCallback((type, source) => {
    if (!type) {
      if (source === 'geofence_alert' || source === 'geofence_violation') return '📍 Geofence Alert';
      if (source === 'emergency') return '🚨 Emergency';
      if (source === 'emergency_log') return '📋 Emergency Log';
      return '📢 Alert';
    }
    
    const typeLower = type.toLowerCase();
    
    if (typeLower.includes('geofence_exit')) return '📍 Geofence Exit';
    if (typeLower.includes('geofence_entry')) return '📍 Geofence Entry';
    if (typeLower.includes('geofence_return')) return '📍 Returned to Geofence';
    if (typeLower.includes('geofence_overnight')) return '🌙 Overnight Geofence';
    if (typeLower.includes('geofence_created')) return '📍 Geofence Created';
    if (typeLower.includes('geofence')) return '📍 Geofence Alert';
    if (typeLower.includes('emergency')) return '🚨 Emergency Alert';
    if (typeLower.includes('sos')) return '🆘 SOS Alert';
    if (typeLower.includes('impact')) return '💥 Impact Detected';
    if (typeLower.includes('collision')) return '💥 Collision Alert';
    if (typeLower.includes('accident')) return '⚠️ Accident Alert';
    if (typeLower.includes('speed')) return '🚗 Speed Alert';
    if (typeLower.includes('brake')) return '🛑 Harsh Braking';
    if (typeLower.includes('acceleration')) return '⚡ Rapid Acceleration';
    if (typeLower.includes('turn')) return '↪️ Harsh Turn';
    if (typeLower.includes('score')) return '📊 Driving Score';
    if (typeLower.includes('boundary')) return '🚧 Boundary Alert';
    if (typeLower.includes('location')) return '📍 Location Update';
    if (typeLower.includes('trip_start')) return '🚗 Trip Started';
    if (typeLower.includes('trip_end')) return '🛑 Trip Ended';
    if (typeLower.includes('trip')) return '📊 Trip Update';
    if (typeLower.includes('driver_online')) return '📡 Driver Online';
    if (typeLower.includes('driver_offline')) return '📡 Driver Offline';
    
    if (source === 'geofence_alert' || source === 'geofence_violation') return '📍 Geofence Alert';
    if (source === 'emergency') return '🚨 Emergency';
    if (source === 'emergency_log') return '📋 Emergency Log';
    
    return '📢 Alert';
  }, []);

  // ==================== RENDER ALERT ITEM ====================

  const AlertItem = ({ item }) => {
    const [locationText, setLocationText] = useState('Loading address...');
    const [locationError, setLocationError] = useState(false);
    const driverInfo = getDriverInfo(item.driverId);
    const alertColor = getAlertColor(item.severity, item.type);
    const alertIcon = getAlertIcon(item.type, item.source);
    const alertTitle = getAlertTitle(item.type, item.source);
    const timeAgo = getTimeAgo(item.timestamp);
    const location = item.location || item.coords || item.alertLocation || item.geofenceLocation;

    useEffect(() => {
      let isMounted = true;

      const loadAddress = async () => {
        if (!location) {
          setLocationText('Location unknown');
          return;
        }

        if (typeof location === 'string') {
          setLocationText(location);
          return;
        }

        if (location.address) {
          setLocationText(location.address);
          return;
        }

        try {
          if (location.latitude && location.longitude) {
            const address = await getAddressFromCoordinates(location.latitude, location.longitude);
            if (isMounted) {
              setLocationText(address || `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`);
              setLocationError(false);
            }
          } else if (location.coords) {
            const { latitude, longitude } = location.coords;
            if (latitude && longitude) {
              const address = await getAddressFromCoordinates(latitude, longitude);
              if (isMounted) {
                setLocationText(address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
                setLocationError(false);
              }
            }
          } else {
            setLocationText('Location coordinates unavailable');
          }
        } catch (error) {
          if (isMounted) {
            setLocationError(true);
            setLocationText('Location unavailable');
          }
        }
      };

      loadAddress();

      return () => {
        isMounted = false;
      };
    }, [location]);

    const openMaps = () => {
      let lat, lon;
      
      if (!location) return;
      
      if (typeof location === 'object') {
        if (location.latitude && location.longitude) {
          lat = location.latitude;
          lon = location.longitude;
        } else if (location.coords) {
          lat = location.coords.latitude;
          lon = location.coords.longitude;
        }
      }
      
      if (lat && lon) {
        const url = Platform.OS === 'ios'
          ? `http://maps.apple.com/?ll=${lat},${lon}`
          : `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
        Linking.openURL(url);
      }
    };

    return (
      <TouchableOpacity
        style={[
          styles.alertCard,
          !item.read && styles.unreadAlert,
          { borderLeftColor: alertColor },
        ]}
        onPress={() => markAlertAsRead(item.id)}
        onLongPress={() => deleteAlert(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.alertHeader}>
          <View style={[styles.alertIcon, { backgroundColor: alertColor + '15' }]}>
            <Ionicons name={alertIcon} size={22} color={alertColor} />
          </View>

          <View style={styles.alertContent}>
            <View style={styles.alertTitleRow}>
              <Text style={[styles.alertTitle, { color: alertColor }]} numberOfLines={1}>
                {alertTitle}
              </Text>
              <Text style={styles.alertTime}>{timeAgo}</Text>
            </View>

            <View style={styles.driverInfoRow}>
              {driverInfo.profileImage ? (
                <Image source={{ uri: driverInfo.profileImage }} style={styles.driverThumb} />
              ) : (
                <View style={[styles.driverThumbPlaceholder, { backgroundColor: alertColor + '30' }]}>
                  <Ionicons name="person" size={12} color={alertColor} />
                </View>
              )}
              <Text style={styles.driverName} numberOfLines={1}>
                {driverInfo.name}
              </Text>
              <View style={[styles.relationBadge, { backgroundColor: alertColor + '15' }]}>
                <Text style={[styles.relationText, { color: alertColor }]}>
                  {driverInfo.relation}
                </Text>
              </View>
            </View>

            <Text style={styles.alertMessage} numberOfLines={2}>
              {item.message || item.alertMessage || `${driverInfo.name} triggered a ${item.type || 'alert'}`}
            </Text>

            {(location || item.speed || item.gForce) && (
              <View style={styles.alertDetails}>
                {location && (
                  <TouchableOpacity 
                    style={styles.detailRow} 
                    onPress={openMaps}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="location-outline" size={14} color="#666" />
                    <Text style={[styles.detailText, styles.locationText]} numberOfLines={2}>
                      {locationText}
                    </Text>
                    <Ionicons name="open-outline" size={12} color="#d63384" style={styles.openIcon} />
                  </TouchableOpacity>
                )}

                <View style={styles.detailRow}>
                  {item.speed !== undefined && item.speed !== null && (
                    <View style={styles.detailItem}>
                      <Ionicons name="speedometer-outline" size={14} color="#666" />
                      <Text style={styles.detailText}>{item.speed} km/h</Text>
                    </View>
                  )}
                  {item.gForce !== undefined && item.gForce !== null && (
                    <View style={styles.detailItem}>
                      <Ionicons name="flash-outline" size={14} color="#666" />
                      <Text style={styles.detailText}>{item.gForce}G</Text>
                    </View>
                  )}
                  {item.userResponse && (
                    <View style={styles.detailItem}>
                      <Ionicons 
                        name={item.userResponse === 'safe' ? 'checkmark-circle' : 'help-circle'} 
                        size={14} 
                        color={item.userResponse === 'safe' ? '#28a745' : '#ffc107'} 
                      />
                      <Text style={styles.detailText}>
                        {item.userResponse === 'safe' ? 'Driver safe' : 'No response'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>
                {item.type || item.alertType || 'Alert'} • {item.source?.replace('_', ' ') || 'System'}
              </Text>
            </View>
          </View>

          {!item.read && <View style={[styles.unreadDot, { backgroundColor: alertColor }]} />}
        </View>

        <Text style={styles.deleteHint}>Long press to delete</Text>
      </TouchableOpacity>
    );
  };

  // ==================== EFFECTS ====================

  useEffect(() => {
    isMountedRef.current = true;
    
    checkLocationPermission();
    
    const auth = getAuth();
    authUnsubscribeRef.current = onAuthStateChanged(auth, (user) => {
      if (!isMountedRef.current) return;
      
      if (user) {
        loadReadAlerts(user.uid).then(() => {
          setupListeners(user);
          loadAlerts(true);
        });
      } else {
        setAllAlerts([]);
        setFilteredAlerts([]);
        setLinkedDrivers([]);
        setReadAlerts(new Set());
        setLoading(false);
      }
    });

    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        if (lastFetchRef.current && Date.now() - lastFetchRef.current > 5 * 60 * 1000) {
          loadAlerts(false);
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      isMountedRef.current = false;
      
      if (authUnsubscribeRef.current) authUnsubscribeRef.current();
      subscription.remove();
      
      if (mainAlertsUnsubscribeRef.current) mainAlertsUnsubscribeRef.current();
      if (readAlertsUnsubscribeRef.current) readAlertsUnsubscribeRef.current();
      if (userUnsubscribeRef.current) userUnsubscribeRef.current();
      
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (allAlerts.length > 0) {
      applyAlertFilters(allAlerts);
    }
  }, [alertSettings, allAlerts, readAlerts]);

  // ==================== RENDER ====================

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#d63384" />
        <Text style={styles.loadingText}>Loading alerts...</Text>
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* Header */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Driver Alerts</Text>
          </View>
          <TouchableOpacity 
            style={styles.profileWrapper}
            onPress={() => navigation.navigate('FamilySettings')}
          >
            <Text style={styles.headerProfileName} numberOfLines={1}>
              {getUserName()}
            </Text>
            {getProfileImage() ? (
              <Image source={{ uri: getProfileImage() }} style={styles.profileImage} />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Ionicons name="person" size={20} color="#d63384" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={[styles.statCard, { backgroundColor: '#fff' }]}>
          <Text style={styles.statNumber}>{filteredAlerts.length}</Text>
          <Text style={styles.statLabel}>Total Alerts</Text>
          <Text style={styles.statSubtext}>{allAlerts.length} total</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fff' }]}>
          <Text style={[styles.statNumber, unreadCount > 0 && styles.unreadNumber]}>
            {unreadCount}
          </Text>
          <Text style={styles.statLabel}>Unread</Text>
          <Text style={styles.statSubtext}>{alertStats.emergency} critical</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fff' }]}>
          <Text style={styles.statNumber}>{linkedDrivers.length}</Text>
          <Text style={styles.statLabel}>Drivers</Text>
          <Text style={styles.statSubtext}>{alertStats.geofence} geofence</Text>
        </View>
      </View>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <Text style={styles.sectionTitle}>Recent Alerts</Text>
          <TouchableOpacity 
            onPress={() => navigation.navigate('FamilySettings', { screen: 'preferences' })}
            style={styles.settingsLink}
          >
            <Ionicons name="settings-outline" size={14} color="#d63384" />
            <Text style={styles.settingsLinkText}>Settings</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.sectionHeaderRight}>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllAlertsAsRead} style={styles.markAllButton}>
              <Ionicons name="checkmark-done" size={18} color="#d63384" />
              <Text style={styles.markAllText}>Mark All Read</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => loadAlerts(true)} style={styles.refreshButton}>
            <Ionicons name="refresh" size={18} color="#d63384" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Location Permission Warning */}
      {locationPermission === false && (
        <View style={styles.permissionWarning}>
          <Ionicons name="location-outline" size={16} color="#ff6b6b" />
          <Text style={styles.permissionWarningText}>
            Location permission needed for addresses
          </Text>
          <TouchableOpacity 
            onPress={requestLocationPermission}
            style={styles.permissionButton}
          >
            <Text style={styles.permissionButtonText}>Enable</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Filter Info */}
      {allAlerts.length > filteredAlerts.length && (
        <View style={styles.filterInfo}>
          <Ionicons name="information-circle" size={16} color="#666" />
          <Text style={styles.filterInfoText}>
            Showing {filteredAlerts.length} of {allAlerts.length} alerts (filtered)
          </Text>
        </View>
      )}

      {/* Alerts List */}
      {filteredAlerts.length > 0 ? (
        <FlatList
          data={filteredAlerts}
          renderItem={({ item }) => <AlertItem item={item} />}
          keyExtractor={(item) => item.id || Math.random().toString()}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadAlerts(false);
              }}
              colors={['#d63384']}
              tintColor="#d63384"
            />
          }
          ListFooterComponent={
            filteredAlerts.length > 0 && (
              <View style={styles.listFooter}>
                <Text style={styles.footerText}>
                  End of alerts • {filteredAlerts.length} total
                </Text>
              </View>
            )
          }
        />
      ) : (
        <View style={styles.emptyState}>
          {allAlerts.length > 0 ? (
            <>
              <View style={styles.emptyIcon}>
                <Ionicons name="filter" size={60} color="#d63384" />
              </View>
              <Text style={styles.emptyTitle}>All Alerts Filtered</Text>
              <Text style={styles.emptySubtext}>
                {allAlerts.length} alerts are hidden by your settings
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => navigation.navigate('FamilySettings', { screen: 'preferences' })}
              >
                <Ionicons name="settings-outline" size={20} color="#fff" />
                <Text style={styles.emptyButtonText}>Adjust Settings</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.emptyIcon}>
                <Ionicons name="notifications-off-outline" size={60} color="#d63384" />
              </View>
              <Text style={styles.emptyTitle}>No Alerts Yet</Text>
              <Text style={styles.emptySubtext}>
                {linkedDrivers.length === 0 
                  ? 'Link drivers to start receiving alerts'
                  : 'Alerts from your drivers will appear here'}
              </Text>
              {linkedDrivers.length === 0 && (
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => navigation.navigate('ProfileLinkageScreen')}
                >
                  <Ionicons name="people-outline" size={20} color="#fff" />
                  <Text style={styles.emptyButtonText}>Link Drivers</Text>
                </TouchableOpacity>
              )}
              {linkedDrivers.length > 0 && (
                <TouchableOpacity
                  style={styles.emptyButton}
                  onPress={() => loadAlerts(true)}
                >
                  <Ionicons name="refresh" size={20} color="#fff" />
                  <Text style={styles.emptyButtonText}>Refresh</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      {/* Footer Navigation */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity onPress={() => navigation.navigate('FamilyDashboard')} style={styles.footerButton}>
            <Ionicons name="home-outline" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('DriverTracking')} style={styles.footerButton}>
            <Ionicons name="map-outline" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('FamilyAlerts')} style={styles.footerButton}>
            <View style={styles.activeTab}>
              <Ionicons name="notifications" size={24} color="#fff" />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('FamilySettings')} style={styles.footerButton}>
            <Ionicons name="settings-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    color: '#d63384',
    fontSize: 16,
    fontWeight: '500',
  },
  headerWrapper: {
    backgroundColor: '#d63384',
    paddingTop: 50,
    paddingBottom: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subTitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  profileWrapper: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 25,
  },
  headerProfileName: {
    color: '#fff',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 100,
  },
  profileImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileImagePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#d63384',
  },
  unreadNumber: {
    color: '#dc3545',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    fontWeight: '500',
  },
  statSubtext: {
    fontSize: 10,
    color: '#999',
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  settingsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
  },
  settingsLinkText: {
    fontSize: 12,
    color: '#d63384',
    fontWeight: '500',
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  markAllText: {
    color: '#d63384',
    fontSize: 12,
    fontWeight: '600',
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  permissionWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3cd',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  permissionWarningText: {
    fontSize: 12,
    color: '#856404',
    flex: 1,
  },
  permissionButton: {
    backgroundColor: '#d63384',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  filterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f3f5',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  filterInfoText: {
    fontSize: 12,
    color: '#495057',
    flex: 1,
  },
  debugInfo: {
    backgroundColor: '#fff3cd',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffeeba',
  },
  debugText: {
    fontSize: 12,
    color: '#856404',
    marginBottom: 4,
  },
  debugButton: {
    backgroundColor: '#d63384',
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  debugButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  alertCard: {
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
  },
  unreadAlert: {
    backgroundColor: '#fff',
    shadowOpacity: 0.15,
    elevation: 5,
  },
  alertHeader: {
    flexDirection: 'row',
  },
  alertIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  alertTime: {
    fontSize: 11,
    color: '#868e96',
    marginLeft: 8,
  },
  driverInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  driverThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  driverThumbPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  driverName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  relationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginLeft: 8,
  },
  relationText: {
    fontSize: 10,
    fontWeight: '600',
  },
  alertMessage: {
    fontSize: 14,
    color: '#444',
    marginBottom: 10,
    lineHeight: 20,
  },
  alertDetails: {
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 12,
    gap: 6,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 12,
    color: '#666',
    flex: 1,
  },
  locationText: {
    color: '#1d807c',
    textDecorationLine: 'underline',
  },
  openIcon: {
    marginLeft: 4,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f3f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typeText: {
    fontSize: 10,
    color: '#868e96',
    textTransform: 'uppercase',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },
  deleteHint: {
    fontSize: 10,
    color: '#adb5bd',
    marginTop: 8,
    textAlign: 'right',
  },
  listFooter: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#868e96',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#868e96',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d63384',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    gap: 8,
    shadowColor: '#d63384',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footerWrapper: {
    position: 'absolute',
    bottom: 20,
    width: '100%',
    alignItems: 'center',
  },
  footerNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#d63384',
    width: width * 0.85,
    borderRadius: 35,
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  footerButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    position: 'relative',
  },
  activeTab: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#ff4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

export default FamilyAlertsTab;