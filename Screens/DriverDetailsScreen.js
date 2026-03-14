import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { WebView } from 'react-native-webview';

const DriverDetailsScreen = ({ route, navigation }) => {
  const { driverId } = route.params;
  const webViewRef = useRef(null);
  const locationUpdateInterval = useRef(null);

  const [userData, setUserData] = useState(null);
  const [driverInfo, setDriverInfo] = useState(null);
  const [currentTrip, setCurrentTrip] = useState(null);
  const [recentTrips, setRecentTrips] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [emergencyLogs, setEmergencyLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [path, setPath] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [emergencyLogsLoading, setEmergencyLogsLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  
  // Permissions state
  const [permissions, setPermissions] = useState({
    shareLocation: true,
    shareTripHistory: true,
    emergencyAlert: true
  });
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  // Helper functions for user data
  const getUserName = useCallback(() => {
    if (!userData) return 'Family Admin';
    return userData.fullName || userData.name || userData.displayName || userData.email?.split('@')[0] || 'Family Admin';
  }, [userData]);

  const getProfileImage = useCallback(() => {
    if (!userData) return null;
    return userData.profileImage || userData.photoURL || userData.avatar || null;
  }, [userData]);

  // Format seconds to h m s
  const formatTime = useCallback((seconds) => {
    if (!seconds && seconds !== 0) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  }, []);

  // Format Firestore timestamp to readable date
  const formatDate = useCallback((timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return 'Invalid Date';
    }
  }, []);

  const formatTimeOnly = useCallback((timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true 
      });
    } catch {
      return 'Invalid Time';
    }
  }, []);

  // Format alert timestamp
  const formatAlertTime = useCallback((timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return 'Invalid Time';
    }
  }, []);

  // Get alert icon based on type
  const getAlertIcon = useCallback((type) => {
    switch (type) {
      case 'impact':
        return 'warning';
      case 'speed':
        return 'speedometer';
      case 'emergency':
        return 'alert-circle';
      case 'geofence':
        return 'location';
      default:
        return 'notifications';
    }
  }, []);

  // Get alert color based on type
  const getAlertColor = useCallback((type) => {
    switch (type) {
      case 'impact':
        return '#ff6b6b';
      case 'speed':
        return '#ffa726';
      case 'emergency':
        return '#e63946';
      case 'geofence':
        return '#1d807c';
      default:
        return '#666';
    }
  }, []);

  // Get alert title based on type
  const getAlertTitle = useCallback((type) => {
    switch (type) {
      case 'impact':
        return 'Impact Detected';
      case 'speed':
        return 'Speed Alert';
      case 'emergency':
        return 'Emergency Alert';
      case 'geofence':
        return 'Geofence Alert';
      default:
        return 'Alert';
    }
  }, []);

  // Function to update map location without reinitializing
  const updateMapLocation = useCallback((newLocation) => {
    if (webViewRef.current && mapReady && newLocation) {
      const jsCode = `
        if (typeof marker !== 'undefined') {
          marker.setLatLng([${newLocation.latitude}, ${newLocation.longitude}]);
          
          // Add point to path
          if (typeof polyline !== 'undefined') {
            var newPoint = L.latLng(${newLocation.latitude}, ${newLocation.longitude});
            var currentPoints = polyline.getLatLngs();
            currentPoints.push(newPoint);
            
            // Keep last 50 points for performance
            if (currentPoints.length > 50) {
              currentPoints.shift();
            }
            
            polyline.setLatLngs(currentPoints);
            
            // Pan map to new location but maintain zoom level
            map.panTo([${newLocation.latitude}, ${newLocation.longitude}], {animate: true});
          } else {
            // Create path if it doesn't exist
            var points = [L.latLng(${newLocation.latitude}, ${newLocation.longitude})];
            polyline = L.polyline(points, {
              color: '#1d807c',
              weight: 4,
              opacity: 0.8
            }).addTo(map);
            
            // Center map on location with fixed zoom
            map.setView([${newLocation.latitude}, ${newLocation.longitude}], 16, {animate: true});
          }
          
          // Update popup
          marker.bindPopup('<b>Driver Location</b><br>Last updated: ${formatTimeOnly(new Date())}').openPopup();
        }
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [mapReady, formatTimeOnly]);

  // Generate map HTML - fixed zoom level, no zoom controls
  const getMapHTML = useCallback(() => {
    if (!location) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
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
            .no-location {
              text-align: center;
              color: #666;
              padding: 20px;
            }
          </style>
        </head>
        <body>
          <div class="no-location">
            <h3>📍 Location Not Available</h3>
            <p>Waiting for driver location...</p>
          </div>
        </body>
        </html>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { width: 100vw; height: 100vh; background: #f0f0f0; }
          .leaflet-control-zoom { display: none; } /* Hide zoom controls */
          .leaflet-control-attribution { display: none; } /* Hide attribution */
          .driver-marker {
            background: #1d807c;
            border: 3px solid white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
          }
          .driver-marker::after {
            content: '🚗';
            position: absolute;
            top: -20px;
            left: 4px;
            font-size: 16px;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          try {
            // Initialize map with fixed zoom level and disabled zoom controls
            var map = L.map('map', {
              zoomControl: false,
              scrollWheelZoom: false,
              doubleClickZoom: false,
              boxZoom: false,
              keyboard: false,
              dragging: true, // Allow panning but not zoom
              zoom: 16,
              zoomSnap: 0.1
            }).setView([${location.latitude}, ${location.longitude}], 16);
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '',
              maxZoom: 16,
              minZoom: 16
            }).addTo(map);

            // Add driver marker
            var driverIcon = L.divIcon({
              className: 'driver-marker',
              iconSize: [24, 24],
              popupAnchor: [0, -12]
            });

            window.marker = L.marker([${location.latitude}, ${location.longitude}], {
              icon: driverIcon
            }).addTo(map);
            
            window.marker.bindPopup('<b>Driver Location</b><br>Last updated: ${formatTimeOnly(new Date())}').openPopup();

            // Initialize path array
            window.pathPoints = [L.latLng(${location.latitude}, ${location.longitude})];
            
            // Add path polyline
            window.polyline = L.polyline(window.pathPoints, {
              color: '#1d807c',
              weight: 4,
              opacity: 0.8
            }).addTo(map);

            // Send ready message
            window.ReactNativeWebView.postMessage('MAP_READY');
          } catch (error) {
            window.ReactNativeWebView.postMessage('MAP_ERROR: ' + error.message);
          }
        </script>
      </body>
      </html>
    `;
  }, [location, formatTimeOnly]);

  // Handle WebView messages
  const handleWebViewMessage = (event) => {
    if (event.nativeEvent.data === 'MAP_READY') {
      setMapReady(true);
    } else if (event.nativeEvent.data.startsWith('MAP_ERROR')) {
      console.error('Map error:', event.nativeEvent.data);
    }
  };

  // Fetch permissions for this driver
  const fetchPermissions = useCallback(async () => {
    try {
      const auth = getAuth();
      const familyUID = auth.currentUser?.uid;
      
      if (!familyUID || !driverId) {
        setPermissionsLoading(false);
        return;
      }

      const driverRef = doc(db, "users", driverId);
      const driverDoc = await getDoc(driverRef);
      
      if (driverDoc.exists()) {
        const driverData = driverDoc.data();
        const linkedFamilies = driverData.linkedFamilies || [];
        const familyLink = linkedFamilies.find((f) => f.familyId === familyUID) || {};
        
        const perms = familyLink.permissions || {};
        setPermissions({
          shareLocation: perms.shareLocation !== false,
          shareTripHistory: perms.shareTripHistory !== false,
          emergencyAlert: perms.emergencyAlert !== false,
        });
      } else {
        setPermissions({
          shareLocation: true,
          shareTripHistory: true,
          emergencyAlert: true
        });
      }
    } catch (error) {
      console.error('Error fetching permissions:', error);
      setPermissions({
        shareLocation: true,
        shareTripHistory: true,
        emergencyAlert: true
      });
    } finally {
      setPermissionsLoading(false);
    }
  }, [driverId]);

  // Fetch recent trips
  const fetchRecentTrips = useCallback(async (driverId) => {
    try {
      const tripsQuery = query(
        collection(db, 'trips'),
        where('userId', '==', driverId),
        orderBy('startTime', 'desc'),
        limit(3),
      );
      const querySnapshot = await getDocs(tripsQuery);
      const trips = [];
      querySnapshot.forEach(doc => {
        trips.push({id: doc.id, ...doc.data()});
      });
      setRecentTrips(trips);
    } catch (error) {
      console.error('Error fetching recent trips:', error);
      setRecentTrips([]);
    }
  }, []);

  // Fetch emergency logs
  const fetchEmergencyLogs = useCallback(async (driverId) => {
    try {
      const emergencyLogsQuery = query(
        collection(db, 'emergency_logs'),
        where('userId', '==', driverId),
        orderBy('timestamp', 'desc'),
        limit(5),
      );
      const querySnapshot = await getDocs(emergencyLogsQuery);
      const logs = [];
      querySnapshot.forEach(doc => {
        logs.push({id: doc.id, ...doc.data()});
      });
      setEmergencyLogs(logs);
      setEmergencyLogsLoading(false);
    } catch (error) {
      console.error('Error fetching emergency logs:', error);
      setEmergencyLogs([]);
      setEmergencyLogsLoading(false);
    }
  }, []);

  // Setup real-time listeners for driver data
  const setupRealTimeListeners = useCallback(async (currentPermissions) => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) {
        setLoading(false);
        return;
      }

      // Fetch user data
      const userRef = doc(db, 'users', user.uid);
      const userUnsubscribe = onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
          setUserData(docSnap.data());
        }
      });

      // Listen for driver updates
      const driverRef = doc(db, 'users', driverId);
      const driverUnsubscribe = onSnapshot(driverRef, (docSnap) => {
        if (docSnap.exists()) {
          setDriverInfo(docSnap.data());
        }
      });

      // Setup alerts listener if emergencyAlert permission is true
      let alertsUnsubscribe = null;
      if (currentPermissions.emergencyAlert) {
        const alertsRef = collection(db, 'alerts');
        const alertsQuery = query(
          alertsRef, 
          where('driverId', '==', driverId),
          orderBy('timestamp', 'desc'),
          limit(10)
        );

        // Get initial alerts
        getDocs(alertsQuery).then(querySnapshot => {
          const alertsData = [];
          querySnapshot.forEach((doc) => {
            alertsData.push({
              id: doc.id,
              ...doc.data(),
            });
          });
          setAlerts(alertsData);
          setAlertsLoading(false);
        });

        // Setup real-time alerts listener
        alertsUnsubscribe = onSnapshot(alertsQuery, (snapshot) => {
          const updatedAlerts = [];
          snapshot.forEach((doc) => {
            updatedAlerts.push({
              id: doc.id,
              ...doc.data(),
            });
          });
          setAlerts(updatedAlerts);
        });

        // Also fetch emergency logs
        fetchEmergencyLogs(driverId);
      } else {
        setAlerts([]);
        setAlertsLoading(false);
        setEmergencyLogs([]);
        setEmergencyLogsLoading(false);
      }

      // Setup current trip listener if shareLocation permission is true
      let tripsUnsubscribe = null;
      if (currentPermissions.shareLocation) {
        const tripsRef = collection(db, 'trips');
        const tripsQueryRef = query(
          tripsRef,
          where('userId', '==', driverId),
          where('status', 'in', ['active', 'started', 'ongoing']),
          orderBy('startTime', 'desc'),
          limit(1),
        );

        tripsUnsubscribe = onSnapshot(tripsQueryRef, (snapshot) => {
          if (!snapshot.empty) {
            const latestTripDoc = snapshot.docs[0];
            const latestTrip = latestTripDoc.data();
            const tripId = latestTripDoc.id;

            const tripLoc = latestTrip.currentLocation || latestTrip.startLocation || {latitude: 24.8607, longitude: 67.0011};

            setCurrentTrip({
              id: tripId,
              ...latestTrip,
              currentLocation: tripLoc,
              startLocation: latestTrip.startLocation || tripLoc,
              distance: latestTrip.distance || 0,
              duration: latestTrip.duration || 0,
              avgSpeed: latestTrip.avgSpeed || 0,
              maxSpeed: latestTrip.maxSpeed || 0,
            });

            const newLocation = {latitude: tripLoc.latitude, longitude: tripLoc.longitude};
            setLocation(newLocation);
            
            // Update path (keep last 50 points)
            setPath(prev => {
              const newPath = [...prev, newLocation];
              return newPath.length > 50 ? newPath.slice(-50) : newPath;
            });

            // Update map with new location if map is ready
            if (mapReady) {
              updateMapLocation(newLocation);
            }

            // Setup real-time trip updates
            const tripDocRef = doc(db, 'trips', tripId);
            const tripUnsubscribe = onSnapshot(tripDocRef, (tripSnap) => {
              if (tripSnap.exists()) {
                const data = tripSnap.data();
                if (data.currentLocation) {
                  const newLoc = {
                    latitude: data.currentLocation.latitude,
                    longitude: data.currentLocation.longitude,
                  };

                  setLocation(newLoc);
                  
                  // Update path
                  setPath(prev => {
                    const newPath = [...prev, newLoc];
                    return newPath.length > 50 ? newPath.slice(-50) : newPath;
                  });
                  
                  // Update map with new location
                  if (mapReady) {
                    updateMapLocation(newLoc);
                  }
                }

                setCurrentTrip(prev => ({
                  ...prev,
                  ...data,
                  currentLocation: data.currentLocation || prev?.currentLocation,
                  distance: data.distance || prev?.distance || 0,
                  duration: data.duration || prev?.duration || 0,
                  avgSpeed: data.avgSpeed || prev?.avgSpeed || 0,
                  maxSpeed: data.maxSpeed || prev?.maxSpeed || 0,
                }));
              }
            });

            return () => tripUnsubscribe();
          } else {
            setCurrentTrip(null);
            setLocation(null);
            setPath([]);
          }
        });
      } else {
        setCurrentTrip(null);
        setLocation(null);
        setPath([]);
      }

      // Fetch recent trips if shareTripHistory permission is true
      if (currentPermissions.shareTripHistory) {
        await fetchRecentTrips(driverId);
      } else {
        setRecentTrips([]);
      }

      setLoading(false);

      // Return cleanup function
      return () => {
        userUnsubscribe();
        driverUnsubscribe();
        if (alertsUnsubscribe) alertsUnsubscribe();
        if (tripsUnsubscribe) tripsUnsubscribe();
      };

    } catch (error) {
      console.error('Error setting up real-time listeners:', error);
      setLoading(false);
    }
  }, [driverId, fetchRecentTrips, fetchEmergencyLogs, mapReady, updateMapLocation]);

  // Setup auth state listener
  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchPermissions();
      } else {
        navigation.goBack();
      }
    });

    return () => unsubscribeAuth();
  }, [fetchPermissions, navigation]);

  // Setup listeners when permissions are loaded
  useEffect(() => {
    let cleanupFunction = null;

    if (!permissionsLoading && permissions) {
      const setup = async () => {
        cleanupFunction = await setupRealTimeListeners(permissions);
      };
      setup();
    }

    return () => {
      if (cleanupFunction) cleanupFunction();
      // Clear interval on unmount
      if (locationUpdateInterval.current) {
        clearInterval(locationUpdateInterval.current);
      }
    };
  }, [permissionsLoading, permissions, setupRealTimeListeners]);

  // Get driver display info
  const getDriverDisplayInfo = useCallback(() => {
    if (!driverInfo) return { name: 'Loading...', status: 'Unknown' };
    
    const name = driverInfo.fullName || driverInfo.name || driverInfo.email?.split('@')[0] || 'Driver';
    const status = currentTrip && permissions.shareLocation ? 'Driving Now' : 'Not Active';
    
    return { name, status };
  }, [driverInfo, currentTrip, permissions]);

  const driverDisplay = getDriverDisplayInfo();
  const profileImage = getProfileImage();
  const userName = getUserName();

  // Permission denied component
  const PermissionDenied = useCallback(({ type }) => {
    const messages = {
      location: 'Location Sharing Not Allowed',
      tripHistory: 'Trip History Not Shared',
      alerts: 'Alerts Not Shared'
    };
    
    return (
      <View style={styles.permissionDenied}>
        <Ionicons name="lock-closed" size={48} color="#ccc" />
        <Text style={styles.permissionDeniedText}>
          {messages[type]}
        </Text>
        <Text style={styles.permissionDeniedSubText}>
          Driver has not granted permission to view this information
        </Text>
      </View>
    );
  }, []);

  // Render alert item
  const renderAlertItem = useCallback((alert, index) => {
    return (
      <View key={alert.id} style={[styles.alertCard, index === 0 && styles.firstAlertCard]}>
        <View style={[styles.alertIcon, { backgroundColor: getAlertColor(alert.type) }]}>
          <Ionicons name={getAlertIcon(alert.type)} size={20} color="#fff" />
        </View>
        <View style={styles.alertContent}>
          <Text style={styles.alertTitle}>
            {getAlertTitle(alert.type)}
          </Text>
          <Text style={styles.alertMessage}>
            {alert.message || `${driverInfo?.fullName || 'Driver'} triggered a ${alert.type} alert`}
          </Text>
          {alert.address && (
            <Text style={styles.alertLocation} numberOfLines={1}>
              📍 {alert.address}
            </Text>
          )}
          <View style={styles.alertDetails}>
            {alert.speed && (
              <Text style={styles.alertDetail}>
                Speed: {alert.speed} km/h
              </Text>
            )}
            {alert.gForce && (
              <Text style={styles.alertDetail}>
                G-Force: {alert.gForce}
              </Text>
            )}
          </View>
          <Text style={styles.alertTime}>
            {formatAlertTime(alert.timestamp)}
          </Text>
          {alert.userResponse === 'safe' && (
            <View style={styles.alertResolved}>
              <Ionicons name="checkmark-circle" size={14} color="#28a745" />
              <Text style={styles.alertResolvedText}>Resolved by driver</Text>
            </View>
          )}
        </View>
        {alert.severity === 'HIGH' && (
          <View style={styles.alertBadge}>
            <Ionicons name="flash" size={12} color="#fff" />
          </View>
        )}
      </View>
    );
  }, [getAlertColor, getAlertIcon, getAlertTitle, formatAlertTime, driverInfo]);

  // Render emergency log item
  const renderEmergencyLogItem = useCallback((log, index) => {
    return (
      <View key={log.id} style={[styles.emergencyLogCard, index === 0 && styles.firstEmergencyLogCard]}>
        <View style={[styles.emergencyLogIcon, { backgroundColor: '#e63946' }]}>
          <Ionicons name="alert-circle" size={20} color="#fff" />
        </View>
        <View style={styles.emergencyLogContent}>
          <Text style={styles.emergencyLogTitle}>
            {log.type?.replace('_', ' ') || 'Emergency Log'}
          </Text>
          <Text style={styles.emergencyLogMessage}>
            {log.message || 'Emergency event logged'}
          </Text>
          <View style={styles.emergencyLogDetails}>
            <Text style={styles.emergencyLogDetail}>
              Severity: {log.severity || 'N/A'}
            </Text>
            {log.speed && (
              <Text style={styles.emergencyLogDetail}>
                Speed: {log.speed} km/h
              </Text>
            )}
          </View>
          <Text style={styles.emergencyLogTime}>
            {formatAlertTime(log.timestamp)}
          </Text>
          <Text style={styles.emergencyLogResponse}>
            Response: {log.userResponse === 'safe' ? '✅ Driver safe' : '⏳ No response'}
          </Text>
        </View>
      </View>
    );
  }, [formatAlertTime]);

  // Render stat card
  const renderStatCard = useCallback((icon, value, label, bgColor, iconColor) => (
    <View key={label} style={[styles.statCard, { backgroundColor: bgColor }]}>
      <Ionicons name={icon} size={24} color={iconColor} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  ), []);

  // Render recent trip item
  const renderRecentTrip = useCallback((trip, index) => (
    <View key={trip.id || index} style={[styles.fullBox, styles.recentTripBox]}>
      <View style={styles.textPart}>
        <Text style={[styles.boxTitle, { marginBottom: 8 }]}>
          Trip {recentTrips.length - index} - {formatDate(trip.startTime)}
        </Text>
        <View style={styles.tripDetails}>
          <View style={styles.tripDetailRow}>
            <Ionicons name="calendar" size={14} color="#1d807c" />
            <Text style={styles.recentTripText}>
              {formatDate(trip.startTime)} at {formatTimeOnly(trip.startTime)}
            </Text>
          </View>
          {trip.duration !== undefined && (
            <View style={styles.tripDetailRow}>
              <Ionicons name="time" size={14} color="#1d807c" />
              <Text style={styles.recentTripText}>Duration: {formatTime(trip.duration)}</Text>
            </View>
          )}
          {trip.distance !== undefined && (
            <View style={styles.tripDetailRow}>
              <Ionicons name="map" size={14} color="#1d807c" />
              <Text style={styles.recentTripText}>
                Distance: {trip.distance ? `${trip.distance.toFixed(2)} km` : 'N/A'}
              </Text>
            </View>
          )}
          {trip.avgSpeed !== undefined && (
            <View style={styles.tripDetailRow}>
              <Ionicons name="speedometer" size={14} color="#1d807c" />
              <Text style={styles.recentTripText}>
                Avg Speed: {trip.avgSpeed ? `${trip.avgSpeed.toFixed(1)} km/h` : 'N/A'}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="map" size={26} color="#1d807c" />
    </View>
  ), [recentTrips.length, formatDate, formatTimeOnly, formatTime]);

  if (loading || permissionsLoading) {
    return (
      <View style={styles.mainContainer}>
        <View style={styles.headerWrapper}>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Driver Details</Text>
              <Text style={styles.subTitle}>{driverDisplay.name}</Text>
            </View>
            <View style={styles.profileWrapper}>
              <View style={styles.profileImagePlaceholder}>
                <Ionicons name="person" size={20} color="#fff" />
              </View>
            </View>
          </View>
          <View style={styles.curve} />
        </View>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#d63384" />
          <Text style={styles.loadingText}>Loading driver details...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* HEADER */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerContent}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            style={styles.backButton}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{driverDisplay.name}</Text>
            <Text style={styles.subTitle}>Driver Details</Text>
          </View>
          <View style={styles.profileWrapper}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.profileImage} />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Ionicons name="person" size={20} color="#fff" />
              </View>
            )}
          </View>
        </View>
        <View style={styles.curve} />
      </View>

      {/* CONTENT */}
      <ScrollView 
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Driver Header */}
        <View style={styles.driverHeader}>
          {driverInfo?.profileImage ? (
            <Image source={{ uri: driverInfo.profileImage }} style={styles.driverAvatar} />
          ) : (
            <View style={styles.driverAvatarPlaceholder}>
              <Ionicons name="person" size={32} color="#d63384" />
            </View>
          )}
          <Text style={styles.driverName}>
            {driverDisplay.name}
          </Text>
          <View style={styles.statusContainer}>
            <View style={[
              styles.statusDot,
              currentTrip && permissions.shareLocation ? styles.statusActive : styles.statusInactive
            ]} />
            <Text style={[
              styles.statusText,
              currentTrip && permissions.shareLocation ? styles.statusActiveText : styles.statusInactiveText
            ]}>
              {driverDisplay.status}
            </Text>
          </View>
        </View>

        {/* Alerts Section */}
        {permissions.emergencyAlert ? (
          <>
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Recent Alerts</Text>
              {alertsLoading ? (
                <ActivityIndicator size="small" color="#d63384" style={styles.alertsLoader} />
              ) : alerts.length > 0 ? (
                alerts.map(renderAlertItem)
              ) : (
                <View style={styles.emptyAlerts}>
                  <Ionicons name="notifications-off" size={32} color="#ccc" />
                  <Text style={styles.emptyAlertsText}>No recent alerts</Text>
                </View>
              )}
            </View>

            {/* Emergency Logs Section */}
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Emergency Logs</Text>
              {emergencyLogsLoading ? (
                <ActivityIndicator size="small" color="#d63384" style={styles.alertsLoader} />
              ) : emergencyLogs.length > 0 ? (
                emergencyLogs.map(renderEmergencyLogItem)
              ) : (
                <View style={styles.emptyAlerts}>
                  <Ionicons name="document-text" size={32} color="#ccc" />
                  <Text style={styles.emptyAlertsText}>No emergency logs</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <PermissionDenied type="alerts" />
        )}

        {/* Current Trip & Location */}
        {permissions.shareLocation ? (
          currentTrip ? (
            <>
              {location ? (
                <View style={styles.mapContainer}>
                  <WebView
                    ref={webViewRef}
                    source={{ html: getMapHTML() }}
                    style={styles.map}
                    javaScriptEnabled={true}
                    domStorageEnabled={true}
                    onMessage={handleWebViewMessage}
                    startInLoadingState={true}
                    renderLoading={() => (
                      <View style={styles.mapPlaceholder}>
                        <ActivityIndicator size="large" color="#d63384" />
                        <Text style={styles.mapPlaceholderText}>Loading map...</Text>
                      </View>
                    )}
                    onLoad={() => {
                      if (location && webViewRef.current) {
                        setTimeout(() => {
                          updateMapLocation(location);
                        }, 500);
                      }
                    }}
                  />
                  <View style={styles.mapOverlay}>
                    <Text style={styles.mapOverlayText}>
                      Live Location • {formatTimeOnly(new Date())}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.mapPlaceholder}>
                  <ActivityIndicator size="large" color="#d63384" />
                  <Text style={styles.mapPlaceholderText}>Getting location...</Text>
                </View>
              )}

              {/* Stats Grid */}
              <View style={styles.statsGrid}>
                {renderStatCard(
                  'speedometer',
                  currentTrip?.currentSpeed ? `${currentTrip.currentSpeed.toFixed(1)} km/h` : '0 km/h',
                  'Current Speed',
                  '#e3f2fd',
                  '#1976d2'
                )}
                {renderStatCard(
                  'time',
                  currentTrip?.duration ? formatTime(currentTrip.duration) : '0h 0m',
                  'Duration',
                  '#f1f8e9',
                  '#388e3c'
                )}
                {renderStatCard(
                  'analytics',
                  currentTrip?.avgSpeed ? `${currentTrip.avgSpeed.toFixed(1)} km/h` : '0 km/h',
                  'Avg Speed',
                  '#ffecb3',
                  '#f57c00'
                )}
                {renderStatCard(
                  'walk',
                  currentTrip?.distance ? `${currentTrip.distance.toFixed(2)} km` : '0 km',
                  'Distance',
                  '#e8f5e9',
                  '#4caf50'
                )}
              </View>
            </>
          ) : (
            <View style={styles.noTripContainer}>
              <Ionicons name="car-outline" size={48} color="#ccc" />
              <Text style={styles.noTripText}>Driver is not currently on a trip</Text>
              <Text style={styles.noTripSubText}>Status: Not Active</Text>
            </View>
          )
        ) : (
          <PermissionDenied type="location" />
        )}

        {/* Recent Trips */}
        {permissions.shareTripHistory && recentTrips.length > 0 && (
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Recent Trips</Text>
            {recentTrips.map(renderRecentTrip)}
          </View>
        )}

        {!permissions.shareTripHistory && recentTrips.length === 0 && (
          <PermissionDenied type="tripHistory" />
        )}
      </ScrollView>

      {/* Footer Navigation */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity 
            onPress={() => navigation.navigate("FamilyDashboard")}
            style={styles.footerButton}
          >
            <Ionicons name="home" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => navigation.navigate("DriverTracking")}
            style={styles.footerButton}
          >
            <Ionicons name="map" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => navigation.navigate("FamilySettings")}
            style={styles.footerButton}
          >
            <Ionicons name="settings" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const { width } = Dimensions.get('window');
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
    alignItems: 'center' 
  },
  backButton: { 
    padding: 8 
  },
  headerCenter: { 
    alignItems: 'center', 
    flex: 1,
    marginHorizontal: 8,
  },
  curve: { 
    width: width, 
    height: 30, 
    backgroundColor: '#fff', 
    borderTopLeftRadius: 80, 
    borderTopRightRadius: 80, 
    marginTop: -10 
  },
  headerTitle: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#fff',
    textAlign: 'center',
  },
  subTitle: { 
    fontSize: 14, 
    color: '#fff', 
    marginTop: 2, 
    opacity: 0.9,
    textAlign: 'center',
  },
  profileWrapper: { 
    flexDirection: 'row-reverse', 
    alignItems: 'center',
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
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { 
    padding: 16, 
    paddingBottom: 100 
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#d63384',
  },
  alertsLoader: { 
    marginVertical: 20 
  },
  driverHeader: { 
    alignItems: 'center', 
    marginBottom: 24,
    paddingVertical: 16,
  },
  driverAvatar: { 
    width: 80, 
    height: 80, 
    borderRadius: 40, 
    marginBottom: 12,
    borderWidth: 3,
    borderColor: '#d63384'
  },
  driverAvatarPlaceholder: { 
    width: 80, 
    height: 80, 
    borderRadius: 40, 
    backgroundColor: '#e0f7f5', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 12,
    borderWidth: 3,
    borderColor: '#d63384'
  },
  driverName: { 
    fontSize: 22, 
    fontWeight: 'bold', 
    color: '#333', 
    marginBottom: 8,
    textAlign: 'center'
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusActive: {
    backgroundColor: '#28a745',
  },
  statusInactive: {
    backgroundColor: '#6c757d',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
  },
  statusActiveText: {
    color: '#28a745',
  },
  statusInactiveText: {
    color: '#6c757d',
  },
  
  // Section Styles
  sectionContainer: { 
    marginBottom: 24 
  },
  sectionTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: '#333', 
    marginBottom: 12, 
    marginLeft: 4 
  },
  
  // Alert Styles
  alertCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#ff6b6b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  firstAlertCard: {
    borderLeftColor: '#d63384',
  },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  alertMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
    lineHeight: 18,
  },
  alertLocation: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  alertDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  alertDetail: {
    fontSize: 12,
    color: '#666',
    marginRight: 12,
    marginBottom: 2,
  },
  alertTime: {
    fontSize: 12,
    color: '#999',
  },
  alertResolved: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  alertResolvedText: {
    fontSize: 12,
    color: '#28a745',
    marginLeft: 4,
  },
  alertBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#ff6b6b',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Emergency Log Styles
  emergencyLogCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#e63946',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  firstEmergencyLogCard: {
    borderLeftColor: '#dc3545',
  },
  emergencyLogIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  emergencyLogContent: {
    flex: 1,
  },
  emergencyLogTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  emergencyLogMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
    lineHeight: 18,
  },
  emergencyLogDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  emergencyLogDetail: {
    fontSize: 12,
    color: '#666',
    marginRight: 12,
    marginBottom: 2,
  },
  emergencyLogTime: {
    fontSize: 12,
    color: '#999',
  },
  emergencyLogResponse: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    fontStyle: 'italic',
  },
  
  emptyAlerts: {
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 16,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
  },
  emptyAlertsText: {
    fontSize: 16,
    color: '#6c757d',
    marginTop: 12,
    textAlign: 'center',
  },
  
  // Map Styles
  mapContainer: { 
    height: 200, 
    borderRadius: 16, 
    overflow: 'hidden', 
    marginBottom: 24,
    position: 'relative'
  },
  map: { 
    width: '100%', 
    height: '100%',
    backgroundColor: '#f5f5f5'
  },
  mapOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  mapOverlayText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  mapPlaceholder: {
    height: 200,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  mapPlaceholderText: {
    marginTop: 10,
    color: '#666',
    fontSize: 14,
  },
  
  // Stats Grid
  statsGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    justifyContent: 'space-between', 
    marginBottom: 24 
  },
  statCard: { 
    width: '48%', 
    padding: 16, 
    borderRadius: 16, 
    alignItems: 'center', 
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  statValue: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: '#333', 
    marginVertical: 6,
    textAlign: 'center',
  },
  statLabel: { 
    fontSize: 12, 
    color: '#666', 
    textAlign: 'center' 
  },
  
  // Trip Styles
  fullBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  recentTripBox: { 
    backgroundColor: '#fff', 
    borderLeftWidth: 4, 
    borderLeftColor: '#d63384' 
  },
  textPart: { 
    flex: 1, 
  },
  boxTitle: { 
    fontSize: 16, 
    color: '#333', 
    fontWeight: '600', 
    marginBottom: 8 
  },
  tripDetails: { 
    marginTop: 4 
  },
  tripDetailRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 4 
  },
  recentTripText: { 
    marginLeft: 4, 
    fontSize: 12, 
    color: '#333' 
  },
  
  // No Trip Container
  noTripContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 32,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
  },
  noTripText: {
    fontSize: 16,
    color: '#6c757d',
    marginTop: 12,
    textAlign: 'center',
  },
  noTripSubText: {
    fontSize: 14,
    color: '#adb5bd',
    marginTop: 8,
    textAlign: 'center',
  },
  
  // Permission Denied
  permissionDenied: {
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 32,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
  },
  permissionDeniedText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6c757d',
    marginTop: 12,
    textAlign: 'center',
  },
  permissionDeniedSubText: {
    fontSize: 14,
    color: '#adb5bd',
    marginTop: 8,
    textAlign: 'center',
  },
  
  // Footer
  footerWrapper: {
    position: 'absolute',
    bottom: 16,
    width: '100%',
    alignItems: 'center',
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

export default DriverDetailsScreen;