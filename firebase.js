import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyH4y4NqMM-U-taekGdSGoh1pFhCG6bdc",
  authDomain: "espaciopilates-9290c.firebaseapp.com",
  projectId: "espaciopilates-9290c",
  storageBucket: "espaciopilates-9290c.firebasestorage.app",
  messagingSenderId: "431225733354",
  appId: "1:431225733354:web:105cbd82b1a444365b9793"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);