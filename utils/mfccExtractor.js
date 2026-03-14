// utils/mfccExtractor.js
export const extractMFCC = async (audioData, sampleRate = 16000) => {
  // Your training used: librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=40)
  // Then: np.mean(mfcc.T, axis=0) - average across time
  
  // Simplified implementation - you may need a proper MFCC library
  const mfccFeatures = extractMFCCFeatures(audioData, sampleRate);
  
  // Ensure we return 40 features as your model expects
  if (mfccFeatures.length > 40) {
    return mfccFeatures.slice(0, 40);
  } else if (mfccFeatures.length < 40) {
    return [...mfccFeatures, ...new Array(40 - mfccFeatures.length).fill(0)];
  }
  
  return mfccFeatures;
};