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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, getDoc, query, collection, where, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const DriverTrackingScreen = ({ navigation }) => {
  const [userData, setUserData] = useState(null);
  const [linkedDrivers, setLinkedDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeDriversCount, setActiveDriversCount] = useState(0);
  const [onlineDriversCount, setOnlineDriversCount] = useState(0);
  const [driversWithActiveTrips, setDriversWithActiveTrips] = useState([]);
  
  // Refs to track listener subscriptions
  const unsubscribeListenersRef = useRef([]);
  const isMountedRef = useRef(true);

  // ACTIVE TRIP STATUSES (same as DriverDetailsScreen)
  const ACTIVE_TRIP_STATUSES = ['active', 'started', 'ongoing', 'in-progress', 'accepted', 'picked_up'];

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

  // Driver helpers
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

  // Function to get active trips for a driver (checking both userId and driverId fields)
  const getActiveTripsForDriver = useCallback(async (driverId) => {
    try {
      // Check trips where driverId OR userId matches
      const activeTripsQuery = query(
        collection(db, 'trips'),
        where('status', 'in', ACTIVE_TRIP_STATUSES)
      );
      
      const snapshot = await getDocs(activeTripsQuery);
      const activeTrips = [];
      
      snapshot.forEach(doc => {
        const tripData = doc.data();
        // Check if this trip belongs to our driver
        if (tripData.driverId === driverId || tripData.userId === driverId) {
          activeTrips.push({ id: doc.id, ...tripData });
        }
      });
      
      return activeTrips;
    } catch (error) {
      console.error('Error getting active trips for driver:', driverId, error);
      return [];
    }
  }, []);

  // Function to check if driver has active trips
  const checkDriverHasActiveTrip = useCallback(async (driverId) => {
    try {
      const activeTrips = await getActiveTripsForDriver(driverId);
      return activeTrips.length > 0;
    } catch (error) {
      console.error('Error checking driver active trips:', driverId, error);
      return false;
    }
  }, [getActiveTripsForDriver]);

  // Function to check driver's online status (one-time check)
  const checkDriverOnlineStatus = useCallback(async (driverId) => {
    try {
      const driverDocRef = doc(db, 'users', driverId);
      const driverDoc = await getDoc(driverDocRef);
      
      if (driverDoc.exists()) {
        const driverData = driverDoc.data();
        
        return driverData.status === 'online' || 
               driverData.isOnline === true ||
               driverData.lastSeen && 
               (Date.now() - driverData.lastSeen.toMillis()) < 5 * 60 * 1000;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking driver online status:', error);
      return false;
    }
  }, []);

  // Function to calculate driver status for display
  const getDriverStatus = useCallback((driver) => {
    if (driver.hasActiveTrip) {
      return { status: 'active', text: 'On Active Trip', color: '#28a745', icon: 'car' };
    }
    if (driver.isOnline) {
      return { status: 'online', text: 'Online', color: '#17a2b8', icon: 'wifi' };
    }
    if (driver.lastTripTime) {
      const lastTrip = new Date(driver.lastTripTime);
      const now = new Date();
      const hoursDiff = Math.floor((now - lastTrip) / (1000 * 60 * 60));
      
      if (hoursDiff < 1) return { status: 'recent', text: 'Recently Active', color: '#6c757d', icon: 'time' };
      if (hoursDiff < 24) return { status: 'inactive', text: 'Active Today', color: '#6c757d', icon: 'today' };
    }
    return { status: 'offline', text: 'Offline', color: '#dc3545', icon: 'wifi-off' };
  }, []);

  // Cleanup all listeners
  const cleanupListeners = useCallback(() => {
    if (unsubscribeListenersRef.current.length > 0) {
      unsubscribeListenersRef.current.forEach(unsubscribe => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
      unsubscribeListenersRef.current = [];
    }
  }, []);

  // Setup real-time listeners for drivers
  const setupRealTimeListeners = useCallback(async (drivers, currentUser) => {
    cleanupListeners(); // Clean up any existing listeners
    
    if (!drivers.length || !isMountedRef.current) return;

    const driverIds = drivers.map(driver => driver.driverId);
    
    // 1. Listen to ALL active trips (we'll filter by driverId/userId in the callback)
    const activeTripsQuery = query(
      collection(db, 'trips'),
      where('status', 'in', ACTIVE_TRIP_STATUSES)
    );

    const unsubscribeActiveTrips = onSnapshot(activeTripsQuery, (snapshot) => {
      if (!isMountedRef.current) return;
      
      // Create a map of driverId -> hasActiveTrip
      const activeTripsByDriver = {};
      
      snapshot.forEach(doc => {
        const tripData = doc.data();
        const driverId = tripData.driverId || tripData.userId; // Check both fields
        if (driverId && driverIds.includes(driverId)) {
          activeTripsByDriver[driverId] = true;
        }
      });

      console.log('Active trips update:', Object.keys(activeTripsByDriver).length, 'drivers with active trips');

      // Update drivers with active trips
      setLinkedDrivers(prevDrivers => {
        const updatedDrivers = prevDrivers.map(driver => ({
          ...driver,
          hasActiveTrip: !!activeTripsByDriver[driver.driverId]
        }));

        // Calculate counts
        const activeDrivers = updatedDrivers.filter(driver => driver.hasActiveTrip);
        const onlineDrivers = updatedDrivers.filter(driver => driver.isOnline);
        
        console.log('Updated active drivers:', activeDrivers.length);
        
        setActiveDriversCount(activeDrivers.length);
        setOnlineDriversCount(onlineDrivers.length);
        setDriversWithActiveTrips(activeDrivers);

        return updatedDrivers;
      });
    });

    unsubscribeListenersRef.current.push(unsubscribeActiveTrips);

    // 2. Listen to each driver's document for online status changes
    drivers.forEach(driver => {
      const driverId = driver.driverId;
      const driverRef = doc(db, 'users', driverId);
      
      const unsubscribeDriver = onSnapshot(driverRef, (docSnapshot) => {
        if (!isMountedRef.current || !docSnapshot.exists()) return;
        
        const driverData = docSnapshot.data();
        
        const isOnline = driverData.status === 'online' || 
                        driverData.isOnline === true ||
                        driverData.lastSeen && 
                        (Date.now() - driverData.lastSeen.toMillis()) < 5 * 60 * 1000;
        
        setLinkedDrivers(prevDrivers => {
          const driverIndex = prevDrivers.findIndex(d => d.driverId === driverId);
          if (driverIndex !== -1) {
            const updatedDrivers = [...prevDrivers];
            const currentDriver = updatedDrivers[driverIndex];
            
            // Only update if online status changed
            if (currentDriver.isOnline !== isOnline) {
              updatedDrivers[driverIndex] = { 
                ...currentDriver, 
                ...driverData,
                isOnline: isOnline
              };
              
              // Recalculate online count
              const onlineDrivers = updatedDrivers.filter(d => d.isOnline);
              setOnlineDriversCount(onlineDrivers.length);
              
              return updatedDrivers;
            }
          }
          return prevDrivers;
        });
      });

      unsubscribeListenersRef.current.push(unsubscribeDriver);
    });

    // 3. Listen to user's linked drivers changes
    if (currentUser) {
      const userRef = doc(db, "users", currentUser.uid);
      const unsubscribeUser = onSnapshot(userRef, async (docSnap) => {
        if (!isMountedRef.current || !docSnap.exists()) return;
        
        const data = docSnap.data();
        setUserData(data);
        const rawLinkedDrivers = data.linkedDrivers || [];

        // Check for driver additions/removals
        const currentDriverIds = drivers.map(d => d.driverId);
        const newDriverIds = rawLinkedDrivers.map(d => d.driverId);
        
        // If drivers changed, reload
        if (currentDriverIds.length !== newDriverIds.length || 
            !currentDriverIds.every(id => newDriverIds.includes(id))) {
          await loadDriversData(currentUser);
        }
      });

      unsubscribeListenersRef.current.push(unsubscribeUser);
    }
  }, [cleanupListeners]);

  // Load drivers data (one-time initial load)
  const loadDriversData = useCallback(async (user) => {
    try {
      if (!isMountedRef.current) return;
      
      setLoading(true);
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists() && isMountedRef.current) {
        const data = userSnap.data();
        setUserData(data);
        const rawLinkedDrivers = data.linkedDrivers || [];

        // Fetch each linked driver's full profile
        const driverPromises = rawLinkedDrivers.map(async (driver) => {
          try {
            const driverRef = doc(db, "users", driver.driverId);
            const driverSnap = await getDoc(driverRef);

            if (driverSnap.exists()) {
              const driverData = driverSnap.data();
              
              // Check initial online status (one-time)
              const isOnline = driverData.status === 'online' || 
                              driverData.isOnline === true ||
                              driverData.lastSeen && 
                              (Date.now() - driverData.lastSeen.toMillis()) < 5 * 60 * 1000;
              
              // Check initial active trip status (one-time)
              const hasActiveTrip = await checkDriverHasActiveTrip(driver.driverId);
              
              console.log(`Driver ${driver.driverId}: hasActiveTrip = ${hasActiveTrip}, isOnline = ${isOnline}`);
              
              return { 
                ...driver, 
                ...driverData,
                hasActiveTrip,
                isOnline
              };
            }
            return { ...driver, hasActiveTrip: false, isOnline: false };
          } catch (err) {
            console.error("Error fetching driver:", driver.driverId, err);
            return { ...driver, hasActiveTrip: false, isOnline: false };
          }
        });

        const enrichedDrivers = await Promise.all(driverPromises);
        
        console.log('Total drivers loaded:', enrichedDrivers.length);
        console.log('Drivers with active trips:', enrichedDrivers.filter(d => d.hasActiveTrip).map(d => d.driverId));
        
        if (isMountedRef.current) {
          setLinkedDrivers(enrichedDrivers);
          
          // Calculate initial counts
          const activeDrivers = enrichedDrivers.filter(driver => driver.hasActiveTrip);
          const onlineDrivers = enrichedDrivers.filter(driver => driver.isOnline);
          
          console.log('Active drivers count:', activeDrivers.length);
          console.log('Online drivers count:', onlineDrivers.length);
          
          setActiveDriversCount(activeDrivers.length);
          setOnlineDriversCount(onlineDrivers.length);
          setDriversWithActiveTrips(activeDrivers);
          
          // Setup real-time listeners (will update only when data changes)
          setupRealTimeListeners(enrichedDrivers, user);
        }
      }
    } catch (error) {
      console.error("Error loading drivers:", error);
      if (isMountedRef.current) {
        setLoading(false);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [checkDriverHasActiveTrip, setupRealTimeListeners]);

  // Setup auth state listener (one-time)
  useEffect(() => {
    isMountedRef.current = true;
    
    const auth = getAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (isMountedRef.current) {
          setUserData(null);
          setLinkedDrivers([]);
          setActiveDriversCount(0);
          setOnlineDriversCount(0);
          setDriversWithActiveTrips([]);
          setLoading(false);
        }
        return;
      }

      await loadDriversData(user);
    });

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      unsubscribeAuth();
      cleanupListeners();
    };
  }, [loadDriversData, cleanupListeners]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const auth = getAuth();
    const user = auth.currentUser;
    if (user) {
      loadDriversData(user);
    }
  }, [loadDriversData]);

  const renderProfileItem = ({ item }) => {
    const driverStatus = getDriverStatus(item);
    
    return (
      <TouchableOpacity
        style={styles.profileCard}
        onPress={() =>
          navigation.navigate('DriverDetailsScreen', {
            driverId: item.driverId,
            driverData: item,
          })
        }
        activeOpacity={0.8}
      >
        <View style={styles.profileInfo}>
          {getDriverProfileImage(item) ? (
            <View style={styles.avatarContainer}>
              <Image
                source={{ uri: getDriverProfileImage(item) }}
                style={styles.profileAvatar}
              />
              <View style={[
                styles.statusIndicator, 
                item.hasActiveTrip ? styles.activeIndicator : 
                item.isOnline ? styles.onlineIndicator : styles.offlineIndicator
              ]} />
            </View>
          ) : (
            <View style={styles.avatarContainer}>
              <View style={styles.profileAvatarPlaceholder}>
                <Ionicons name="person" size={24} color="#d63384" />
              </View>
              <View style={[
                styles.statusIndicator, 
                item.hasActiveTrip ? styles.activeIndicator : 
                item.isOnline ? styles.onlineIndicator : styles.offlineIndicator
              ]} />
            </View>
          )}
          <View style={styles.profileText}>
            <View style={styles.nameRow}>
              <Text style={styles.profileCardName}>{getDriverName(item)}</Text>
              <View style={[styles.statusBadge, { backgroundColor: driverStatus.color + '20' }]}>
                <View style={[styles.statusDot, { backgroundColor: driverStatus.color }]} />
                <Text style={[styles.statusText, { color: driverStatus.color }]}>
                  {driverStatus.text}
                </Text>
              </View>
            </View>
            {item.email && (
              <Text style={styles.profileEmail} numberOfLines={1}>
                <Ionicons name="mail" size={12} color="#666" /> {item.email}
              </Text>
            )}
            {item.phone && (
              <Text style={styles.profilePhone} numberOfLines={1}>
                <Ionicons name="call" size={12} color="#666" /> {item.phone}
              </Text>
            )}
            <Text style={styles.profileRelation}>
              <Ionicons name="people" size={12} color="#888" /> 
              Relation: {item.relation || 'Not specified'}
            </Text>
            {/* Show trip info if driver has active trip */}
            {item.hasActiveTrip && (
              <View style={styles.activeTripInfo}>
                <Ionicons name="car" size={12} color="#28a745" />
                <Text style={styles.activeTripText}>Currently on an active trip</Text>
                {/* DEBUG: Show which field is being used */}
                {__DEV__ && (
                  <Text style={styles.debugInfo}>
                    (Active Trip Detected)
                  </Text>
                )}
              </View>
            )}
            {/* DEBUG: Show driver ID and status */}
            {__DEV__ && (
              <Text style={styles.debugText}>
                ID: {item.driverId?.substring(0, 8)}... | Active: {item.hasActiveTrip ? 'YES' : 'NO'} | Online: {item.isOnline ? 'YES' : 'NO'}
              </Text>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={24} color="#d63384" />
      </TouchableOpacity>
    );
  };

  const name = getUserName();
  const profileImage = getProfileImage();

  return (
    <View style={styles.mainContainer}>
      {/* HEADER */}
      <View style={styles.headerWrapper}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Drivemate</Text>
            <Text style={styles.subTitle}>Driver Tracking</Text>
          </View>

          {/* Profile Section */}
          <View style={styles.profileWrapper}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.headerProfileName} numberOfLines={1}>
                  {name}
                </Text>
                {profileImage ? (
                  <Image source={{ uri: profileImage }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="person" size={20} color="#d63384" />
                  </View>
                )}
              </>
            )}
          </View>
        </View>
        <View style={styles.curve} />
      </View>

      {/* CONTENT */}
      <View style={styles.content}>
        {/* Stats Overview - THREE boxes */}
        <View style={styles.statsContainer}>
          <View style={[styles.statCard, styles.totalCard]}>
            <Ionicons name="people" size={24} color="#d63384" />
            <View style={styles.statText}>
              <Text style={styles.statNumber}>{linkedDrivers.length}</Text>
              <Text style={styles.statLabel}>Total Drivers</Text>
            </View>
          </View>
          <View style={[styles.statCard, styles.activeCard]}>
            <Ionicons name="car" size={24} color="#28a745" />
            <View style={styles.statText}>
              <Text style={[styles.statNumber, styles.activeNumber]}>{activeDriversCount}</Text>
              <Text style={styles.statLabel}>Active Now</Text>
              <Text style={styles.statSubtext}>On Active Trip</Text>
              {activeDriversCount > 0 ? (
                <View style={styles.activeDriversList}>
                  <Text style={styles.driversListTitle}>Active Drivers:</Text>
                  {driversWithActiveTrips.slice(0, 3).map((driver, index) => (
                    <Text key={driver.driverId} style={styles.driverNameText} numberOfLines={1}>
                      {index + 1}. {getDriverName(driver)}
                    </Text>
                  ))}
                  {driversWithActiveTrips.length > 3 && (
                    <Text style={styles.moreDriversText}>
                      +{driversWithActiveTrips.length - 3} more
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={styles.noActiveDriversText}>No drivers on active trips</Text>
              )}
            </View>
          </View>
          <View style={[styles.statCard, styles.onlineCard]}>
            <Ionicons name="wifi" size={24} color="#17a2b8" />
            <View style={styles.statText}>
              <Text style={[styles.statNumber, styles.onlineNumber]}>{onlineDriversCount}</Text>
              <Text style={styles.statLabel}>Online</Text>
              <Text style={styles.statSubtext}>Connected to app</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Linked Drivers</Text>
          {linkedDrivers.length > 0 && (
            <TouchableOpacity 
              onPress={onRefresh}
              style={styles.refreshButton}
            >
              <Ionicons name="refresh" size={20} color="#d63384" />
            </TouchableOpacity>
          )}
        </View>

        {loading && !refreshing ? (
          <ActivityIndicator size="large" color="#d63384" style={styles.loader} />
        ) : linkedDrivers.length > 0 ? (
          <FlatList
            data={linkedDrivers}
            renderItem={renderProfileItem}
            keyExtractor={(item) => item.driverId || Math.random().toString()}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="people-outline" size={80} color="#e9ecef" />
            </View>
            <Text style={styles.emptyText}>No drivers linked yet</Text>
            <Text style={styles.emptySubText}>
              Link drivers to track their location and driving status
            </Text>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => navigation.navigate('ProfileLinkageScreen')}
              activeOpacity={0.8}
            >
              <Ionicons name="link" size={20} color="#fff" style={styles.buttonIcon} />
              <Text style={styles.linkButtonText}>Go to Profile Linkage</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

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
            <View style={styles.activeTabIndicator}>
              <Ionicons name="map" size={28} color="#fff" />
            </View>
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
  curve: {
    width: width,
    height: 30,
    backgroundColor: '#fff',
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    marginTop: -10,
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
    flexDirection: 'row-reverse', 
    alignItems: 'center', 
    maxWidth: '50%' 
  },
  headerProfileName: {
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
  content: { 
    flex: 1, 
    padding: 16 
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
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
  totalCard: {
    backgroundColor: '#fef2f7',
  },
  activeCard: {
    backgroundColor: '#f2fef7',
  },
  onlineCard: {
    backgroundColor: '#f2f9ff',
  },
  statText: {
    marginLeft: 12,
    flex: 1,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  activeNumber: {
    color: '#28a745',
  },
  onlineNumber: {
    color: '#17a2b8',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginTop: 2,
  },
  statSubtext: {
    fontSize: 10,
    color: '#888',
    marginTop: 1,
  },
  activeDriversList: {
    marginTop: 4,
  },
  driversListTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#28a745',
    marginBottom: 2,
  },
  driverNameText: {
    fontSize: 8,
    color: '#28a745',
    fontStyle: 'italic',
    lineHeight: 10,
  },
  moreDriversText: {
    fontSize: 8,
    color: '#28a745',
    fontStyle: 'italic',
    marginTop: 1,
  },
  noActiveDriversText: {
    fontSize: 9,
    color: '#888',
    fontStyle: 'italic',
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  refreshButton: {
    padding: 8,
  },
  listContainer: { 
    paddingBottom: 100 
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
  activeIndicator: {
    backgroundColor: '#28a745',
  },
  onlineIndicator: {
    backgroundColor: '#17a2b8',
  },
  offlineIndicator: {
    backgroundColor: '#dc3545',
  },
  profileAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f8d7da',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileText: { 
    flex: 1 
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  profileCardName: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: '#333', 
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
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
  profileEmail: { 
    fontSize: 13, 
    color: '#666', 
    marginBottom: 2 
  },
  profilePhone: { 
    fontSize: 13, 
    color: '#666', 
    marginBottom: 2 
  },
  profileRelation: { 
    fontSize: 12, 
    color: '#888', 
    fontStyle: 'italic' 
  },
  activeTripInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  activeTripText: {
    fontSize: 11,
    color: '#28a745',
    marginLeft: 4,
    fontWeight: '600',
  },
  debugInfo: {
    fontSize: 9,
    color: '#28a745',
    marginLeft: 4,
    fontStyle: 'italic',
  },
  debugText: {
    fontSize: 8,
    color: '#999',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  loader: { 
    marginTop: 40 
  },
  emptyState: {
    flex: 1,
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
    marginBottom: 16,
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
    paddingHorizontal: 20,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d63384',
    paddingVertical: 14,
    paddingHorizontal: 24,
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
    fontWeight: '600',
    fontSize: 15,
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
  activeTabIndicator: {
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
  },
});

export default DriverTrackingScreen;