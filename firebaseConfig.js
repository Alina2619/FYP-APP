
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";


const firebaseConfig = {
  apiKey: "AIzaSyA2JGRN-HgcbNgJX0jeDLPPgjeWFORjX0g",
  authDomain: "drivemateapp-89f62.firebaseapp.com",
  projectId: "drivemateapp-89f62",
  storageBucket: "drivemateapp-89f62.appspot.com",
  messagingSenderId: "724130550626",
  appId: "1:724130550626:web:50b002af14248f1072123b"
};


let app;
let auth;
let db;
let storage;

try {
  const apps = getApps();
  console.log(`Found ${apps.length} Firebase apps`);
  
  if (apps.length === 0) {

    app = initializeApp(firebaseConfig);
    console.log('✅ Firebase initialized successfully');
  } else {

    app = getApp();
    console.log('✅ Using existing Firebase app:', app.name);
 
    if (app.name !== '[DEFAULT]') {
      console.log('Creating secondary Firebase app');
      app = initializeApp(firebaseConfig, 'DriveMateSecondary');
    }
  }

  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);

} catch (error) {
  console.error(' Firebase initialization error:', error.message);

  try {
    app = initializeApp(firebaseConfig, 'DriveMateFallback_' + Date.now());
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    console.log('Firebase initialized with fallback name');
  } catch (fallbackError) {
    console.error(' Fallback initialization failed:', fallbackError);
    throw fallbackError;
  }
}


export { auth };

export { db };


export { storage };

export default app;