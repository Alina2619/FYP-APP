// MFCC extraction utilities matching your training
export class AudioProcessor {
  static SAMPLE_RATE = 16000;
  static DURATION = 3.0;
  static N_MFCC = 40;
  
  // Resample audio to 16kHz
  static resampleAudio(audioData, originalRate) {
    const ratio = originalRate / this.SAMPLE_RATE;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);
    
    for (let i = 0; i < newLength; i++) {
      result[i] = audioData[Math.round(i * ratio)];
    }
    
    return result;
  }
  
  // Pad or truncate audio to 3 seconds (48000 samples)
  static normalizeLength(audioData) {
    const targetLength = this.SAMPLE_RATE * this.DURATION;
    
    if (audioData.length === targetLength) {
      return audioData;
    }
    
    const result = new Float32Array(targetLength);
    
    if (audioData.length > targetLength) {
      // Truncate
      for (let i = 0; i < targetLength; i++) {
        result[i] = audioData[i];
      }
    } else {
      // Pad with zeros
      for (let i = 0; i < audioData.length; i++) {
        result[i] = audioData[i];
      }
    }
    
    return result;
  }
  
  // Simplified MFCC extraction (you'll need to implement full MFCC)
  static extractMFCC(audioData) {
    // TODO: Implement full MFCC extraction
    // For now, return mock features matching your training shape
    const mfccFeatures = new Array(40).fill(0);
    
    // Calculate some basic features
    const frameSize = 512;
    const hopLength = 256;
    const numFrames = Math.floor((audioData.length - frameSize) / hopLength) + 1;
    
    for (let i = 0; i < numFrames; i++) {
      const start = i * hopLength;
      const frame = audioData.slice(start, start + frameSize);
      
      // Simplified feature calculation
      for (let j = 0; j < this.N_MFCC; j++) {
        mfccFeatures[j] += Math.abs(frame[j % frame.length]) / numFrames;
      }
    }
    
    return mfccFeatures;
  }
  
  // Convert MFCC features to Float32Array for model input
  static prepareModelInput(mfccFeatures) {
    return new Float32Array(mfccFeatures);
  }
}