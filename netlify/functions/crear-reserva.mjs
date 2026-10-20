// ================= CREAR RESERVA (todo pasa por el servidor) =================
// La página manda los datos del formulario. Esta función:
//   1. valida los datos (no confía en el navegador)
//   2. revisa que el turno exista, que la fecha sea válida y no esté bloqueada
//   3. aplica el límite por persona (email y teléfono)
//   4. guarda la reserva y suma el cupo en una transacción
//   5. manda el mail de confirmación

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

// ---------- Configuración ----------
const ESTUDIO = {
  nombre: "Espacio Pilates",
  direccion: "La Cumparsita 1475, Palermo, Montevideo",
  remitente: "Espacio Pilates <onboarding@resend.dev>",
};
const MAX_RESERVAS_ACTIVAS = 3; // reservas futuras por persona
const DIAS_HACIA_ADELANTE = 14; // hasta cuántos días se puede reservar
const NOMBRES_DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ---------- Ayudantes ----------
function responder(status, datos) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escaparHTML(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// "2026-10-13" → "lunes, 13 de octubre"
function fechaLarga(clave) {
  const [anio, mes, dia] = clave.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia, 12)).toLocaleDateString("es-UY", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}

// Fecha de hoy en Uruguay, en formato "2026-10-13"
function hoyUruguay() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Montevideo" });
}

// "2026-10-13" → "Martes"
function nombreDelDia(clave) {
  const [anio, mes, dia] = clave.split("-").map(Number);
  return NOMBRES_DIAS[new Date(Date.UTC(anio, mes - 1, dia, 12)).getUTCDay()];
}

// Diferencia en días entre dos fechas "AAAA-MM-DD"
function diasEntre(desde, hasta) {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);
}

// Normalizar para comparar: "Ana@Mail.com " → "ana@mail.com", "+598 099 123 456" → "99123456"
function normalizarEmail(email) {
  return email.trim().toLowerCase();
}
function normalizarTelefono(telefono) {
  return telefono.replace(/\D/g, "").replace(/^598/, "").replace(/^0/, "");
}

// Mismas validaciones que el formulario, pero acá no se pueden saltear
function validar(d) {
  const nombreRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]{2,40}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const telefonoRegex = /^(\+598)?0?9\d{7}$/;
  return (
    typeof d.turnoId === "string" && d.turnoId.length > 0 && d.turnoId.length < 100 &&
    typeof d.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) &&
    typeof d.nombre === "string" && nombreRegex.test(d.nombre.trim()) &&
    typeof d.apellido === "string" && nombreRegex.test(d.apellido.trim()) &&
    typeof d.email === "string" && d.email.length < 120 && emailRegex.test(d.email.trim()) &&
    typeof d.telefono === "string" && telefonoRegex.test(d.telefono.replace(/\s+/g, "")) &&
    d.privacidad === true
  );
}

// Cuenta las reservas futuras de una persona (por email o por teléfono)
async function reservasActivas(campo, valor, hoy) {
  const snapshot = await db.collection("reservas").where(campo, "==", valor).get();
  return snapshot.docs.map((d) => d.data()).filter((r) => r.fecha >= hoy);
}

