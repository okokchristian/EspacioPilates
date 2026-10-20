// ================= VERIFICAR RESERVA (confirmación por mail) =================
// La página confirmar.html manda el código (token) que venía en el link del mail.
// Esta función:
//   1. busca la reserva pendiente con ese código
//   2. revisa que no haya vencido y que todavía haya lugar
//   3. crea la reserva de verdad, suma el cupo y borra la pendiente
//   4. manda el mail de "¡Tu clase está reservada!" con el link para cancelar

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

const ESTUDIO = {
  nombre: "Espacio Pilates",
  direccion: "La Cumparsita 1475, Palermo, Montevideo",
  remitente: "Espacio Pilates <onboarding@resend.dev>",
};

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

async function enviarMail(para, asunto, html) {
  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: ESTUDIO.remitente, to: [para], subject: asunto, html }),
  });
  if (!respuesta.ok) {
    console.error("Resend respondió con error:", await respuesta.text());
  }
  return respuesta.ok;
}

// ---------- Función principal ----------
export default async (req) => {
  if (req.method !== "POST") {
    return responder(405, { ok: false, error: "metodo-no-permitido" });
  }

  // 1. Leer el código del link
  let token;
  try {
    ({ token } = await req.json());
  } catch {
    return responder(400, { ok: false, error: "link-invalido" });
  }
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) {
    return responder(400, { ok: false, error: "link-invalido" });
  }

  // La reserva confirmada usa el mismo código como id:
  // así, si tocan el botón dos veces, no se duplica.
  const pendienteRef = db.collection("pendientes").doc(token);
  const reservaRef = db.collection("reservas").doc(token);

  try {
    // 2 y 3. Todo en una transacción: o se hace completo, o nada
    const resultado = await db.runTransaction(async (t) => {
      // --- Primero todas las lecturas ---
      const [pendienteDoc, reservaDoc] = await Promise.all([
        t.get(pendienteRef), t.get(reservaRef),
      ]);

      // Ya estaba confirmada (tocaron el botón otra vez)
      if (reservaDoc.exists) {
        return { tipo: "ya-confirmada", reserva: reservaDoc.data() };
      }
      if (!pendienteDoc.exists) {
        return { tipo: "error", error: "link-invalido" };
      }

      const p = pendienteDoc.data();
      const turnoRef = db.collection("turnos").doc(p.turnoId);
      const bloqueoRef = db.collection("bloqueos").doc(p.fecha);
      const ocupacionRef = db.collection("ocupacion").doc(`${p.fecha}_${p.turnoId}`);
      const mismaPersona = db.collection("reservas").where("emailNorm", "==", p.emailNorm);

      const [turnoDoc, bloqueoDoc, ocupacionDoc, reservasPersona] = await Promise.all([
        t.get(turnoRef), t.get(bloqueoRef), t.get(ocupacionRef), t.get(mismaPersona),
      ]);

      // --- Después las revisiones (si algo falla, se borra la pendiente) ---
      const fallar = (error) => {
        t.delete(pendienteRef);
        return { tipo: "error", error };
      };

      if (new Date(p.expira).getTime() < Date.now()) return fallar("vencido");
      if (!turnoDoc.exists) return fallar("turno-no-existe");
      if (bloqueoDoc.exists) return fallar("dia-bloqueado");

      const turno = turnoDoc.data();
      const inicio = new Date(`${p.fecha}T${turno.hora}:00-03:00`);
      if (inicio.getTime() <= Date.now()) return fallar("turno-pasado");

      if (reservasPersona.docs.some((d) => d.data().fecha === p.fecha)) {
        return fallar("ya-reservaste-ese-dia");
      }

      const reservados = ocupacionDoc.exists ? ocupacionDoc.data().reservados : 0;
      if (reservados >= turno.cupoMaximo) return fallar("sin-lugar");

      // --- Por último las escrituras ---
      if (ocupacionDoc.exists) {
        t.update(ocupacionRef, { reservados: reservados + 1 });
      } else {
        t.set(ocupacionRef, { fecha: p.fecha, turnoId: p.turnoId, reservados: 1 });
      }

      const { expira, ...datosReserva } = p; // todo menos el vencimiento
      const reserva = {
        ...datosReserva,
        "día": turno["día"],
        hora: turno.hora,
        confirmada: new Date().toISOString(),
      };
      t.set(reservaRef, reserva);
      t.delete(pendienteRef);

      return { tipo: "confirmada", reserva };
    });

    if (resultado.tipo === "error") {
      const estados = {
        "link-invalido": 404,
        "vencido": 410,
        "turno-no-existe": 404,
        "dia-bloqueado": 409,
        "turno-pasado": 409,
        "ya-reservaste-ese-dia": 409,
        "sin-lugar": 409,
      };
      return responder(estados[resultado.error] || 400, { ok: false, error: resultado.error });
    }

    const r = resultado.reserva;
    const fecha = fechaLarga(r.fecha);

    // 4. Mail con el link para cancelar (solo la primera vez)
    if (resultado.tipo === "confirmada") {
      try {
        const linkCancelar = `${new URL(req.url).origin}/cancelar.html?id=${encodeURIComponent(token)}`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 480px; color: #2b2420;">
            <h2 style="margin-bottom: 4px;">¡Tu clase está reservada!</h2>
            <p>Hola ${escaparHTML(r.nombre)}, te esperamos en ${ESTUDIO.nombre}.</p>
            <table style="margin: 16px 0; border-collapse: collapse;">
              <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Día</td><td><strong>${fecha}</strong></td></tr>
              <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Hora</td><td><strong>${escaparHTML(r.hora)}</strong></td></tr>
              <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Dónde</td><td>${ESTUDIO.direccion}</td></tr>
            </table>
            <p style="color: #6b5f57; font-size: 14px;">
              Si no podés venir, podés cancelar hasta 2 horas antes
              <a href="${linkCancelar}" style="color: #7a3e2b;">desde este link</a>
              y tu lugar queda libre para otra persona.
            </p>
          </div>
        `;
        const enviado = await enviarMail(r.email, `Reserva confirmada: ${fecha} a las ${r.hora}`, html);
        if (enviado) {
          await reservaRef.update({ mailConfirmacion: new Date().toISOString() });
        }
      } catch (errorMail) {
        console.error("No se pudo enviar el mail:", errorMail);
      }
    }

    // Datos para mostrar en la página (sin email ni teléfono)
    return responder(200, {
      ok: true,
      estado: resultado.tipo, // "confirmada" o "ya-confirmada"
      reservaId: token,
      nombre: r.nombre,
      fecha,
      hora: r.hora,
    });
  } catch (error) {
    console.error("Error en verificar-reserva:", error);
    return responder(500, { ok: false, error: "error-interno" });
  }
};