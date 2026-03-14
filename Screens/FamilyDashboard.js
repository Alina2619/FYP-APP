import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import { collection, query, where, getDocs, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const FamilyDashboardScreen = ({ navigation }) => {
  const [userData, setUserData] = useState(null);
  const [linkedProfiles, setLinkedProfiles] = useState(0);
  const [activeDriversCount, setActiveDriversCount] = useState(0);
  const [onlineDriversCount, setOnlineDriversCount] = useState(0);
  const [driversWithActiveTrips, setDriversWithActiveTrips] = useState([]);
  const [onlineDrivers, setOnlineDrivers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Use refs to avoid stale state in listeners
  const driversWithActiveTripsRef = useRef([]);
  const onlineDriversRef = useRef([]);
  const driverDetailsMap = useRef(new Map()); // Cache driver details

  // Active trip statuses
  const ACTIVE_TRIP_STATUSES = ['active', 'started', 'ongoing', 'in-progress', 'accepted', 'picked_up'];

  // Function to get user name with fallbacks
  const getUserName = useCallback(() => {
    if (!userData) return 'Family Admin';
    return (
      userData.fullName ||
      userData.name ||
      userData.displayName ||
      `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
      userData.email?.split('@')[0] ||
      'Family Admin'
    );
  }, [userData]);

  // Function to get profile image with fallbacks
  const getProfileImage = useCallback(() => {
    if (!userData) return null;
    return (
      userData.profileImage ||
      userData.photoURL ||
      userData.avatar ||
      userData.imageUrl ||
      null
    );
  }, [userData]);

  // Function to get driver details with status
  const getDriverWithStatus = useCallback(async (driver) => {
    try {
      const driverId = driver.driverId || driver.userId;
      if (!driverId) return { ...driver, hasActiveTrip: false, isOnline: false, name: 'Driver' };

      // Check cache first
      if (driverDetailsMap.current.has(driverId)) {
        return driverDetailsMap.current.get(driverId);
      }

      const driverRef = doc(db, "users", driverId);
      const driverSnap = await getDoc(driverRef);

      if (driverSnap.exists()) {
        const driverData = driverSnap.data();
        
        // Check driver's online status - MULTIPLE CONDITIONS
        const isOnline = driverData.status === 'online' || 
                        driverData.isOnline === true ||
                        (driverData.lastSeen && 
                         driverData.lastSeen.toDate && 
                         (Date.now() - driverData.lastSeen.toDate().getTime()) < 10 * 60 * 1000); // 10 minutes
        
        // Get driver name
        const driverName = driverData.name || 
                          driverData.fullName || 
                          driverData.displayName || 
                          driver.email || 
                          driver.name ||
                          `Driver (${driverId.substring(0, 6)})`;
        
        const driverInfo = { 
          ...driver, 
          ...driverData,
          driverId: driverId,
          hasActiveTrip: false, // Will be updated by trips listener
          isOnline,
          name: driverName
        };
        
        // Cache the result
        driverDetailsMap.current.set(driverId, driverInfo);
        return driverInfo;
      }
      
      const defaultInfo = { 
        ...driver, 
        driverId,
        hasActiveTrip: false, 
        isOnline: false, 
        name: driver.name || `Driver ${driverId.substring(0, 6)}` 
      };
      driverDetailsMap.current.set(driverId, defaultInfo);
      return defaultInfo;
    } catch (err) {
      console.error('Error getting driver status:', err);
      const driverId = driver.driverId || driver.userId;
      return { 
        ...driver, 
        driverId,
        hasActiveTrip: false, 
        isOnline: false, 
        name: driver.name || (driverId ? `Driver ${driverId.substring(0, 6)}` : 'Driver') 
      };
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserData(null);
        setLinkedProfiles(0);
        setActiveDriversCount(0);
        setOnlineDriversCount(0);
        setDriversWithActiveTrips([]);
        setOnlineDrivers([]);
        setLoading(false);
        return;
      }

      try {
        // Fetch user data from the users collection
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData(data);

          // Get linked drivers array from the current user document
          const linkedDrivers = data.linkedDrivers || [];
          
          // Total linked profiles
          setLinkedProfiles(linkedDrivers.length);

          if (linkedDrivers.length === 0) {
            setLoading(false);
            return;
          }

          // Get driver details with status
          const driverPromises = linkedDrivers.map(driver => getDriverWithStatus(driver));
          const driversWithStatus = await Promise.all(driverPromises);
          
          // Separate drivers with active trips and online drivers
          // Note: hasActiveTrip will be false initially, will be updated by trips listener
          const onlineDriversList = driversWithStatus.filter(driver => driver.isOnline);
          
          // Update refs
          onlineDriversRef.current = onlineDriversList;
          
          setOnlineDriversCount(onlineDriversList.length);
          setOnlineDrivers(onlineDriversList);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, [getDriverWithStatus]);

  // Set up real-time listener for active trips
  useEffect(() => {
    if (!userData || !userData.linkedDrivers) return;

    const linkedDrivers = userData.linkedDrivers;
    const driverIds = linkedDrivers.map(driver => driver.driverId || driver.userId).filter(id => id);
    
    if (driverIds.length === 0) return;

    console.log('Setting up active trips listener for drivers:', driverIds);

    // Listen to ALL active trips
    const activeTripsQuery = query(
      collection(db, 'trips'),
      where('status', 'in', ACTIVE_TRIP_STATUSES)
    );

    const unsubscribeActiveTrips = onSnapshot(activeTripsQuery, (snapshot) => {
      // Create a map of driverId -> hasActiveTrip
      const activeTripsByDriver = {};
      
      snapshot.forEach(doc => {
        const tripData = doc.data();
        // Check both driverId and userId fields
        const driverId = tripData.driverId || tripData.userId;
        if (driverId && driverIds.includes(driverId)) {
          activeTripsByDriver[driverId] = {
            tripId: doc.id,
            startTime: tripData.startTime,
            currentLocation: tripData.currentLocation
          };
        }
      });

      console.log('Active trips found:', Object.keys(activeTripsByDriver).length);

      // Update drivers with active trips
      const activeDrivers = [];
      
      linkedDrivers.forEach(driver => {
        const driverId = driver.driverId || driver.userId;
        const hasActiveTrip = !!activeTripsByDriver[driverId];
        
        if (hasActiveTrip) {
          // Find driver info from onlineDrivers or create basic info
          const existingDriver = onlineDriversRef.current.find(d => d.driverId === driverId);
          const driverInfo = {
            driverId,
            name: existingDriver?.name || driver.name || `Driver ${driverId.substring(0, 6)}`,
            hasActiveTrip: true,
            isOnline: existingDriver?.isOnline || false,
            tripInfo: activeTripsByDriver[driverId]
          };
          activeDrivers.push(driverInfo);
        }
      });

      // Update online drivers with new trip status
      const updatedOnlineDrivers = onlineDriversRef.current.map(driver => ({
        ...driver,
        hasActiveTrip: !!activeTripsByDriver[driver.driverId]
      }));

      // Update refs
      driversWithActiveTripsRef.current = activeDrivers;
      onlineDriversRef.current = updatedOnlineDrivers;

      setDriversWithActiveTrips(activeDrivers);
      setOnlineDrivers(updatedOnlineDrivers);
      setActiveDriversCount(activeDrivers.length);
      
    }, (error) => {
      console.error('Error in active trips listener:', error);
    });

    return () => unsubscribeActiveTrips();
  }, [userData]);

  // Set up real-time listener for driver online status
  useEffect(() => {
    if (!userData || !userData.linkedDrivers) return;

    const linkedDrivers = userData.linkedDrivers;
    const driverIds = linkedDrivers.map(driver => driver.driverId || driver.userId).filter(id => id);
    
    if (driverIds.length === 0) return;

    console.log('Setting up online status listeners for drivers:', driverIds);

    const unsubscribeListeners = [];

    // Set up real-time listeners for each driver's online status
    driverIds.forEach(driverId => {
      const driverRef = doc(db, 'users', driverId);
      
      const unsubscribeDriver = onSnapshot(driverRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
          const driverData = docSnapshot.data();
          
          // Get driver name from cache or create
          const existingInfo = driverDetailsMap.current.get(driverId) || {};
          const driverName = driverData.name || 
                            driverData.fullName || 
                            driverData.displayName || 
                            existingInfo.name ||
                            `Driver ${driverId.substring(0, 6)}`;
          
          // Check online status - MULTIPLE CONDITIONS
          const isOnline = driverData.status === 'online' || 
                          driverData.isOnline === true ||
                          (driverData.lastSeen && 
                           driverData.lastSeen.toDate && 
                           (Date.now() - driverData.lastSeen.toDate().getTime()) < 10 * 60 * 1000);
          
          // Check if driver has active trip from current ref
          const hasActiveTrip = driversWithActiveTripsRef.current.some(d => d.driverId === driverId);
          
          // Update cache
          driverDetailsMap.current.set(driverId, {
            driverId,
            name: driverName,
            isOnline,
            hasActiveTrip
          });
          
          // Update online drivers list
          const currentOnlineDrivers = [...onlineDriversRef.current];
          const driverIndex = currentOnlineDrivers.findIndex(d => d.driverId === driverId);
          
          if (isOnline) {
            const driverInfo = {
              driverId,
              name: driverName,
              hasActiveTrip,
              isOnline: true
            };
            
            if (driverIndex === -1) {
              // Add new online driver
              currentOnlineDrivers.push(driverInfo);
            } else {
              // Update existing driver
              currentOnlineDrivers[driverIndex] = {
                ...currentOnlineDrivers[driverIndex],
                name: driverName,
                hasActiveTrip,
                isOnline: true
              };
            }
          } else {
            // Remove if not online
            if (driverIndex !== -1) {
              currentOnlineDrivers.splice(driverIndex, 1);
            }
          }
          
          // Update active drivers to reflect online status
          const updatedActiveDrivers = driversWithActiveTripsRef.current.map(driver => {
            if (driver.driverId === driverId) {
              return { ...driver, isOnline };
            }
            return driver;
          });
          
          // Update refs
          onlineDriversRef.current = currentOnlineDrivers;
          driversWithActiveTripsRef.current = updatedActiveDrivers;
          
          // Update states
          setOnlineDrivers(currentOnlineDrivers);
          setOnlineDriversCount(currentOnlineDrivers.length);
          setDriversWithActiveTrips(updatedActiveDrivers);
          
          console.log(`Driver ${driverId} online status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
        }
      }, (error) => {
        console.error(`Error listening to driver ${driverId}:`, error);
      });

      unsubscribeListeners.push(unsubscribeDriver);
    });

    // Cleanup real-time listeners
    return () => {
      unsubscribeListeners.forEach(unsubscribe => {
        if (unsubscribe) unsubscribe();
      });
    };
  }, [userData]);

  // Function to get active drivers text for display
  const getActiveDriversText = () => {
    const activeDrivers = driversWithActiveTrips;
    const count = activeDrivers.length;
    
    if (count === 0) {
      return 'No active trips';
    } else if (count === 1) {
      const driverName = activeDrivers[0].name || 'Driver';
      return `${driverName} on trip`;
    } else if (count === 2) {
      const driver1 = activeDrivers[0].name || 'Driver';
      const driver2 = activeDrivers[1].name || 'Driver';
      return `${driver1}, ${driver2} on trip`;
    } else {
      const firstTwo = activeDrivers.slice(0, 2).map(d => d.name || 'Driver').join(', ');
      return `${firstTwo} +${count - 2} on trip`;
    }
  };

  // Function to get online drivers text for display
  const getOnlineDriversText = () => {
    const onlineList = onlineDrivers;
    const count = onlineList.length;
    
    if (count === 0) {
      return 'No drivers online';
    } else if (count === 1) {
      const driver = onlineList[0];
      const driverName = driver?.name || 'Driver';
      return `${driverName} is online`;
    } else if (count === 2) {
      const driver1 = onlineList[0]?.name || 'Driver';
      const driver2 = onlineList[1]?.name || 'Driver';
      return `${driver1}, ${driver2} online`;
    } else {
      const firstTwo = onlineList.slice(0, 2).map(d => d.name || 'Driver').join(', ');
      return `${firstTwo} +${count - 2} more online`;
    }
  };

  const userName = getUserName();
  const profileImage = getProfileImage();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#d63384" />
        <Text style={styles.loadingText}>Loading Family Dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* Header Section */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Family Dashboard</Text>
          </View>

          {/* Profile Section */}
          <View style={styles.profileWrapper}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.profileImage} />
            ) : (
              <View style={styles.profileImagePlaceholder}>
                <Ionicons name="person" size={20} color="#d63384" />
              </View>
            )}
            <Text style={styles.profileName} numberOfLines={1}>
              {userName}
            </Text>
          </View>
        </View>
        <View style={styles.curve} />
      </View>
   
      {/* Dashboard Content */}
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats Row */}
        <View style={styles.row}>
          <View style={[styles.box, styles.linkedBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Linked Profiles</Text>
              <Text style={styles.boxValue}>{linkedProfiles}</Text>
              <Text style={styles.boxSubtext}>Total drivers linked</Text>
            </View>
            <Ionicons name="people" size={32} color="#d63384" />
          </View>

          <View style={[styles.box, styles.activeBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Active Drive Mode</Text>
              <Text style={styles.boxValue}>{activeDriversCount}</Text>
              <Text style={[styles.boxSubtext, styles.activeDriverText]} numberOfLines={2}>
                {getActiveDriversText()}
              </Text>
            </View>
            <View style={styles.activeIconContainer}>
              {activeDriversCount > 0 ? (
                <Ionicons name="car-sport" size={32} color="#FF6B35" />
              ) : (
                <Ionicons name="car-sport-outline" size={32} color="#888" />
              )}
            </View>
          </View>
        </View>

        {/* Online Status Box */}
        <View style={styles.row}>
          <View style={[styles.box, styles.onlineBox]}>
            <View style={styles.textPart}>
              <Text style={styles.boxTitle}>Online Status</Text>
              <Text style={[styles.boxValue, styles.onlineValue]}>{onlineDriversCount}</Text>
              <Text style={[styles.boxSubtext, styles.onlineDriverText]} numberOfLines={2}>
                {getOnlineDriversText()}
              </Text>
            </View>
            <View style={styles.onlineIconContainer}>
              {onlineDriversCount > 0 ? (
                <Ionicons name="wifi" size={32} color="#4CAF50" />
              ) : (
                <Ionicons name="wifi-off" size={32} color="#FF6B6B" />
              )}
            </View>
          </View>
        </View>

        {/* Feature Boxes */}
        <View style={styles.featuresContainer}>
          <TouchableOpacity
            style={[styles.featureBox, styles.trackingBox]}
            onPress={() => navigation.navigate('DriverTracking')} 
            activeOpacity={0.8}
          >
            <View style={styles.featureContent}>
              <View style={styles.textPart}>
                <Text style={styles.featureTitle}>Driver Tracking</Text>
                <Text style={styles.featureDescription}>
                  Real-time location tracking {onlineDriversCount > 0 ? `(${onlineDriversCount} online)` : ''}
                </Text>
              </View>
              <Ionicons name="map" size={32} color="#d63384" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.featureBox, styles.geofenceBox]}
            onPress={() => navigation.navigate('GeoFence')}
            activeOpacity={0.8}
          >
            <View style={styles.featureContent}>
              <View style={styles.textPart}>
                <Text style={styles.featureTitle}>Geo-Fence & Route</Text>
                <Text style={styles.featureDescription}>Set safe zones and routes</Text>
              </View>
              <Ionicons name="navigate" size={32} color="#d63384" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.featureBox, styles.alertsBox]}
            onPress={() => navigation.navigate('FamilyAlerts')}
            activeOpacity={0.8}
          >
            <View style={styles.featureContent}>
              <View style={styles.textPart}>
                <Text style={styles.featureTitle}>Alerts</Text>
                <Text style={styles.featureDescription}>View notifications for alerts</Text>
              </View>
              <Ionicons name="alert-circle" size={32} color="#d63384" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.featureBox, styles.linkageBox]}
            onPress={() => navigation.navigate('ProfileLinkageScreen')}
            activeOpacity={0.8}
          >
            <View style={styles.featureContent}>
              <View style={styles.textPart}>
                <Text style={styles.featureTitle}>Profile Linkage</Text>
                <Text style={styles.featureDescription}>Add or remove driver links</Text>
              </View>
              <Ionicons name="link" size={32} color="#d63384" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Drivers with Active Trips Section */}
        {driversWithActiveTrips.length > 0 && (
          <View style={styles.activeDriversSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="car-sport" size={20} color="#FF6B35" />
              <Text style={styles.sectionTitle}>Active Trips</Text>
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>{driversWithActiveTrips.length}</Text>
              </View>
            </View>
            
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.driversScroll}
            >
              {driversWithActiveTrips.map((driver) => (
                <View key={driver.driverId} style={styles.driverCard}>
                  <View style={styles.driverAvatar}>
                    <Ionicons name="person-circle" size={40} color="#FF6B35" />
                    {driver.isOnline && <View style={styles.onlineIndicator} />}
                  </View>
                  <Text style={styles.driverName} numberOfLines={1}>
                    {driver.name || 'Driver'}
                  </Text>
                  <View style={styles.driverStatus}>
                    <View style={[styles.statusDot, driver.isOnline ? styles.onlineDot : styles.activeDot]} />
                    <Text style={driver.isOnline ? styles.onlineStatusText : styles.activeStatusText}>
                      {driver.isOnline ? 'Online & Driving' : 'Driving'}
                    </Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.trackButton}
                    onPress={() => navigation.navigate('DriverDetails', { driverId: driver.driverId })}
                  >
                    <Text style={styles.trackButtonText}>View</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Online Drivers Section */}
        {onlineDrivers.length > 0 && (
          <View style={styles.onlineDriversSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="radio" size={20} color="#4CAF50" />
              <Text style={styles.sectionTitle}>Online Drivers</Text>
              <View style={styles.onlineBadge}>
                <Text style={styles.onlineBadgeText}>{onlineDrivers.length}</Text>
              </View>
            </View>
            
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.driversScroll}
            >
              {onlineDrivers.map((driver) => (
                <View key={driver.driverId} style={[styles.driverCard, !driver.hasActiveTrip && styles.onlineOnlyCard]}>
                  <View style={styles.driverAvatar}>
                    <Ionicons name="person-circle" size={40} color={driver.hasActiveTrip ? "#FF6B35" : "#4CAF50"} />
                    <View style={styles.onlineIndicator} />
                  </View>
                  <Text style={styles.driverName} numberOfLines={1}>
                    {driver.name || 'Driver'}
                  </Text>
                  <View style={styles.driverStatus}>
                    <View style={[
                      styles.statusDot, 
                      driver.hasActiveTrip ? styles.activeDot : styles.onlineDot
                    ]} />
                    <Text style={driver.hasActiveTrip ? styles.activeStatusText : styles.onlineStatusText}>
                      {driver.hasActiveTrip ? 'On Trip' : 'Online'}
                    </Text>
                  </View>
                  <TouchableOpacity 
                    style={[styles.trackButton, !driver.hasActiveTrip && styles.onlineTrackButton]}
                    onPress={() => navigation.navigate('DriverDetails', { driverId: driver.driverId })}
                  >
                    <Text style={styles.trackButtonText}>
                      {driver.hasActiveTrip ? 'Track' : 'View'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* Footer Navigation */}
      <View style={styles.footerWrapper}>
        <View style={styles.footerNav}>
          <TouchableOpacity 
            onPress={() => navigation.navigate('FamilyDashboard')}
            style={styles.footerButton}
          >
            <View style={styles.activeTabIndicator}>
              <Ionicons name="home" size={28} color="#fff" />
            </View>
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

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  mainContainer: { 
    flex: 1, 
    backgroundColor: '#fff' 
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#d63384',
  },
  scrollContainer: { 
    paddingBottom: 140,
    paddingTop: 16,
  },
  headerWrapper: { 
    position: 'relative', 
    backgroundColor: '#d63384',
    paddingBottom: 20,
  },
  headerContent: {
    paddingTop: 40,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  curve: {
    position: 'absolute',
    bottom: -20,
    width: width,
    height: 40,
    backgroundColor: '#fff',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  headerTitle: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: '#fff' 
  },
  subTitle: { 
    fontSize: 14, 
    color: '#fff', 
    marginTop: 2,
    opacity: 0.9,
  },
  profileWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '50%',
  },
  profileName: {
    color: '#fff',
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 120,
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  box: {
    flex: 1,
    marginHorizontal: 6,
    padding: 18,
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 100,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  linkedBox: {
    backgroundColor: '#fef2f7',
  },
  activeBox: {
    backgroundColor: '#fff8f3',
  },
  onlineBox: {
    backgroundColor: '#f2fef7',
  },
  activeIconContainer: {
    padding: 8,
    backgroundColor: 'rgba(255, 107, 53, 0.1)',
    borderRadius: 20,
  },
  onlineIconContainer: {
    padding: 8,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderRadius: 20,
  },
  activeDriverText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#FF6B35',
    marginTop: 4,
  },
  onlineDriverText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#4CAF50',
    marginTop: 4,
  },
  onlineValue: {
    color: '#4CAF50',
  },
  featuresContainer: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  featureBox: {
    borderRadius: 20,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  featureContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  trackingBox: {
    backgroundColor: '#fff8f3',
  },
  geofenceBox: {
    backgroundColor: '#f3fff7',
  },
  alertsBox: {
    backgroundColor: '#f3f6ff',
  },
  linkageBox: {
    backgroundColor: '#fff3f8',
  },
  textPart: { 
    flex: 1, 
  },
  boxTitle: {
    fontSize: 15,
    color: '#555',
    fontWeight: '600',
    marginBottom: 4,
  },
  featureTitle: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
    marginBottom: 4,
  },
  boxValue: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    color: '#d63384',
    marginVertical: 4,
  },
  featureDescription: {
    fontSize: 14,
    color: '#666',
  },
  boxSubtext: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  // Active Drivers Section
  activeDriversSection: {
    marginTop: 24,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  // Online Drivers Section
  onlineDriversSection: {
    marginTop: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  activeBadge: {
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  activeBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  onlineBadge: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  onlineBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  driversScroll: {
    flexDirection: 'row',
  },
  driverCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 16,
    marginRight: 12,
    width: 140,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  onlineOnlyCard: {
    borderColor: '#4CAF50',
    borderWidth: 1,
  },
  driverAvatar: {
    position: 'relative',
    marginBottom: 8,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: '#fff',
  },
  driverName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  driverStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  activeDot: {
    backgroundColor: '#FF6B35',
  },
  onlineDot: {
    backgroundColor: '#4CAF50',
  },
  activeStatusText: {
    fontSize: 12,
    color: '#FF6B35',
    fontWeight: '500',
  },
  onlineStatusText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '500',
  },
  trackButton: {
    backgroundColor: '#d63384',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  onlineTrackButton: {
    backgroundColor: '#4CAF50',
  },
  trackButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
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
  activeTabIndicator: {
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
  },
});

export default FamilyDashboardScreen;