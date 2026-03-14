import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Footer from '../Components/Footer';

export default function ResetLinkSentScreen({ route, navigation }) {
  const { email } = route.params;

  const maskEmail = (email) => {
    if (!email) return '';
    const [local, domain] = email.split('@');
    const visiblePart = local.slice(0, 3);
    return `${visiblePart}***@${domain}`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerWrapper}>
        <Text style={styles.title}>Reset Link Sent</Text>
        <Text style={styles.subTitle}>Check your email for the link</Text>
        <Text style={styles.smallText}>It may take a few minutes to arrive</Text>
      </View>

      {/* Body */}
      <View style={styles.formContainer}>
        <Text style={styles.label}>We’ve sent a reset link to:</Text>
        <Text style={styles.email}>{maskEmail(email)}</Text>
        <Text style={styles.note}>
          Please check your inbox and follow the instructions to reset your password.
        </Text>

        {/* Login link grouped here */}
        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.loginLink}>
            Changed Password Successfully? <Text style={styles.loginText}>Login</Text>
          </Text>
        </TouchableOpacity>
      </View>

      {/* Footer fixed */}
      <View style={styles.footerFixed}>
        <Footer />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  headerWrapper: {
    paddingTop: 60,
    paddingBottom: 20,
    alignItems: 'center',
    backgroundColor: '#1d807c',
    borderBottomLeftRadius: 80,
    borderBottomRightRadius: 80,
  },

  title: { fontSize: 34, fontWeight: 'bold', color: '#fff' },
  subTitle: { fontSize: 20, color: '#fff', marginTop: 8 },
  smallText: { fontSize: 16, color: '#fff', marginTop: 6, textDecorationLine: 'underline' },

  formContainer: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },

  label: { fontSize: 16, marginBottom: 8, color: '#333', textAlign: 'center' },
  email: { fontSize: 18, fontWeight: '600', marginBottom: 20, color: '#1d807c', textAlign: 'center' },
  note: { fontSize: 14, color: '#555', lineHeight: 20, textAlign: 'center', maxWidth: 300 },

  loginLink: { 
    textAlign: 'center',
    color: '#444',
    fontSize: 16,
    marginTop: 30,
  },
  loginText: { 
    fontWeight: 'bold', 
    color: '#e91e63',
  },

  footerFixed: {
    position: 'absolute',
    left: 0, 
    right: 0, 
    bottom: 0,
    backgroundColor: '#fff',
  },
});
