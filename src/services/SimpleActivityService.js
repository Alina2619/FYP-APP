import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import * as Location from 'expo-location';

class SimpleActivityService {
  constructor() {
    this.isMonitoring = false;
    this.callback = null;
    this.dataBuffer = [];
    this.lastGPS = null;
    this.lastPrediction = null;
    
    // Set reasonable update intervals
    this.accInterval = 100; // 100ms = 10Hz
    this.gyroInterval = 100;
    this.magnInterval = 100;
    this.gpsInterval = 1000; // 1 second
  }

  async initialize() {
    try {
      // Request permissions
      const [locationStatus, accStatus] = await Promise.all([
        Location.requestForegroundPermissionsAsync(),
        Accelerometer.requestPermissionsAsync()
      ]);

      if (locationStatus.status !== 'granted' || accStatus.status !== 'granted') {
        throw new Error('Required permissions not granted');
      }

      console.log('Simple Activity Service initialized');
      return true;
    } catch (error) {
      console.error('Initialization error:', error);
      throw error;
    }
  }

  startMonitoring(callback) {
    if (this.isMonitoring) return;
    
    this.callback = callback;
    this.isMonitoring = true;
    
    // Set sensor intervals
    Accelerometer.setUpdateInterval(this.accInterval);
    Gyroscope.setUpdateInterval(this.gyroInterval);
    Magnetometer.setUpdateInterval(this.magnInterval);
    
    // Start listening to sensors
    this.accSubscription = Accelerometer.addListener((data) => {
      this.processAccelerometer(data);
    });
    
    this.gyroSubscription = Gyroscope.addListener((data) => {
      this.processGyroscope(data);
    });
    
    this.magnSubscription = Magnetometer.addListener((data) => {
      this.processMagnetometer(data);
    });
    
    // Start location tracking
    this.startLocationTracking();
    
    console.log('Activity monitoring started');
  }

  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    // Remove all subscriptions
    if (this.accSubscription) this.accSubscription.remove();
    if (this.gyroSubscription) this.gyroSubscription.remove();
    if (this.magnSubscription) this.magnSubscription.remove();
    if (this.locationSubscription) this.locationSubscription.remove();
    
    this.isMonitoring = false;
    this.callback = null;
    console.log('Activity monitoring stopped');
  }

  async startLocationTracking() {
    this.locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: this.gpsInterval,
        distanceInterval: 1, // 1 meter
      },
      (location) => {
        this.processLocation(location);
      }
    );
  }

  processAccelerometer(data) {
    this.addToBuffer('acc', {
      x: data.x,
      y: data.y,
      z: data.z,
      timestamp: Date.now()
    });
  }

  processGyroscope(data) {
    this.addToBuffer('gyro', {
      x: data.x,
      y: data.y,
      z: data.z,
      timestamp: Date.now()
    });
  }

  processMagnetometer(data) {
    this.addToBuffer('magn', {
      x: data.x,
      y: data.y,
      z: data.z,
      timestamp: Date.now()
    });
  }

  processLocation(location) {
    const gpsData = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: location.coords.altitude || 0,
      speed: location.coords.speed || 0,
      heading: location.coords.heading || 0,
      accuracy: location.coords.accuracy || 0,
      timestamp: Date.now()
    };

    // Calculate movement
    if (this.lastGPS) {
      gpsData.latIncrement = gpsData.latitude - this.lastGPS.latitude;
      gpsData.longIncrement = gpsData.longitude - this.lastGPS.longitude;
      gpsData.speedChange = gpsData.speed - (this.lastGPS.speed || 0);
    } else {
      gpsData.latIncrement = 0;
      gpsData.longIncrement = 0;
      gpsData.speedChange = 0;
    }

    this.addToBuffer('gps', gpsData);
    this.lastGPS = gpsData;
  }

  addToBuffer(type, data) {
    this.dataBuffer.push({ type, ...data });
    
    // Keep buffer size manageable (last 200 readings)
    if (this.dataBuffer.length > 200) {
      this.dataBuffer = this.dataBuffer.slice(-100);
    }
    
    // Make prediction every 10th reading
    if (this.dataBuffer.length % 10 === 0) {
      this.predictActivity();
    }
  }

  predictActivity() {
    if (this.dataBuffer.length < 20) return;
    
    // Get recent accelerometer data (last 5 seconds)
    const recentAcc = this.dataBuffer
      .filter(d => d.type === 'acc')
      .slice(-50); // ~5 seconds at 10Hz
    
    if (recentAcc.length === 0) return;
    
    // Calculate movement metrics
    const accMagnitudes = recentAcc.map(a => 
      Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
    );
    
    const avgMagnitude = accMagnitudes.reduce((a, b) => a + b, 0) / accMagnitudes.length;
    const variance = this.calculateVariance(accMagnitudes);
    
    // Get GPS speed if available
    const recentGPS = this.dataBuffer
      .filter(d => d.type === 'gps')
      .slice(-5);
    
    const avgSpeed = recentGPS.length > 0 
      ? recentGPS.reduce((sum, g) => sum + (g.speed || 0), 0) / recentGPS.length
      : 0;
    
    // Rule-based activity prediction (simplified)
    let activity = 'Unknown';
    let confidence = 0;
    
    if (avgSpeed > 10) { // > 10 m/s ≈ 36 km/h
      activity = 'Driving';
      confidence = Math.min(0.9, 0.5 + (avgSpeed / 50));
    } else if (variance > 0.5 && avgMagnitude > 1.2) {
      activity = 'Walking';
      confidence = Math.min(0.8, variance * 0.6);
    } else if (variance > 0.2) {
      activity = 'Active';
      confidence = Math.min(0.7, variance * 0.8);
    } else {
      activity = 'Inactive';
      confidence = 0.9;
    }
    
    // Add some randomness to confidence for demo
    confidence = Math.min(0.95, confidence + (Math.random() * 0.1 - 0.05));
    
    this.lastPrediction = { activity, confidence, timestamp: Date.now() };
    
    // Call callback if available
    if (this.callback && this.isMonitoring) {
      this.callback({
        activity,
        confidence,
        timestamp: Date.now(),
        metrics: {
          avgMagnitude,
          variance,
          avgSpeed,
          sampleCount: recentAcc.length
        }
      });
    }
  }

  calculateVariance(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  getLastPrediction() {
    return this.lastPrediction;
  }

  getSensorStatus() {
    return {
      isMonitoring: this.isMonitoring,
      bufferSize: this.dataBuffer.length,
      hasGPS: !!this.lastGPS,
      lastUpdate: this.lastPrediction?.timestamp || null
    };
  }
}

// Export singleton instance
export default new SimpleActivityService();