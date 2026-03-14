import React, { useState, useEffect, useRef } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  Animated,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import VoiceCommandService from '../voice/VoiceCommandService';

const VoiceCommandButton = ({ onCommandDetected, onError }) => {
  const [isListening, setIsListening] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  useEffect(() => {
    // Initialize voice service
    const init = async () => {
      const initialized = await VoiceCommandService.initialize();
      setIsInitialized(initialized);
    };
    
    init();
    
    return () => {
      VoiceCommandService.cleanup();
    };
  }, []);
  
  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };
  
  const stopPulseAnimation = () => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  };
  
  const handleVoiceCommand = async () => {
    if (!isInitialized) {
      onError?.('Voice service not initialized');
      return;
    }
    
    if (isListening) return;
    
    try {
      setIsListening(true);
      startPulseAnimation();
      
      const commandResult = await VoiceCommandService.startRecording();
      
      if (commandResult) {
        setResult(commandResult);
        setShowResult(true);
        
        // Notify parent component
        if (commandResult.confidence > 0.7) {
          onCommandDetected?.(commandResult);
        }
        
        // Auto-hide result after 3 seconds
        setTimeout(() => {
          setShowResult(false);
        }, 3000);
      }
      
    } catch (error) {
      console.error('Voice command error:', error);
      onError?.(error.message);
    } finally {
      setIsListening(false);
      stopPulseAnimation();
    }
  };
  
  const getConfidenceColor = (confidence) => {
    if (confidence > 0.8) return '#10B981'; // Green
    if (confidence > 0.6) return '#F59E0B'; // Yellow
    return '#EF4444'; // Red
  };
  
  if (!isInitialized) {
    return (
      <TouchableOpacity style={styles.button} disabled>
        <ActivityIndicator size="small" color="#1D807C" />
        <Text style={styles.buttonText}>Initializing...</Text>
      </TouchableOpacity>
    );
  }
  
  return (
    <>
      <TouchableOpacity
        style={[
          styles.button,
          isListening && styles.listeningButton
        ]}
        onPress={handleVoiceCommand}
        disabled={isListening}
      >
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Ionicons
            name={isListening ? "mic" : "mic-outline"}
            size={24}
            color={isListening ? "#EF4444" : "#1D807C"}
          />
        </Animated.View>
        <Text style={styles.buttonText}>
          {isListening ? 'Listening...' : 'Voice Command'}
        </Text>
      </TouchableOpacity>
      
      {/* Result Modal */}
      <Modal
        visible={showResult}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResult(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.resultCard}>
            <Ionicons
              name={result?.confidence > 0.7 ? "checkmark-circle" : "warning"}
              size={48}
              color={getConfidenceColor(result?.confidence || 0)}
              style={styles.resultIcon}
            />
            
            <Text style={styles.resultTitle}>
              {result?.confidence > 0.7 ? 'Command Detected' : 'Low Confidence'}
            </Text>
            
            <Text style={styles.resultCommand}>
              "{result?.command || 'Unknown'}"
            </Text>
            
            <View style={styles.confidenceContainer}>
              <Text style={styles.confidenceLabel}>Confidence:</Text>
              <Text style={[
                styles.confidenceValue,
                { color: getConfidenceColor(result?.confidence || 0) }
              ]}>
                {(result?.confidence * 100).toFixed(1)}%
              </Text>
            </View>
            
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowResult(false)}
            >
              <Text style={styles.closeButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#1D807C',
    marginHorizontal: 8,
  },
  listeningButton: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  buttonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#1D807C',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  resultCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  resultIcon: {
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  resultCommand: {
    fontSize: 18,
    color: '#4B5563',
    marginBottom: 16,
    textAlign: 'center',
  },
  confidenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  confidenceLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginRight: 8,
  },
  confidenceValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    backgroundColor: '#1D807C',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  closeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default VoiceCommandButton;