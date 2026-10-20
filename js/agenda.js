import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let turnoSeleccionado = null;
let turnosPorDia = {}; // fuente única de datos, compartida entre agenda y modal
let cargaInicial = null; // promesa compartida de la primera consulta a Firestore
let ocupacion = {}; // cupos ocupados por fecha: { "2026-10-13_idTurno": 3 }
let bloqueos = new Set(); // fechas bloqueadas: "2026-12-25", ...
let fechaElegida = null; // día elegido en la agenda, ej: "2026-10-12"

function getEstadoSpots(libres) {
  if (libres <= 0) return { clase: "full", texto: "Completo" };
  if (libres <= 2) return { clase: "low", texto: libres === 1 ? "1 lugar" : `${libres} lugares` };
  return { clase: "open", texto: `${libres} lugares` };
}
// ---------- Fechas reales de los próximos días con clase ----------
const NOMBRES_DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Convierte una fecha en texto "2026-10-13" (para guardar y comparar)
function aClaveFecha(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

// ---------- Días bloqueados (feriados, vacaciones) ----------
async function cargarBloqueos() {
  bloqueos = new Set();

  const consulta = query(
    collection(db, "bloqueos"),
    where("fecha", ">=", aClaveFecha(new Date()))
  );

  const snapshot = await getDocs(consulta);
  snapshot.forEach((docSnap) => {
    bloqueos.add(docSnap.data().fecha);
  });
}

// Devuelve los próximos días que tienen clases (por defecto, 6: una semana)
function proximasFechas(cantidad = 6) {
  const fechas = [];
  const hoy = new Date();

  for (let i = 0; fechas.length < cantidad && i < 14; i++) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
    const nombre = NOMBRES_DIAS[fecha.getDay()];

        if (!turnosPorDia[nombre]) continue; // ese día no hay clases (domingo)

        const clave = aClaveFecha(fecha);
    if (bloqueos.has(clave)) continue;   // día bloqueado por el estudio

    // Hoy, si ya pasaron todas las clases, no lo mostramos
    if (i === 0 && turnosPorDia[nombre].every((turno) => yaPaso({ clave }, turno))) continue;
        fechas.push({
      clave,                                               // "2026-10-13"
      nombre,                                              // "Lunes"
      etiqueta: `${nombre.slice(0, 3)} ${fecha.getDate()}` // "Lun 13"
    });
  }

  return fechas;
}

// ---------- Ocupación por fecha ----------
// Trae de Firestore cuántos lugares están ocupados en cada clase de esas fechas
async function cargarOcupacion(fechas) {
  ocupacion = {};
  if (fechas.length === 0) return;

  const consulta = query(
    collection(db, "ocupacion"),
    where("fecha", ">=", fechas[0].clave),
    where("fecha", "<=", fechas[fechas.length - 1].clave)
  );

  const snapshot = await getDocs(consulta);
  snapshot.forEach((docSnap) => {
    ocupacion[docSnap.id] = docSnap.data().reservados || 0;
  });
}

// Cuántos lugares hay ocupados en una clase de una fecha concreta
function reservadosEn(fecha, turno) {
  return ocupacion[`${fecha.clave}_${turno.id}`] || 0;
}

// true si la clase es de hoy y su horario ya empezó
function yaPaso(fecha, turno) {
  const ahora = new Date();
  if (fecha.clave !== aClaveFecha(ahora)) return false;

  const [horas, minutos] = turno.hora.split(":").map(Number);
  return ahora.getHours() * 60 + ahora.getMinutes() >= horas * 60 + minutos;
}

// ---------- Cargar turnos desde Firestore (una sola fuente de verdad) ----------
async function cargarTurnosDesdeFirestore() {
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

  await cargarBloqueos();
  const fechas = proximasFechas();
  await cargarOcupacion(fechas);
}

