// components/Footer.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const Footer = () => {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>© 2025 DriveMate. All rights reserved.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {
    backgroundColor: '#1d807c',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 65,
  },
  footerText: {
    color: '#fff',
    fontSize: 14,
  },
});

export default Footer;
