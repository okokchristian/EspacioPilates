import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const seccionLogin = document.getElementById("login");
const seccionPanel = document.getElementById("panel");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const inputFecha = document.getElementById("panel-fecha");
const contenido = document.getElementById("panel-contenido");

// ---------- Fecha de hoy en formato "2026-10-13" ----------
function hoyClave() {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

// ---------- Mostrar login o panel según haya sesión ----------
onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    seccionLogin.hidden = false;
    seccionPanel.hidden = true;
    return;
  }

  // ¿Este usuario es administrador? (tiene un documento en "admins")
  const adminDoc = await getDoc(doc(db, "admins", usuario.uid));
  if (!adminDoc.exists()) {
    await signOut(auth);
    loginError.textContent = "Esta cuenta no tiene acceso al panel.";
    return;
  }

  seccionLogin.hidden = true;
  seccionPanel.hidden = false;
  document.getElementById("panel-usuario").textContent =
    `Sesión iniciada como ${usuario.email}`;

  inputFecha.value = hoyClave();
  cargarReservas(inputFecha.value);
});

// ---------- Traer las reservas de una fecha ----------
async function cargarReservas(fechaClave) {
  contenido.textContent = "Cargando reservas...";

  try {
    const consulta = query(collection(db, "reservas"), where("fecha", "==", fechaClave));
    const snapshot = await getDocs(consulta);
    const reservas = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    pintarReservas(reservas);
  } catch (error) {
    contenido.textContent = "No se pudieron cargar las reservas.";
    console.error(error);
  }
}

// ---------- Mostrar las reservas agrupadas por horario ----------
function pintarReservas(reservas) {
  contenido.innerHTML = "";

  if (reservas.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "panel-vacio";
    vacio.textContent = "No hay reservas para este día.";
    contenido.appendChild(vacio);
    return;
  }

  // Agrupar: { "11:00": [reserva, reserva], "12:00": [...] }
  const porHora = {};
  reservas.forEach((r) => {
    if (!porHora[r.hora]) porHora[r.hora] = [];
    porHora[r.hora].push(r);
  });

  Object.keys(porHora).sort().forEach((hora) => {
    const lista = porHora[hora].sort((a, b) => a.apellido.localeCompare(b.apellido));

    const bloque = document.createElement("section");
    bloque.className = "panel-clase";

    const titulo = document.createElement("h2");
    titulo.textContent = `${hora} · ${lista.length} ${lista.length === 1 ? "reserva" : "reservas"}`;
    bloque.appendChild(titulo);

    const ul = document.createElement("ul");
    lista.forEach((r) => {
      const li = document.createElement("li");
      li.className = "panel-reserva";

      const nombre = document.createElement("strong");
      nombre.textContent = `${r.nombre} ${r.apellido}`;

      const contacto = document.createElement("span");
      contacto.textContent = `${r.telefono} · ${r.email}`;

      li.append(nombre, contacto);
      ul.appendChild(li);
    });

    bloque.appendChild(ul);
    contenido.appendChild(bloque);
  });
}

// ---------- Cambiar de día ----------
inputFecha.addEventListener("change", () => {
  if (inputFecha.value) cargarReservas(inputFecha.value);
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