// ---------- Pintar la agenda principal ----------
async function cargarTurnos() {
  const tabsContainer = document.getElementById("agenda-tabs");
  const horariosContainer = document.getElementById("agenda-horarios");
  horariosContainer.innerHTML = "<p>Cargando turnos...</p>";

  try {
    if (!cargaInicial) {
      cargaInicial = cargarTurnosDesdeFirestore();
    }
    await cargaInicial;

    tabsContainer.innerHTML = "";
    const fechas = proximasFechas();

    // Si ya había un día elegido y sigue disponible, lo mantenemos
    let indiceInicial = fechas.findIndex((f) => f.clave === fechaElegida);
    if (indiceInicial === -1) indiceInicial = 0;

    fechas.forEach((fecha, index) => {
      const tab = document.createElement("button");
      tab.className = `agenda-tab ${index === indiceInicial ? "active" : ""}`;
      tab.textContent = fecha.etiqueta;
      tab.addEventListener("click", () => {
        document.querySelectorAll(".agenda-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        fechaElegida = fecha.clave; // recordamos el día para el modal
        pintarHorariosDia(fecha);
      });
      tabsContainer.appendChild(tab);
    });

    if (fechas.length > 0) {
      pintarHorariosDia(fechas[indiceInicial]);
    } else {
      horariosContainer.innerHTML = "<p>No hay turnos cargados.</p>";
    }
  } catch (error) {
    horariosContainer.innerHTML = "<p>No se pudieron cargar los turnos. Intentá recargar la página.</p>";
      console.error("Error cargando turnos:", error);
  }
}

function pintarHorariosDia(fecha) {
  const horariosContainer = document.getElementById("agenda-horarios");
  horariosContainer.innerHTML = "";

  turnosPorDia[fecha.nombre].forEach((turno) => {
    const libres = turno.cupoMaximo - reservadosEn(fecha, turno);
    const estado = yaPaso(fecha, turno)
      ? { clase: "full", texto: "Finalizado" }
      : getEstadoSpots(libres);

    const item = document.createElement("div");
    item.className = "horario-item";
    item.innerHTML = `
      <span class="time">${turno.hora}</span>
      <span class="spots ${estado.clase}">${estado.texto}</span>
    `;
    horariosContainer.appendChild(item);
  });
}

// ---------- Pintar el modal, REUSANDO turnosPorDia (sin nueva consulta) ----------
function pintarModal() {
  const tabsContainer = document.getElementById("modal-tabs");
  const lista = document.getElementById("modal-turnos-list");

  tabsContainer.innerHTML = "";
  const fechas = proximasFechas();

  // El modal arranca en el día elegido en la agenda (o en el primero)
  let indiceInicial = fechas.findIndex((f) => f.clave === fechaElegida);
  if (indiceInicial === -1) indiceInicial = 0;

  fechas.forEach((fecha, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `modal-tab ${index === indiceInicial ? "active" : ""}`;
    tab.textContent = fecha.etiqueta;
    tab.addEventListener("click", () => {
      document.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      fechaElegida = fecha.clave;
      pintarTurnosModalDia(fecha);
    });
    tabsContainer.appendChild(tab);
  });

  if (fechas.length > 0) {
    pintarTurnosModalDia(fechas[indiceInicial]);
  } else {
    lista.innerHTML = "<p>No hay turnos cargados.</p>";
  }
}

function pintarTurnosModalDia(fecha) {
  const lista = document.getElementById("modal-turnos-list");
  lista.innerHTML = "";

  turnosPorDia[fecha.nombre].forEach((turno) => {
    const libres = turno.cupoMaximo - reservadosEn(fecha, turno);
    const pasado = yaPaso(fecha, turno);
    const estado = pasado
      ? { clase: "full", texto: "Finalizado" }
      : getEstadoSpots(libres);
    const noDisponible = pasado || libres <= 0;

    const item = document.createElement("div");
    item.className = `modal-turno-item ${noDisponible ? "disabled" : ""}`;
    item.innerHTML = `
      <span class="modal-turno-info">${turno.hora}</span>
      <span class="spots ${estado.clase}">${estado.texto}</span>
    `;

    if (!noDisponible) {
      item.addEventListener("click", () => {
        // Guardamos el turno junto con la fecha elegida
        const [, mes, dia] = fecha.clave.split("-");
        turnoSeleccionado = {
          ...turno,
          fecha: fecha.clave,                                       // "2026-10-13"
          fechaTexto: `${fecha.nombre} ${Number(dia)}/${Number(mes)}` // "Lunes 13/10"
        };
        mostrarPasoForm();
      });
    }

    lista.appendChild(item);
  });
}

// ---------- Navegación entre pasos del modal ----------
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
  `${turnoSeleccionado.fechaTexto} — ${turnoSeleccionado.hora}`;
}

function mostrarPasoExito(resultado) {
  document.getElementById("modal-step-turnos").style.display = "none";
  document.getElementById("modal-step-form").style.display = "none";
  document.getElementById("modal-step-exito").style.display = "block";

  const titulo = document.getElementById("exito-titulo");
  const texto = document.getElementById("exito-texto");
  const bloqueCancelar = document.getElementById("exito-cancelar");

  if (resultado.estado === "pendiente") {
    // Con verificación: la reserva todavía no está hecha
    titulo.textContent = "¡Ya casi! Revisá tu mail";
    texto.textContent =
      "Te mandamos un mail para confirmar tu reserva. Tocá el botón del mail en los próximos 30 minutos para guardar tu lugar. Si no lo ves, revisá la carpeta de spam.";
    bloqueCancelar.style.display = "none";
  } else {
    // Sin verificación: la reserva ya quedó hecha
    titulo.textContent = "¡Reserva confirmada!";
    texto.textContent =
      "Te esperamos en tu clase. Te enviamos la confirmación a tu email. Si no la ves, revisá la carpeta de spam.";
    bloqueCancelar.style.display = "block";
    document.getElementById("link-cancelar").href =
      `/cancelar.html?id=${encodeURIComponent(resultado.reservaId)}`;
  }
}

