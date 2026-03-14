// src/utils/audioUtils.js
import { Audio } from 'expo-av';

class AudioProcessor {
  static async recordAudio(duration = 3000) {
    try {
      // Request permissions
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Microphone permission not granted');
      }

      // Configure audio recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      // Start recording
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(
        Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY
      );
      
      await recording.startAsync();
      
      // Record for specified duration
      await new Promise(resolve => setTimeout(resolve, duration));
      
      // Stop recording
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      return {
        uri,
        duration,
        file: recording
      };
    } catch (error) {
      console.error('Recording error:', error);
      throw error;
    }
  }

  static async extractMFCC(audioUri) {
    // Extract MFCC features from audio
    // This is a simplified version - you need actual MFCC extraction
    
    // For now, we'll use a mock implementation
    // In production, use a library like `essentia.js` or implement MFCC
    
    // Return 40 MFCC features (as in your Python code)
    const mockMFCC = Array(40).fill(0).map(() => Math.random() * 2 - 1);
    return mockMFCC;
  }
}

export default AudioProcessor;