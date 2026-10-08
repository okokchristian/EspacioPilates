import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const seccionLogin = document.getElementById("login");
const seccionPanel = document.getElementById("panel");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

// ---------- Mostrar login o panel según haya sesión ----------
// Firebase avisa cada vez que alguien entra o sale (y al cargar la página)
onAuthStateChanged(auth, (usuario) => {
  if (usuario) {
    seccionLogin.hidden = true;
    seccionPanel.hidden = false;
    document.getElementById("panel-usuario").textContent =
      `Sesión iniciada como ${usuario.email}`;
  } else {
    seccionLogin.hidden = false;
    seccionPanel.hidden = true;
  }
});

// ---------- Iniciar sesión ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const boton = loginForm.querySelector("button[type='submit']");

  boton.disabled = true;
  boton.textContent = "Ingresando...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginForm.reset();
  } catch (error) {
    loginError.textContent = "Email o contraseña incorrectos.";
    console.error(error);
  } finally {
    boton.disabled = false;
    boton.textContent = "Ingresar";
  }
});

// ---------- Cerrar sesión ----------
document.getElementById("btn-salir").addEventListener("click", () => {
  signOut(auth);
});