async function abrirModal() {
  document.getElementById("modal-overlay").classList.add("open");
  mostrarPasoTurnos();

  if (!cargaInicial) {
    cargaInicial = cargarTurnosDesdeFirestore();
  }

  if (Object.keys(turnosPorDia).length === 0) {
    document.getElementById("modal-turnos-list").innerHTML = "<p>Cargando turnos...</p>";
  }

  await cargaInicial;
  pintarModal();
}

function cerrarModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.getElementById("reserva-form").reset();
  turnoSeleccionado = null;
}

// ---------- Confirmar reserva (la crea el servidor, no el navegador) ----------
const MENSAJES_ERROR = {
  "datos-invalidos": "Revisá los datos del formulario e intentá de nuevo.",
  "fecha-invalida": "Esa fecha no está disponible. Elegí otro turno.",
  "turno-no-existe": "Ese turno ya no existe. Recargá la página para ver los horarios actualizados.",
  "dia-bloqueado": "Ese día no hay clases. Elegí otro día.",
  "turno-pasado": "Esa clase ya empezó. Elegí otro horario.",
  "sin-lugar": "Ese turno se acaba de llenar. Elegí otro horario.",
  "ya-reservaste-ese-dia": "Ya tenés una reserva para ese día. Solo se puede reservar una clase por día.",
  "limite-reservas": "Ya tenés 3 reservas próximas. Vas a poder reservar de nuevo cuando pase alguna de esas clases.",
  "confirmacion-pendiente": "Ya te mandamos un mail para confirmar una reserva de ese día. Revisá tu correo (y la carpeta de spam).",
  "mail-no-enviado": "No pudimos mandarte el mail de confirmación. Revisá que el email esté bien escrito e intentá de nuevo.",
};

async function confirmarReserva(datosPersona) {
  const turno = turnoSeleccionado;

  const respuesta = await fetch("/.netlify/functions/crear-reserva", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      turnoId: turno.id,
      fecha: turno.fecha,
      nombre: datosPersona.nombre,
      apellido: datosPersona.apellido,
      email: datosPersona.email,
      telefono: datosPersona.telefono,
      privacidad: datosPersona.privacidad,
    }),
  });

  let resultado = {};
  try {
    resultado = await respuesta.json();
  } catch {
    // si el servidor no respondió con JSON, cae en el error genérico de abajo
  }

  if (!respuesta.ok || !resultado.ok) {
    const error = new Error(
      MENSAJES_ERROR[resultado.error] || "Hubo un error al confirmar la reserva. Intentá de nuevo."
    );
    error.codigo = resultado.error;
    throw error;
  }

    return resultado; // { estado: "confirmada", reservaId } o { estado: "pendiente" }
}

// ---------- Validaciones del formulario ----------
function validarFormulario(datos) {
  const errores = {};

  const nombreRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]{2,}$/;
  if (!nombreRegex.test(datos.nombre.trim())) {
    errores.nombre = "Solo letras, mínimo 2 caracteres.";
  }

  if (!nombreRegex.test(datos.apellido.trim())) {
    errores.apellido = "Solo letras, mínimo 2 caracteres.";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(datos.email.trim())) {
    errores.email = "Ingresá un email válido.";
  }

  const telefonoLimpio = datos.telefono.replace(/\s+/g, "");
  const telefonoRegex = /^(\+598)?0?9\d{7}$/;
  if (!telefonoRegex.test(telefonoLimpio)) {
    errores.telefono = "Ingresá un celular uruguayo válido (ej: 099123456).";
  }

  if (!datos.privacidad) {
    errores.privacidad = "Tenés que aceptar la política de privacidad.";
  }

  return errores;
}

function mostrarErrores(errores) {
  ["nombre", "apellido", "email", "telefono", "privacidad"].forEach((campo) => {
    const spanError = document.getElementById(`error-${campo}`);
    const input = document.getElementById(`input-${campo}`);
    if (errores[campo]) {
      spanError.textContent = errores[campo];
      input.classList.add("invalid");
    } else {
      spanError.textContent = "";
      input.classList.remove("invalid");
    }
  });
}

// ------------------------------- EVENTOS  -------------------------------
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
    cargaInicial = null; // forzamos releer cupos actualizados después de una reserva
    cargarTurnos();
});

    document.getElementById("reserva-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const datosPersona = {
      nombre: document.getElementById("input-nombre").value.trim(),
      apellido: document.getElementById("input-apellido").value.trim(),
      email: document.getElementById("input-email").value.trim(),
      telefono: document.getElementById("input-telefono").value.trim(),
      privacidad: document.getElementById("input-privacidad").checked
    };

    const errores = validarFormulario(datosPersona);
    mostrarErrores(errores);

    if (Object.keys(errores).length > 0) {
      return;
    }

    const submitBtn = e.target.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Reservando...";

    try {
      const resultado = await confirmarReserva(datosPersona);
      mostrarPasoExito(resultado);
      // El mail ahora lo manda el servidor al crear la reserva
    } catch (error) {
      alert(error.message);
      console.error(error);

      // Si el turno se llenó, recargamos los cupos para mostrar la info real
      if (error.codigo === "sin-lugar") {
        cargaInicial = null;
        cargarTurnos();
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirmar reserva";
    }
  });
});