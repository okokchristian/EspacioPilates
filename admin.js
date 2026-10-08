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
  orderBy,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  runTransaction
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

    cargarBloqueos();
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

      const info = document.createElement("div");
      info.className = "panel-reserva-info";

      const nombre = document.createElement("strong");
      nombre.textContent = `${r.nombre} ${r.apellido}`;

      const contacto = document.createElement("span");
      contacto.textContent = `${r.telefono} · ${r.email}`;

      info.append(nombre, contacto);

      const botonCancelar = document.createElement("button");
      botonCancelar.type = "button";
      botonCancelar.className = "btn-cancelar";
      botonCancelar.textContent = "Cancelar";
      botonCancelar.addEventListener("click", () => cancelarReserva(r, botonCancelar));

      li.append(info, botonCancelar);
      ul.appendChild(li);
    });

    bloque.appendChild(ul);
    contenido.appendChild(bloque);
  });
}

// ---------- Cancelar una reserva y liberar el lugar ----------
async function cancelarReserva(reserva, boton) {
  const confirmado = confirm(
    `¿Cancelar la reserva de ${reserva.nombre} ${reserva.apellido} (${reserva.hora})?\n` +
    `El lugar va a quedar libre en la agenda.`
  );
  if (!confirmado) return;

  boton.disabled = true;
  boton.textContent = "Cancelando...";

  const reservaRef = doc(db, "reservas", reserva.id);
  const ocupacionRef = doc(db, "ocupacion", `${reserva.fecha}_${reserva.turnoId}`);

  try {
    await runTransaction(db, async (transaction) => {
      const ocupacionDoc = await transaction.get(ocupacionRef);

      // Se borra la reserva y se resta 1 al cupo de esa clase,
      // en la misma operación: o se hacen las dos cosas, o ninguna.
      transaction.delete(reservaRef);

      if (ocupacionDoc.exists() && ocupacionDoc.data().reservados > 0) {
        transaction.update(ocupacionRef, { reservados: ocupacionDoc.data().reservados - 1 });
      }
    });

    cargarReservas(inputFecha.value); // recargar la lista
  } catch (error) {
    alert("No se pudo cancelar la reserva. Intentá de nuevo.");
    console.error(error);
    boton.disabled = false;
    boton.textContent = "Cancelar";
  }
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

// ================= DÍAS BLOQUEADOS =================

// "2026-12-25" → "viernes, 25 de diciembre"
function formatoFecha(clave) {
  const [anio, mes, dia] = clave.split("-").map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });
}

// ---------- Mostrar los próximos días bloqueados ----------
async function cargarBloqueos() {
  const lista = document.getElementById("bloqueos-lista");
  lista.textContent = "";

  try {
    const consulta = query(
      collection(db, "bloqueos"),
      where("fecha", ">=", hoyClave()),
      orderBy("fecha")
    );
    const snapshot = await getDocs(consulta);

    if (snapshot.empty) {
      const vacio = document.createElement("li");
      vacio.className = "panel-vacio";
      vacio.textContent = "No hay días bloqueados.";
      lista.appendChild(vacio);
      return;
    }

    snapshot.forEach((docSnap) => {
      const bloqueo = docSnap.data();

      const li = document.createElement("li");
      li.className = "panel-reserva";

      const info = document.createElement("div");
      info.className = "panel-reserva-info";

      const fecha = document.createElement("strong");
      fecha.textContent = formatoFecha(bloqueo.fecha);
      info.appendChild(fecha);

      if (bloqueo.motivo) {
        const motivo = document.createElement("span");
        motivo.textContent = bloqueo.motivo;
        info.appendChild(motivo);
      }

      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "btn-cancelar";
      boton.textContent = "Desbloquear";
      boton.addEventListener("click", async () => {
        boton.disabled = true;
        try {
          await deleteDoc(doc(db, "bloqueos", docSnap.id));
          cargarBloqueos();
        } catch (error) {
          alert("No se pudo desbloquear el día. Intentá de nuevo.");
          console.error(error);
          boton.disabled = false;
        }
      });

      li.append(info, boton);
      lista.appendChild(li);
    });
  } catch (error) {
    lista.textContent = "No se pudieron cargar los días bloqueados.";
    console.error(error);
  }
}

// ---------- Bloquear un día ----------
document.getElementById("bloqueo-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const fecha = document.getElementById("bloqueo-fecha").value;
  const motivo = document.getElementById("bloqueo-motivo").value.trim();
  const boton = e.target.querySelector("button[type='submit']");
  if (!fecha) return;

  boton.disabled = true;

  try {
    // ¿Ya hay reservas ese día? Bloquear no las cancela, así que avisamos.
    const reservas = await getDocs(query(collection(db, "reservas"), where("fecha", "==", fecha)));
    if (!reservas.empty) {
      const seguir = confirm(
        `Ese día ya tiene ${reservas.size} ${reservas.size === 1 ? "reserva" : "reservas"}.\n` +
        `Bloquearlo no las cancela: vas a tener que avisarles y cancelarlas desde la lista.\n\n` +
        `¿Bloquear igual?`
      );
      if (!seguir) return;
    }

    // La fecha es el id del documento: bloquear dos veces el mismo día no lo duplica
    await setDoc(doc(db, "bloqueos", fecha), { fecha, motivo });
    e.target.reset();
    cargarBloqueos();
  } catch (error) {
    alert("No se pudo bloquear el día. Intentá de nuevo.");
    console.error(error);
  } finally {
    boton.disabled = false;
  }
});