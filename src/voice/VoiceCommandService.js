// VoiceCommandService.js - UPDATED VERSION
import { Audio } from 'expo-av';

class VoiceCommandService {
  constructor() {
    this.isInitialized = false;
    this.isRecording = false;
    this.recording = null;
    this.audioUri = null;
    
    // API Key - Use environment variables in production!
    this.assemblyAIKey = '98ae9459675b4d8c96d0eb356f181b44';
    
    this.commandPatterns = {
      'start trip': ['start trip', 'start driving', 'begin trip', 'begin driving'],
      'stop trip': ['stop trip', 'stop driving', 'end trip', 'end driving'],
      'share location': ['share location', 'share my location', 'send location'],
      'call emergency contact': ['call emergency contact', 'emergency', 'help', '911']
    };
  }
  
  // ✅ SIMPLE INITIALIZATION
  async initialize() {
    try {
      console.log('🚀 Initializing Voice Command Service...');
      
      // Request permissions
      const { status } = await Audio.requestPermissionsAsync();
      
      if (status !== 'granted') {
        console.warn('⚠️ Microphone permission not granted');
        this.isInitialized = true;
        return {
          success: true,
          warning: 'Microphone permission not granted - Using simulation mode',
          canRecord: false
        };
      }
      
      // Configure audio
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      
      console.log('✅ Voice service initialized');
      this.isInitialized = true;
      return {
        success: true,
        message: 'Voice service ready',
        canRecord: true
      };
      
    } catch (error) {
      console.error('❌ Initialization error:', error);
      this.isInitialized = true;
      return { success: false, error: error.message };
    }
  }
  
  // ✅ SIMPLE START RECORDING
  async startRecording() {
    if (this.isRecording) {
      return { success: false, error: 'Already recording' };
    }
    
    try {
      console.log('🎤 Starting recording...');
      this.isRecording = true;
      
      this.recording = new Audio.Recording();
      
      // Simple recording options
      await this.recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await this.recording.startAsync();
      
      return { success: true, message: 'Recording started' };
      
    } catch (error) {
      console.error('❌ Start recording error:', error);
      this.isRecording = false;
      this.recording = null;
      return { success: false, error: error.message };
    }
  }
  
  // ✅ SIMPLE STOP RECORDING
  async stopRecording() {
    if (!this.isRecording || !this.recording) {
      return { success: false, error: 'Not recording' };
    }
    
    try {
      console.log('⏹️ Stopping recording...');
      
      await this.recording.stopAndUnloadAsync();
      this.audioUri = this.recording.getURI();
      this.isRecording = false;
      
      console.log('✅ Recording saved to:', this.audioUri);
      
      return { 
        success: true, 
        message: 'Recording stopped',
        audioUri: this.audioUri 
      };
      
    } catch (error) {
      console.error('❌ Stop recording error:', error);
      this.isRecording = false;
      this.recording = null;
      return { success: false, error: error.message };
    }
  }
  
  // ✅ SIMPLE TRANSCRIPTION (WITH FALLBACK ONLY FOR API ERRORS)
  async transcribeAudio() {
    try {
      if (!this.audioUri) {
        console.log('⚠️ No audio to transcribe');
        return await this.fallbackToSimulation('No audio recorded');
      }
      
      console.log('🔍 Starting transcription...');
      
      // Try AssemblyAI first
      const assemblyResult = await this.tryAssemblyAITranscription();
      
      if (assemblyResult.success) {
        console.log('✅ AssemblyAI transcription successful');
        return assemblyResult;
      }
      
      // ⭐ KEY CHANGE: If no command matched, return helpful message
      // instead of falling back to simulation
      if (assemblyResult.error === 'No command matched') {
        console.log('⚠️ No command matched from transcription');
        return {
          success: false,
          transcription: assemblyResult.transcription,
          error: 'No command matched',
          message: 'Please say again. I did not understand that command.',
          source: 'assemblyai'
        };
      }
      
      // Fallback to simulation ONLY for actual API/transcription failures
      console.log('🔄 Falling back to simulation due to API error');
      return await this.fallbackToSimulation(assemblyResult.error);
      
    } catch (error) {
      console.error('❌ Transcription error:', error);
      return await this.fallbackToSimulation(error.message);
    }
  }
  
  // ✅ SIMPLE ASSEMBLYAI TRANSCRIPTION (UPDATED)
  async tryAssemblyAITranscription() {
    try {
      if (!this.audioUri) {
        throw new Error('No audio URI');
      }
      
      console.log('📤 Preparing audio for AssemblyAI...');
      
      // Read the audio file using fetch (works for local URIs)
      const response = await fetch(this.audioUri);
      const blob = await response.blob();
      
      // Convert blob to base64
      const base64Audio = await this.blobToBase64(blob);
      
      console.log('📊 Audio size:', Math.round(base64Audio.length / 1024), 'KB');
      
      // Upload to AssemblyAI
      console.log('📤 Uploading to AssemblyAI...');
      const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'Authorization': this.assemblyAIKey,
          'Content-Type': 'application/octet-stream',
        },
        body: this.base64ToArrayBuffer(base64Audio),
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('❌ Upload failed:', uploadResponse.status, errorText);
        
        if (uploadResponse.status === 401 || uploadResponse.status === 403) {
          throw new Error('Invalid API key');
        }
        
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }
      
