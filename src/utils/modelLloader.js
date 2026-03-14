// src/utils/modelLoader.js
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import { bundleResourceIO } from '@tensorflow/tfjs-react-native';
import labels from '../../assets/models/labels.json'; // Your JSON file

class VoiceModelLoader {
  constructor() {
    this.model = null;
    this.isLoaded = false;
    this.labels = labels; // Your command labels
  }

  async loadModel() {
    try {
      // Initialize TensorFlow
      await tf.ready();
      
      // Load your TFLite model
      const modelJson = require('../../assets/models/model.json'); // If you have metadata
      const modelWeights = require('../../assets/models/group1-shard1of1.bin');
      
      this.model = await tf.loadLayersModel(
        bundleResourceIO(modelJson, modelWeights)
      );
      
      // Alternative: For TFLite (if using react-native-tflite)
      // this.model = await TFLite.loadModel(
      //   require('../../assets/models/commands.tflite')
      // );
      
      this.isLoaded = true;
      console.log('Voice model loaded successfully');
      return true;
    } catch (error) {
      console.error('Failed to load voice model:', error);
      return false;
    }
  }

  async predict(audioFeatures) {
    if (!this.isLoaded || !this.model) {
      throw new Error('Model not loaded');
    }

    try {
      // Convert audio features to tensor
      const inputTensor = tf.tensor2d([audioFeatures]);
      
      // Make prediction
      const prediction = this.model.predict(inputTensor);
      const results = await prediction.data();
      
      // Get highest confidence command
      const maxIndex = results.indexOf(Math.max(...results));
      const confidence = results[maxIndex];
      const command = this.labels[maxIndex];
      
      // Cleanup
      inputTensor.dispose();
      prediction.dispose();
      
      return {
        command,
        confidence,
        allPredictions: results
      };
    } catch (error) {
      console.error('Prediction error:', error);
      throw error;
    }
  }
}

export default new VoiceModelLoader();