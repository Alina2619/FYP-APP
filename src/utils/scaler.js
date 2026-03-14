// src/utils/scaler.js
import scalerInfo from '../models/scaler_info.json';

export class MinMaxScaler {
  constructor() {
    this.featureMins = scalerInfo.feature_mins || scalerInfo.data_min;
    this.featureMaxs = scalerInfo.feature_maxs || scalerInfo.data_max;
    this.featureNames = scalerInfo.feature_names;
    
    // Calculate ranges
    this.featureRanges = this.featureMins.map((min, i) => 
      this.featureMaxs[i] - min
    );
    
    // Avoid division by zero
    this.featureRanges = this.featureRanges.map(range => 
      range === 0 ? 1e-8 : range
    );
  }

  // Normalize a single feature vector [15 features]
  normalize(features) {
    if (features.length !== this.featureMins.length) {
      throw new Error(`Expected ${this.featureMins.length} features, got ${features.length}`);
    }
    
    return features.map((value, index) => {
      const normalized = (value - this.featureMins[index]) / this.featureRanges[index];
      // Clip to [0, 1] range
      return Math.max(0, Math.min(1, normalized));
    });
  }

  // Normalize a batch of feature vectors [[15 features], ...]
  normalizeBatch(batch) {
    return batch.map(features => this.normalize(features));
  }

  // Denormalize (if needed for debugging)
  denormalize(normalizedFeatures) {
    return normalizedFeatures.map((value, index) => {
      return value * this.featureRanges[index] + this.featureMins[index];
    });
  }
}

// Create singleton instance
export const scaler = new MinMaxScaler();