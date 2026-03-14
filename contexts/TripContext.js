import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { auth, db } from "../firebaseConfig";
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  getDoc, // This is imported here
  arrayUnion,
  increment,
  serverTimestamp,
  // Remove the duplicate getDoc import below
} from "firebase/firestore";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Location from "expo-location";

const TripContext = createContext();

export const TripProvider = ({ children }) => {
  const [tripData, setTripData] = useState(null);
  const [recentTrip, setRecentTrip] = useState(null);
  const [isLogging, setIsLogging] = useState(false);
  const [impactDetected, setImpactDetected] = useState(false);

  const [timeElapsed, setTimeElapsed] = useState(0);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [startLocation, setStartLocation] = useState(null);

  // New refs for live stats
  const distanceRef = useRef(0);
  const speedDataRef = useRef([]);
  const avgSpeedRef = useRef(0);
  const maxSpeedRef = useRef(0);

  const timerRef = useRef(null);
  const locationSub = useRef(null);
  const prevLocation = useRef(null);
  const accelSub = useRef(null);
  const gyroSub = useRef(null);
  const tripUpdateInterval = useRef(null);
  const tripRefFirestore = useRef(null);

  // Helper: Haversine formula
  const deg2rad = (deg) => deg * (Math.PI / 180);
  const getDistanceFromLatLonInKm = useCallback((lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) *
        Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationSub.current) locationSub.current.remove();
      if (accelSub.current) accelSub.current.remove();
      if (gyroSub.current) gyroSub.current.remove();
      if (tripUpdateInterval.current) clearInterval(tripUpdateInterval.current);
    };
  }, []);

  // NEW FUNCTION: Start trip with existing trip ID (from Dashboard)
  const startTripWithId = async (tripId, existingTripData = null) => {
    const user = auth.currentUser;
    if (!user) {
      console.error("User not authenticated");
      return false;
    }

    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.error("Location permission denied");
        return false;
      }

      // If we have an existing trip ID, use it
      if (tripId) {
        const tripRef = doc(db, "trips", tripId);
        tripRefFirestore.current = tripRef;
        
        // Get existing trip data if not provided
        let tripDataFromFirestore = existingTripData;
        if (!tripDataFromFirestore) {
          const tripSnapshot = await getDoc(tripRef);
          if (tripSnapshot.exists()) {
            tripDataFromFirestore = tripSnapshot.data();
          }
        }

        // Update the trip status to active
        await updateDoc(tripRef, {
          status: "active",
          isLogging: true,
          updatedAt: serverTimestamp(),
        });

        const startTime = new Date();
        setTripData({
          tripId: tripId,
          distance: tripDataFromFirestore?.distance || 0,
          duration: tripDataFromFirestore?.duration || 0,
          avgSpeed: tripDataFromFirestore?.avgSpeed || 0,
          maxSpeed: tripDataFromFirestore?.maxSpeed || 0,
          startTime,
          currentLocation: tripDataFromFirestore?.currentLocation || null,
          startLocation: tripDataFromFirestore?.startLocation || null,
          impact: tripDataFromFirestore?.impact || false,
          speedData: tripDataFromFirestore?.speedData || [],
          status: "active",
        });
      } else {
        // Create new trip
        const tripRef = await addDoc(collection(db, "trips"), {
          userId: user.uid,
          startTime: serverTimestamp(),
          endTime: null,
          distance: 0,
          duration: 0,
          impact: false,
          status: "active",
          isLogging: true,
          currentLocation: null,
          avgSpeed: 0,
          maxSpeed: 0,
          speedData: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        tripRefFirestore.current = tripRef;

        const startTime = new Date();
        setTripData({
          tripId: tripRef.id,
          distance: 0,
          duration: 0,
          avgSpeed: 0,
          maxSpeed: 0,
          startTime,
          currentLocation: null,
          startLocation: null,
          impact: false,
          speedData: [],
          status: "active",
        });
      }

      setIsLogging(true);
      setTimeElapsed(0);

      // Reset refs
      distanceRef.current = tripData?.distance || 0;
      speedDataRef.current = tripData?.speedData || [];
      avgSpeedRef.current = tripData?.avgSpeed || 0;
      maxSpeedRef.current = tripData?.maxSpeed || 0;
      prevLocation.current = null;
      setStartLocation(tripData?.startLocation || null);
      setImpactDetected(false);

      // Timer (seconds) with Firestore duration update every second
      timerRef.current = setInterval(() => {
        setTimeElapsed((prev) => {
          const newTime = prev + 1;
          if (tripRefFirestore.current) {
            updateDoc(tripRefFirestore.current, { 
              duration: newTime,
              updatedAt: serverTimestamp()
            }).catch(err =>
              console.error("Error updating duration in Firestore:", err)
            );
          }
          return newTime;
        });
      }, 1000);

      // Location tracking
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
        async (loc) => {
          const { latitude, longitude, speed } = loc.coords;

          // Calculate incremental distance, speed stats:
          let incrementalDistance = 0;
          if (prevLocation.current) {
            incrementalDistance = getDistanceFromLatLonInKm(
              prevLocation.current.latitude,
              prevLocation.current.longitude,
              latitude,
              longitude
            );
          }

          prevLocation.current = { latitude, longitude };

          // Update refs
          distanceRef.current = parseFloat((distanceRef.current + incrementalDistance).toFixed(2));

          const kmh = (speed || 0) * 3.6;
          speedDataRef.current = [...speedDataRef.current, kmh];
          avgSpeedRef.current = speedDataRef.current.length > 0
            ? parseFloat((speedDataRef.current.reduce((a, b) => a + b, 0) / speedDataRef.current.length).toFixed(2))
            : 0;
          maxSpeedRef.current = Math.max(maxSpeedRef.current, kmh);

          try {
            if (!tripRefFirestore.current) {
              console.warn("No trip Firestore reference set.");
              return;
            }

            await updateDoc(tripRefFirestore.current, {
              distance: distanceRef.current,
              avgSpeed: avgSpeedRef.current,
              maxSpeed: maxSpeedRef.current,
              currentLocation: { latitude, longitude },
              duration: timeElapsed,
              speedData: speedDataRef.current,
              updatedAt: serverTimestamp(),
            });

          } catch (error) {
            console.error("Failed to update Firestore trip stats:", error);
          }

          // Update local state to re-render UI
          setCurrentLocation({ latitude, longitude });
          setTripData((prev) =>
            prev
              ? {
                  ...prev,
                  distance: distanceRef.current,
                  avgSpeed: avgSpeedRef.current,
                  maxSpeed: maxSpeedRef.current,
                  currentLocation: { latitude, longitude },
                  duration: timeElapsed,
                  speedData: speedDataRef.current,
                }
              : prev
          );
        }
      );

      // Update interval
      tripUpdateInterval.current = setInterval(async () => {
        if (!tripRefFirestore.current) return;
        try {
          await updateDoc(tripRefFirestore.current, {
            distance: distanceRef.current,
            avgSpeed: avgSpeedRef.current,
            maxSpeed: maxSpeedRef.current,
            duration: timeElapsed,
            currentLocation: prevLocation.current,
            speedData: speedDataRef.current,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          console.error("Error updating Firestore backup:", err);
        }
      }, 5000);

      return true;
    } catch (error) {
      console.error("Error starting trip:", error);
      return false;
    }
  };

  // Original startTrip function (for backward compatibility)
  const startTrip = async () => {
    return await startTripWithId(null);
  };

  const stopTrip = async () => {
    if (!tripData || !tripRefFirestore.current) return;
    const user = auth.currentUser;
    if (!user) return;

    try {
      const tripRef = tripRefFirestore.current;
      const endTime = new Date();
      const start =
        tripData.startTime?.toDate
          ? tripData.startTime.toDate()
          : new Date(tripData.startTime);
      const duration = (endTime.getTime() - start.getTime()) / 1000; // in seconds

      await updateDoc(tripRef, {
        endTime: serverTimestamp(),
        distance: distanceRef.current,
        duration: Number(duration.toFixed(2)),
        avgSpeed: avgSpeedRef.current,
        maxSpeed: maxSpeedRef.current,
        startLocation: tripData.startLocation,
        endLocation: currentLocation,
        impact: tripData.impact || false,
        status: "completed",
        isLogging: false,
        updatedAt: serverTimestamp(),
      });

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        await updateDoc(userRef, {
          trips: arrayUnion(tripData.tripId),
          totalTrips: increment(1),
          totalDistance: increment(distanceRef.current),
        });
      }

      setRecentTrip({
        distance: distanceRef.current,
        duration: Number(duration.toFixed(2)),
        avgSpeed: avgSpeedRef.current,
        maxSpeed: maxSpeedRef.current,
        startLocation: tripData.startLocation,
        endLocation: currentLocation,
      });

    } catch (error) {
      console.error("Error stopping trip:", error);
    } finally {
      setTripData(null);
      setIsLogging(false);
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationSub.current) locationSub.current.remove();
      if (accelSub.current) accelSub.current.remove();
      if (gyroSub.current) gyroSub.current.remove();
      if (tripUpdateInterval.current) clearInterval(tripUpdateInterval.current);
      tripRefFirestore.current = null;
    }
  };

  // Update trip data function (for external updates)
  const updateTripData = (updates) => {
    setTripData(prev => prev ? { ...prev, ...updates } : null);
  };

  // Get current trip stats
  const getTripStats = () => ({
    distance: Number(distanceRef.current.toFixed(2)),
    avgSpeed: Number(avgSpeedRef.current.toFixed(2)),
    maxSpeed: Number(maxSpeedRef.current.toFixed(2)),
    timeElapsed,
    currentLocation,
  });

  // Impact detection
  useEffect(() => {
    if (!isLogging) {
      accelSub.current?.remove();
      gyroSub.current?.remove();
      return;
    }

    const triggerImpact = async () => {
      if (impactDetected || !tripData) return;
      setImpactDetected(true);
      setTripData((prev) => (prev ? { ...prev, impact: true } : prev));

      try {
        if (tripRefFirestore.current) {
          await updateDoc(tripRefFirestore.current, { 
            impact: true,
            updatedAt: serverTimestamp()
          });
        }
      } catch (error) {
        console.error("Error updating impact:", error);
      }

      setTimeout(() => setImpactDetected(false), 10000);
    };

    Accelerometer.setUpdateInterval(500);
    accelSub.current = Accelerometer.addListener((data) => {
      const accelMagnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
      if (accelMagnitude > 3) triggerImpact();
    });

    Gyroscope.setUpdateInterval(500);
    gyroSub.current = Gyroscope.addListener((data) => {
      const gyroMagnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
      if (gyroMagnitude > 3) triggerImpact();
    });

    return () => {
      accelSub.current?.remove();
      gyroSub.current?.remove();
    };
  }, [isLogging, tripData, impactDetected]);

  // Provide latest stats via context (from refs)
  return (
    <TripContext.Provider
      value={{
        tripData,
        recentTrip,
        isLogging,
        timeElapsed,
        distance: Number(distanceRef.current.toFixed(2)),
        avgSpeed: Number(avgSpeedRef.current.toFixed(2)),
        maxSpeed: Number(maxSpeedRef.current.toFixed(2)),
        speedData: speedDataRef.current,
        currentLocation,
        startTrip,
        startTripWithId, // NEW: For starting with existing trip ID
        stopTrip,
        updateTripData, // NEW: For updating trip data
        getTripStats, // NEW: For getting current stats
        impactDetected,
      }}
    >
      {children}
    </TripContext.Provider>
  );
};

export const useTrip = () => useContext(TripContext);