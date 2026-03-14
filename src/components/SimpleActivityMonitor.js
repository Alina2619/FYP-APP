import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import SimpleActivityService from '../services/SimpleActivityService';

const { width } = Dimensions.get('window');

const SimpleActivityMonitor = ({ onActivityUpdate }) => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentActivity, setCurrentActivity] = useState('Ready');
  const [sensorStatus, setSensorStatus] = useState({});
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initializeService();
    return () => SimpleActivityService.stopMonitoring();
  }, []);

  const initializeService = async () => {
    try {
      await SimpleActivityService.initialize();
      setIsInitialized(true);
    } catch (error) {
      Alert.alert('Hey!', 'Please allow permissions to use this feature');
    }
  };

  const toggleMonitoring = async () => {
    if (!isInitialized) {
      Alert.alert('Just a sec', 'Getting things ready...');
      return;
    }

    if (isMonitoring) {
      SimpleActivityService.stopMonitoring();
      setIsMonitoring(false);
      setCurrentActivity('Paused');
    } else {
      SimpleActivityService.startMonitoring((prediction) => {
        setCurrentActivity(prediction.activity);
        setSensorStatus(SimpleActivityService.getSensorStatus());
        onActivityUpdate?.(prediction);
      });
      setIsMonitoring(true);
      setCurrentActivity('Warming up...');
    }
  };

  const drivingModes = [
    { 
      id: 'driving', 
      name: 'ON THE ROAD', 
      emoji: '🚗', 
      color: '#FF6B6B', 
      status: 'Moving',
      mainIcon: '🚗'
    },
    { 
      id: 'walking', 
      name: 'ON FOOT', 
      emoji: '👟', 
      color: '#4ECDC4', 
      status: 'Moving',
      mainIcon: '👟'
    },
    { 
      id: 'active', 
      name: 'MOVING', 
      emoji: '⚡', 
      color: '#FFD93D', 
      status: 'Moving',
      mainIcon: '⚡'
    },
    { 
      id: 'inactive', 
      name: 'STOPPED', 
      emoji: '⏸️', 
      color: '#A8E6CF', 
      status: 'Parked',
      mainIcon: '⏸️'
    },
  ];

  const getCurrentMode = () => {
    const activity = currentActivity.toLowerCase();
    return drivingModes.find(m => activity.includes(m.id)) || drivingModes[0];
  };

  const current = getCurrentMode();

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.titleSection}>
          <Text style={styles.title}>🚗 DRIVE TRACKER</Text>
          <Text style={styles.subtitle}>Know your status anytime</Text>
        </View>
        <View style={[styles.powerBadge, isMonitoring && styles.powerOn]}>
          <Text style={[styles.powerText, { color: isMonitoring ? '#16A34A' : '#9CA3AF' }]}>
            {isMonitoring ? '● ACTIVE' : '○ OFF'}
          </Text>
        </View>
      </View>

      {/* Main Status Card */}
      <View style={[styles.statusCard, { borderLeftColor: current.color }]}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusEmoji}>{current.mainIcon}</Text>
          <View style={styles.statusTag}>
            <Text style={[styles.statusTagText, { color: current.color }]}>
              {current.status}
            </Text>
          </View>
        </View>

        <Text style={styles.statusLabel}>Right now you are</Text>
        <Text style={[styles.statusMain, { color: current.color }]}>
          {currentActivity}
        </Text>
      </View>

      {/* Quick Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{sensorStatus.bufferSize || 0}</Text>
          <Text style={styles.statLabel}>Data points</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: sensorStatus.hasGPS ? '#16A34A' : '#9CA3AF' }]}>
            {sensorStatus.hasGPS ? '🛰️' : '📡'}
          </Text>
          <Text style={styles.statLabel}>GPS signal</Text>
        </View>
      </View>

      {/* All Modes */}
      <Text style={styles.sectionLabel}>WHAT WE DETECT</Text>
      <View style={styles.modesGrid}>
        {drivingModes.map((mode) => (
          <TouchableOpacity
            key={mode.id}
            style={[
              styles.modeCard,
              currentActivity.toLowerCase().includes(mode.id) && 
              { backgroundColor: mode.color + '20', borderColor: mode.color }
            ]}
            activeOpacity={0.7}
          >
            <Text style={styles.modeEmoji}>{mode.emoji}</Text>
            <Text style={[styles.modeName, { color: mode.color }]}>
              {mode.name}
            </Text>
            <View style={[
              styles.modeIndicator,
              currentActivity.toLowerCase().includes(mode.id) && 
              { backgroundColor: mode.color, width: '100%' }
            ]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Big Action Button */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          isMonitoring ? { backgroundColor: '#4B5563' } : { backgroundColor: '#16A34A' },
          !isInitialized && styles.buttonDisabled
        ]}
        onPress={toggleMonitoring}
        disabled={!isInitialized}
      >
        <Text style={styles.actionButtonText}>
          {isMonitoring ? '⏸️ PAUSE' : '▶️ START'}
        </Text>
      </TouchableOpacity>

      {/* Helper Text */}
      {!isInitialized && (
        <View style={styles.helperBox}>
          <Text style={styles.helperText}>⏳ Getting sensors ready...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleSection: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  powerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  powerOn: {
    backgroundColor: '#DCFCE7',
  },
  powerText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusEmoji: {
    fontSize: 32,
  },
  statusTag: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statusTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  statusMain: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 0,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  modesGrid: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  modeCard: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modeEmoji: {
    fontSize: 20,
    marginBottom: 6,
  },
  modeName: {
    fontSize: 9,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  modeIndicator: {
    height: 3,
    width: '0%',
    borderRadius: 2,
  },
  actionButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  buttonDisabled: {
    opacity: 0.5,
    backgroundColor: '#9CA3AF',
  },
  helperBox: {
    alignItems: 'center',
    marginTop: 8,
  },
  helperText: {
    color: '#D97706',
    fontSize: 12,
    fontWeight: '500',
  },
});

export default SimpleActivityMonitor;