import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

export default function WelcomeScreen({ navigation }) {
  const fadeAnim = new Animated.Value(0);
  const logoScale = new Animated.Value(0.5);
  const textSlide = new Animated.Value(50);
  const bgPan = new Animated.Value(0);

  useEffect(() => {

    Animated.loop(
      Animated.timing(bgPan, {
        toValue: 1,
        duration: 15000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

  
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(textSlide, {
        toValue: 0,
        duration: 1000,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      })
    ]).start();

    const timer = setTimeout(() => {
      navigation.replace('SignUp');
    }, 3000);
    
    return () => clearTimeout(timer);
  }, []);

  const bgInterpolate = bgPan.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  const animatedBgStyle = {
    transform: [
      { 
        rotate: bgInterpolate
      }
    ]
  };

  return (
    <View style={styles.container}>
     
      <Animated.View style={[styles.backgroundCircle1, animatedBgStyle]} />
      <Animated.View style={[styles.backgroundCircle2, animatedBgStyle]} />
      <Animated.View style={[styles.backgroundCircle3, animatedBgStyle]} />
      
      <View style={styles.content}>
        <Animated.View style={[
          styles.logoContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: logoScale }]
          }
        ]}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>
        
        <Animated.Text style={[
          styles.titleText,
          {
            opacity: fadeAnim,
            transform: [{ translateY: textSlide }]
          }
        ]}>
          DriveMate AI
        </Animated.Text>
        
        <Animated.Text style={[
          styles.taglineText, 
          {
            opacity: fadeAnim,
            transform: [{ translateY: textSlide }]
          }
        ]}>
          Guardian AI For Every Mile
        </Animated.Text>
        
        <Animated.View style={[
          styles.welcomeContainer,
          {
            opacity: fadeAnim,
          }
        ]}>
          <Text style={styles.welcomeText}>
            Welcome To The App
          </Text>
        </Animated.View>
        
        <View style={styles.progressContainer}>
          <Animated.View style={[
            styles.progressBar,
            {
              transform: [{
                scaleX: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1]
                })
              }]
            }
          ]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 10,
  },

  backgroundCircle1: {
    position: 'absolute',
    width: width * 1.5,
    height: width * 1.5,
    borderRadius: width * 0.75,
    backgroundColor: 'rgba(29, 128, 124, 0.15)', 
    top: -width * 0.5,
    left: -width * 0.3,
  },
  backgroundCircle2: {
    position: 'absolute',
    width: width * 1.2,
    height: width * 1.2,
    borderRadius: width * 0.6,
    backgroundColor: 'rgba(29, 128, 124, 0.12)',
    bottom: -width * 0.4,
    right: -width * 0.2,
  },
  backgroundCircle3: {
    position: 'absolute',
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: 'rgba(29, 128, 124, 0.1)', 
    top: height * 0.3,
    left: -width * 0.2,
  },
  logoContainer: {
    marginBottom: 20,
    shadowColor: '#1d807c',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 10,
  },
  logo: {
    width: 220,
    height: 220,
  },
  titleText: {
    color: '#1d807c',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 8,
    textShadowColor: 'rgba(29, 128, 124, 0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    letterSpacing: 0.5,
  },

  taglineText: {
    color: '#ff4b94',
    fontSize: 16,
    marginBottom: 30,
    fontWeight: '600',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(255, 75, 148, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  welcomeContainer: {
    backgroundColor: 'rgba(29, 128, 124, 0.1)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    marginBottom: 40,
  },
  welcomeText: {
    color: '#1d807c',
    fontSize: 18,
    fontWeight: '600',
  },
  progressContainer: {
    width: '60%',
    height: 6,
    backgroundColor: 'rgba(29, 128, 124, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#1d807c',
    borderRadius: 3,
    transformOrigin: 'left',
  },
});