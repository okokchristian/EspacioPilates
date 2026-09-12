import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  runTransaction,
  addDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyH4y4NqMM-U-taekGdSGoh1pFhCG6bdc",
  authDomain: "espaciopilates-9290c.firebaseapp.com",
  projectId: "espaciopilates-9290c",
  storageBucket: "espaciopilates-9290c.firebasestorage.app",
  messagingSenderId: "431225733354",
  appId: "1:431225733354:web:105cbd82b1a444365b9793"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ordenDias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
let turnoSeleccionado = null;
let turnosPorDia = {};

function getEstadoSpots(libres) {
  if (libres <= 0) return { clase: "full", texto: "Completo" };
  if (libres <= 2) return { clase: "low", texto: libres === 1 ? "1 lugar" : `${libres} lugares` };
  return { clase: "open", texto: `${libres} lugares` };
}

async function cargarTurnos() {
  const tabsContainer = document.getElementById("agenda-tabs");
  const horariosContainer = document.getElementById("agenda-horarios");
  horariosContainer.innerHTML = "<p>Cargando turnos...</p>";

  try {
    const snapshot = await getDocs(collection(db, "turnos"));
    turnosPorDia = {};

    snapshot.forEach((docSnap) => {
      const turno = { id: docSnap.id, ...docSnap.data() };
      const dia = turno.día;
      if (!turnosPorDia[dia]) turnosPorDia[dia] = [];
      turnosPorDia[dia].push(turno);
    });

    Object.keys(turnosPorDia).forEach((dia) => {
      turnosPorDia[dia].sort((a, b) => a.hora.localeCompare(b.hora));
    });

    tabsContainer.innerHTML = "";
    const diasDisponibles = ordenDias.filter((d) => turnosPorDia[d]);

    diasDisponibles.forEach((dia, index) => {
      const tab = document.createElement("button");
      tab.className = `agenda-tab ${index === 0 ? "active" : ""}`;
      tab.textContent = dia;
      tab.addEventListener("click", () => {
        document.querySelectorAll(".agenda-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        pintarHorariosDia(dia);
      });
      tabsContainer.appendChild(tab);
    });

    if (diasDisponibles.length > 0) {
      pintarHorariosDia(diasDisponibles[0]);
    } else {
      horariosContainer.innerHTML = "<p>No hay turnos cargados.</p>";
    }
  } catch (error) {
    horariosContainer.innerHTML = "<p>No se pudieron cargar los turnos. Intentá recargar la página.</p>";
    console.error("Error cargando turnos:", error);
  }
}

function pintarHorariosDia(dia) {
  const horariosContainer = document.getElementById("agenda-horarios");
  horariosContainer.innerHTML = "";

  turnosPorDia[dia].forEach((turno) => {
    const libres = turno.cupoMaximo - turno.reservados;
    const estado = getEstadoSpots(libres);

    const item = document.createElement("div");
    item.className = "horario-item";
    item.innerHTML = `
      <span class="time">${turno.hora}</span>
      <span class="spots ${estado.clase}">${estado.texto}</span>
    `;
    horariosContainer.appendChild(item);
  });
}

let turnosPorDiaModal = {};

async function cargarTurnosModal() {
  const tabsContainer = document.getElementById("modal-tabs");
  const lista = document.getElementById("modal-turnos-list");
  lista.innerHTML = "<p>Cargando turnos...</p>";

  try {
    const snapshot = await getDocs(collection(db, "turnos"));
    turnosPorDiaModal = {};

    snapshot.forEach((docSnap) => {
      const turno = { id: docSnap.id, ...docSnap.data() };
      const dia = turno.día;
      if (!turnosPorDiaModal[dia]) turnosPorDiaModal[dia] = [];
      turnosPorDiaModal[dia].push(turno);
    });

    Object.keys(turnosPorDiaModal).forEach((dia) => {
      turnosPorDiaModal[dia].sort((a, b) => a.hora.localeCompare(b.hora));
    });

    tabsContainer.innerHTML = "";
    const diasDisponibles = ordenDias.filter((d) => turnosPorDiaModal[d]);

    diasDisponibles.forEach((dia, index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `modal-tab ${index === 0 ? "active" : ""}`;
      tab.textContent = dia;
      tab.addEventListener("click", () => {
        document.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        pintarTurnosModalDia(dia);
      });
      tabsContainer.appendChild(tab);
    });

    if (diasDisponibles.length > 0) {
      pintarTurnosModalDia(diasDisponibles[0]);
    } else {
      lista.innerHTML = "<p>No hay turnos cargados.</p>";
    }
  } catch (error) {
    lista.innerHTML = "<p>No se pudieron cargar los turnos.</p>";
    console.error("Error cargando turnos en modal:", error);
  }
}

function pintarTurnosModalDia(dia) {
  const lista = document.getElementById("modal-turnos-list");
  lista.innerHTML = "";

  turnosPorDiaModal[dia].forEach((turno) => {
    const libres = turno.cupoMaximo - turno.reservados;
    const estado = getEstadoSpots(libres);
    const completo = libres <= 0;

    const item = document.createElement("div");
    item.className = `modal-turno-item ${completo ? "disabled" : ""}`;
    item.innerHTML = `
      <span class="modal-turno-info">${turno.hora}</span>
      <span class="spots ${estado.clase}">${estado.texto}</span>
    `;

    if (!completo) {
      item.addEventListener("click", () => {
        turnoSeleccionado = turno;
        mostrarPasoForm();
      });
    }

    lista.appendChild(item);
  });
}

function mostrarPasoTurnos() {
  document.getElementById("modal-step-turnos").style.display = "block";
  document.getElementById("modal-step-form").style.display = "none";
  document.getElementById("modal-step-exito").style.display = "none";
}

function mostrarPasoForm() {
  document.getElementById("modal-step-turnos").style.display = "none";
  document.getElementById("modal-step-form").style.display = "block";
  document.getElementById("modal-step-exito").style.display = "none";
  document.getElementById("modal-turno-elegido").textContent =
    `${turnoSeleccionado.día} — ${turnoSeleccionado.hora}`;
}

function mostrarPasoExito() {
  document.getElementById("modal-step-turnos").style.display = "none";
  document.getElementById("modal-step-form").style.display = "none";
  document.getElementById("modal-step-exito").style.display = "block";
}

function abrirModal() {
  document.getElementById("modal-overlay").classList.add("open");
  mostrarPasoTurnos();
  cargarTurnosModal();
}

function cerrarModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.getElementById("reserva-form").reset();
  turnoSeleccionado = null;
}