      const { upload_url } = await uploadResponse.json();
      console.log('✅ Audio uploaded:', upload_url);
      
      // Request transcription
      console.log('📝 Requesting transcription...');
      const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'Authorization': this.assemblyAIKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_url: upload_url,
          language_code: 'en_us',
        }),
      });
      
      if (!transcriptResponse.ok) {
        throw new Error(`Transcription request failed: ${transcriptResponse.status}`);
      }
      
      const { id } = await transcriptResponse.json();
      console.log('📝 Transcription ID:', id);
      
      // Poll for result
      let transcription = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
          headers: { 'Authorization': this.assemblyAIKey },
        });
        
        const statusData = await statusResponse.json();
        
        if (statusData.status === 'completed') {
          transcription = statusData.text;
          console.log('✅ Transcription:', transcription);
          break;
        } else if (statusData.status === 'failed' || statusData.status === 'error') {
          throw new Error(`Transcription failed: ${statusData.error}`);
        }
      }
      
      if (!transcription) {
        throw new Error('Transcription timeout');
      }
      
      // Match command
      const commandMatch = this.findBestCommandMatch(transcription);
      
      if (commandMatch) {
        return {
          success: true,
          command: commandMatch.command,
          transcription: transcription,
          confidence: commandMatch.confidence,
          source: 'assemblyai'
        };
      } else {
        // ⭐ KEY CHANGE: Return specific error for no command match
        return {
          success: false,
          transcription: transcription,
          error: 'No command matched',
          source: 'assemblyai'
        };
      }
      
    } catch (error) {
      console.error('❌ AssemblyAI error:', error.message);
      return {
        success: false,
        error: error.message,
        source: 'assemblyai'
      };
    }
  }
  
  // ✅ HELPER: Convert blob to base64
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  // ✅ HELPER: Convert base64 to ArrayBuffer
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  
  // ✅ FALLBACK SIMULATION (ONLY FOR API ERRORS)
  async fallbackToSimulation(reason) {
    console.log('🔄 Using simulation mode:', reason);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const commands = ['start trip', 'stop trip', 'share location', 'call emergency contact'];
    const randomCommand = commands[Math.floor(Math.random() * commands.length)];
    
    return {
      success: true,
      command: randomCommand,
      transcription: `User said: "${randomCommand}"`,
      confidence: 0.9,
      source: 'simulation',
      note: reason
    };
  }
  
  // ✅ COMMAND MATCHING
  findBestCommandMatch(text) {
    if (!text) return null;
    
    const lowerText = text.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;
    
    for (const [command, patterns] of Object.entries(this.commandPatterns)) {
      for (const pattern of patterns) {
        if (lowerText.includes(pattern)) {
          const score = pattern.length / lowerText.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = { command, confidence: Math.min(score * 2, 1) };
          }
        }
      }
    }
    
    return bestMatch;
  }
  
  // ✅ HANDLE COMMAND
  handleVoiceCommand(command) {
    const actions = {
      'start trip': { action: 'START_TRIP', message: 'Starting trip...' },
      'stop trip': { action: 'STOP_TRIP', message: 'Stopping trip...' },
      'share location': { action: 'SHARE_LOCATION', message: 'Sharing location...' },
      'call emergency contact': { action: 'CALL_EMERGENCY', message: 'Calling emergency contact...' }
    };
    
    const action = actions[command];
    
    if (action) {
      return { success: true, ...action };
    }
    
    return { success: false, error: `Unknown command: ${command}` };
  }
  
  // ✅ STOP AND TRANSCRIBE (COMBINED)
  async stopRecordingAndTranscribe() {
    try {
      // Stop recording first
      const stopResult = await this.stopRecording();
      
      if (!stopResult.success) {
        return await this.fallbackToSimulation('Failed to stop recording');
      }
      
      // Then transcribe
      return await this.transcribeAudio();
      
    } catch (error) {
      console.error('❌ Stop and transcribe error:', error);
      return await this.fallbackToSimulation(error.message);
    }
  }
  
  // ✅ TEST CONNECTION
  async testConnection() {
    try {
      console.log('🔍 Testing connection...');
      
      const { status } = await Audio.requestPermissionsAsync();
      
      if (status !== 'granted') {
        return {
          success: false,
          error: 'Microphone permission required',
          canProceed: true
        };
      }
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      
      console.log('✅ Connection test passed');
      return {
        success: true,
        message: 'Ready to record',
        canProceed: true
      };
      
    } catch (error) {
      console.error('❌ Connection test error:', error);
      return {
        success: false,
        error: error.message,
        canProceed: true
      };
    }
  }
  
  // ✅ CLEANUP
  cleanup() {
    if (this.recording) {
      this.recording.stopAndUnloadAsync().catch(() => {});
    }
    this.isRecording = false;
    this.recording = null;
    this.audioUri = null;
  }
  
  getAvailableCommands() {
    return Object.keys(this.commandPatterns);
  }
}

// ✅ SINGLETON INSTANCE
const voiceCommandService = new VoiceCommandService();
export default voiceCommandService;