// src/utils/config.js
import modelConfig from '../models/model_config.json';
import labels from '../models/activity_labels.json';

export const config = {
  ...modelConfig,
  labels: labels
};

// Helper to get activity name from class index
export const getActivityName = (classIndex) => {
  return labels[classIndex] || `Unknown (${classIndex})`;
};

// Get feature order (IMPORTANT: must match training)
export const getFeatureOrder = () => {
  return modelConfig.feature_order || modelConfig.feature_columns;
};