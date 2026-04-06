// ============================================================
// Firebase Configuration
// ============================================================
// IMPORTANT: Replace the values below with your own Firebase
// project configuration. You can find these in the Firebase
// Console → Project Settings → Your Apps → Web App.
// ============================================================

const firebaseConfig = {
  apiKey:            "AIzaSyARp1oel-LqX8741QX1XTACUvgB6zjzKxg",
  authDomain:        "registre-carnaval.firebaseapp.com",
  projectId:         "registre-carnaval",
  storageBucket:     "registre-carnaval.firebasestorage.app",
  messagingSenderId: "241720119319",
  appId:             "1:241720119319:web:77ea0d21f01d9931facc52",
  measurementId:     "G-780B8RC6N1"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
const storage = firebase.storage();