async function confirmarReserva(datosPersona) {
  const turnoRef = doc(db, "turnos", turnoSeleccionado.id);

  await runTransaction(db, async (transaction) => {
    const turnoDoc = await transaction.get(turnoRef);
    if (!turnoDoc.exists()) throw new Error("El turno ya no existe.");

    const data = turnoDoc.data();
    if (data.reservados >= data.cupoMaximo) {
      throw new Error("Este turno ya no tiene lugares disponibles.");
    }

    transaction.update(turnoRef, { reservados: data.reservados + 1 });
  });

  await addDoc(collection(db, "reservas"), {
    turnoId: turnoSeleccionado.id,
    día: turnoSeleccionado.día,
    hora: turnoSeleccionado.hora,
    nombre: datosPersona.nombre,
    apellido: datosPersona.apellido,
    email: datosPersona.email,
    telefono: datosPersona.telefono,
    creado: new Date().toISOString()
  });
}

document.addEventListener("DOMContentLoaded", () => {
  cargarTurnos();

  document.querySelectorAll(".open-reserva-modal").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      abrirModal();
    });
  });

  document.getElementById("modal-close").addEventListener("click", cerrarModal);
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") cerrarModal();
  });

  document.getElementById("btn-volver-turnos").addEventListener("click", mostrarPasoTurnos);

  document.getElementById("btn-cerrar-exito").addEventListener("click", () => {
    cerrarModal();
    cargarTurnos();
  });

  document.getElementById("reserva-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const datosPersona = {
      nombre: document.getElementById("input-nombre").value.trim(),
      apellido: document.getElementById("input-apellido").value.trim(),
      email: document.getElementById("input-email").value.trim(),
      telefono: document.getElementById("input-telefono").value.trim()
    };

    const submitBtn = e.target.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Reservando...";

    try {
      await confirmarReserva(datosPersona);
      mostrarPasoExito();
    } catch (error) {
      alert(error.message || "Hubo un error al confirmar la reserva. Intentá de nuevo.");
      console.error(error);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirmar reserva";
    }
  });
});