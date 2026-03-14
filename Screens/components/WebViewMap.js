import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';

const WebViewMap = ({
  userLocation,
  routeCoordinates = [],
  onMapReady,
  followsUserLocation = false,
  style = {},
}) => {
  const webViewRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mapError, setMapError] = useState(null);

  // Generate HTML for the map
  const getMapHTML = () => {
    const centerLat = userLocation?.latitude || 31.5204;
    const centerLng = userLocation?.longitude || 74.3587;

    // Convert route coordinates to JavaScript array
    const routePoints = routeCoordinates
      .map(p => `[${p.latitude}, ${p.longitude}]`)
      .join(',');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #f5f5f5;
            overflow: hidden;
          }
          #map {
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            right: 0;
            width: 100%;
            height: 100%;
            background: #f0f0f0;
          }
          .custom-marker {
            background: white;
            border: 3px solid #1d807c;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .custom-marker::after {
            content: '';
            width: 12px;
            height: 12px;
            background: #1d807c;
            border-radius: 50%;
          }
          .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255,255,255,0.9);
            padding: 10px 20px;
            border-radius: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
          }
          .accuracy-circle {
            stroke: rgba(29, 128, 124, 0.2);
            stroke-width: 2;
            fill: rgba(29, 128, 124, 0.1);
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        
        <script>
          try {
            // Initialize map
            var map = L.map('map', {
              center: [${centerLat}, ${centerLng}],
              zoom: 16,
              zoomControl: false,
              attributionControl: true
            });

            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap contributors',
              maxZoom: 19,
              minZoom: 3
            }).addTo(map);

            // Add zoom control
            L.control.zoom({
              position: 'bottomright'
            }).addTo(map);

            ${userLocation ? `
              // Add user location marker
              var marker = L.marker([${userLocation.latitude}, ${userLocation.longitude}], {
                icon: L.divIcon({
                  className: 'custom-marker',
                  iconSize: [24, 24],
                  popupAnchor: [0, -12]
                })
              }).addTo(map);
              
              marker.bindPopup('<b>You are here</b><br>Current location').openPopup();
              
              // Add accuracy circle if available
              ${userLocation.accuracy ? `
                var circle = L.circle([${userLocation.latitude}, ${userLocation.longitude}], {
                  radius: ${userLocation.accuracy},
                  color: '#1d807c',
                  weight: 1,
                  fillColor: 'rgba(29, 128, 124, 0.1)',
                  fillOpacity: 0.2
                }).addTo(map);
              ` : ''}
            ` : ''}

            ${routeCoordinates.length > 1 ? `
              // Add route polyline
              var routePoints = [${routePoints}];
              var polyline = L.polyline(routePoints, {
                color: '#1d807c',
                weight: 4,
                opacity: 0.8,
                lineJoin: 'round'
              }).addTo(map);
              
              // Fit bounds to show entire route if we have multiple points
              if (routePoints.length > 1) {
                map.fitBounds(polyline.getBounds(), {
                  padding: [50, 50],
                  maxZoom: 16
                });
              }
            ` : ''}

            // Send ready message to React Native
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MAP_READY',
              bounds: map.getBounds()
            }));

            // Handle location updates (for future use)
            window.updateLocation = function(lat, lng) {
              if (map) {
                map.setView([lat, lng], 16);
                if (marker) {
                  marker.setLatLng([lat, lng]);
                }
              }
            };

          } catch (error) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MAP_ERROR',
              error: error.toString()
            }));
          }
        </script>
      </body>
      </html>
    `;
  };

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setIsLoading(false);
        setMapError(null);
        if (onMapReady) onMapReady();
      } else if (data.type === 'MAP_ERROR') {
        setMapError(data.error);
        setIsLoading(false);
      }
    } catch (e) {
      console.log('WebView message error:', e);
    }
  };

  const handleError = (error) => {
    console.error('WebView error:', error);
    setMapError('Failed to load map. Please check your internet connection.');
    setIsLoading(false);
  };

  // Update location when userLocation changes and followsUserLocation is true
  useEffect(() => {
    if (followsUserLocation && userLocation && webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (typeof updateLocation === 'function') {
          updateLocation(${userLocation.latitude}, ${userLocation.longitude});
        }
        true;
      `);
    }
  }, [userLocation, followsUserLocation]);

  if (mapError) {
    return (
      <View style={[styles.container, styles.errorContainer, style]}>
        <Text style={styles.errorText}>🗺️ {mapError}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        source={{ html: getMapHTML() }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scrollEnabled={false}
        onMessage={handleMessage}
        onError={handleError}
        onHttpError={handleError}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1d807c" />
            <Text style={styles.loadingText}>Loading map...</Text>
          </View>
        )}
        cacheEnabled={true}
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        mixedContentMode="always"
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
      />
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1d807c" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#1d807c',
    fontWeight: '500',
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 14,
    color: '#e63946',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default WebViewMap;