// ---------- Función principal ----------
export default async (req) => {
  if (req.method !== "POST") {
    return responder(405, { ok: false, error: "metodo-no-permitido" });
  }

  // 1. Leer y validar los datos
  let datos;
  try {
    datos = await req.json();
  } catch {
    return responder(400, { ok: false, error: "datos-invalidos" });
  }
  if (!datos || !validar(datos)) {
    return responder(400, { ok: false, error: "datos-invalidos" });
  }

  const hoy = hoyUruguay();
  const emailNorm = normalizarEmail(datos.email);
  const telefonoNorm = normalizarTelefono(datos.telefono);

  try {
    // 2. Revisar la fecha
    const diasHastaLaClase = diasEntre(hoy, datos.fecha);
    if (diasHastaLaClase < 0 || diasHastaLaClase > DIAS_HACIA_ADELANTE) {
      return responder(400, { ok: false, error: "fecha-invalida" });
    }

    // 3. Límite por persona (por email y por teléfono)
    const porEmail = await reservasActivas("emailNorm", emailNorm, hoy);
    const porTelefono = await reservasActivas("telefonoNorm", telefonoNorm, hoy);
    const todas = [...porEmail, ...porTelefono];

    if (todas.some((r) => r.fecha === datos.fecha)) {
      return responder(429, { ok: false, error: "ya-reservaste-ese-dia" });
    }
    if (Math.max(porEmail.length, porTelefono.length) >= MAX_RESERVAS_ACTIVAS) {
      return responder(429, { ok: false, error: "limite-reservas" });
    }

    // 4. Transacción: revisar turno, bloqueo y cupo; guardar reserva y sumar cupo
    const turnoRef = db.collection("turnos").doc(datos.turnoId);
    const bloqueoRef = db.collection("bloqueos").doc(datos.fecha);
    const ocupacionRef = db.collection("ocupacion").doc(`${datos.fecha}_${datos.turnoId}`);
    const reservaRef = db.collection("reservas").doc();

    const turno = await db.runTransaction(async (t) => {
      const [turnoDoc, bloqueoDoc, ocupacionDoc] = await Promise.all([
        t.get(turnoRef), t.get(bloqueoRef), t.get(ocupacionRef),
      ]);

      if (!turnoDoc.exists) throw new Error("turno-no-existe");
      const turno = turnoDoc.data();

      // El turno tiene que ser de ese día de la semana
      if (turno["día"] !== nombreDelDia(datos.fecha)) throw new Error("fecha-invalida");
      if (bloqueoDoc.exists) throw new Error("dia-bloqueado");

      // Si es hoy, la clase no puede haber empezado
      const inicio = new Date(`${datos.fecha}T${turno.hora}:00-03:00`);
      if (inicio.getTime() <= Date.now()) throw new Error("turno-pasado");

      // El cupo se toma de la base de datos, no de lo que diga el navegador
      const reservados = ocupacionDoc.exists ? ocupacionDoc.data().reservados : 0;
      if (reservados >= turno.cupoMaximo) throw new Error("sin-lugar");

      if (ocupacionDoc.exists) {
        t.update(ocupacionRef, { reservados: reservados + 1 });
      } else {
        t.set(ocupacionRef, { fecha: datos.fecha, turnoId: datos.turnoId, reservados: 1 });
      }

      const ahora = new Date().toISOString();
      t.set(reservaRef, {
        turnoId: datos.turnoId,
        fecha: datos.fecha,
        "día": turno["día"],
        hora: turno.hora,
        nombre: datos.nombre.trim(),
        apellido: datos.apellido.trim(),
        email: datos.email.trim(),
        telefono: datos.telefono.trim(),
        emailNorm,
        telefonoNorm,
        creado: ahora,
        privacidadAceptada: ahora,
      });

      return turno;
    });

    // 5. Mandar el mail de confirmación (si falla, la reserva igual quedó hecha)
    let mailEnviado = false;
    try {
      const fecha = fechaLarga(datos.fecha);
      const linkCancelar = `${new URL(req.url).origin}/cancelar.html?id=${encodeURIComponent(reservaRef.id)}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; color: #2b2420;">
          <h2 style="margin-bottom: 4px;">¡Tu clase está reservada!</h2>
          <p>Hola ${escaparHTML(datos.nombre.trim())}, te esperamos en ${ESTUDIO.nombre}.</p>
          <table style="margin: 16px 0; border-collapse: collapse;">
            <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Día</td><td><strong>${fecha}</strong></td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Hora</td><td><strong>${escaparHTML(turno.hora)}</strong></td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Dónde</td><td>${ESTUDIO.direccion}</td></tr>
          </table>
          <p style="color: #6b5f57; font-size: 14px;">
            Si no podés venir, podés cancelar hasta 2 horas antes
            <a href="${linkCancelar}" style="color: #7a3e2b;">desde este link</a>
            y tu lugar queda libre para otra persona.
          </p>
        </div>
      `;

      const respuesta = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: ESTUDIO.remitente,
          to: [datos.email.trim()],
          subject: `Reserva confirmada: ${fecha} a las ${turno.hora}`,
          html,
        }),
      });

      if (respuesta.ok) {
        mailEnviado = true;
        await reservaRef.update({ mailConfirmacion: new Date().toISOString() });
      } else {
        console.error("Resend respondió con error:", await respuesta.text());
      }
    } catch (errorMail) {
      console.error("No se pudo enviar el mail:", errorMail);
    }

    return responder(200, { ok: true, reservaId: reservaRef.id, mailEnviado });
  } catch (error) {
    const conocidos = {
      "turno-no-existe": 404,
      "fecha-invalida": 400,
      "dia-bloqueado": 409,
      "turno-pasado": 409,
      "sin-lugar": 409,
    };
    if (conocidos[error.message]) {
      return responder(conocidos[error.message], { ok: false, error: error.message });
    }
    console.error("Error en crear-reserva:", error);
    return responder(500, { ok: false, error: "error-interno" });
  }
};