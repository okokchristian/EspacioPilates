// ================= RECORDATORIOS AUTOMÁTICOS =================
// Netlify ejecuta esta función sola todos los días a las 20:00 (Uruguay).
// Busca las reservas de mañana y le manda un recordatorio a cada alumno.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Conexión a Firebase con la cuenta de servicio (variables de Netlify)
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

// Dirección del sitio publicado (Netlify la da sola en process.env.URL)
const SITIO = process.env.URL || "https://espacio-pilates.netlify.app";

// "2026-10-11": la fecha de mañana en Uruguay (UTC-3)
function fechaDeManana() {
  const ahoraUY = new Date(Date.now() - 3 * 60 * 60 * 1000);
  ahoraUY.setUTCDate(ahoraUY.getUTCDate() + 1);
  return ahoraUY.toISOString().slice(0, 10);
}

// "2026-10-11" → "domingo, 11 de octubre"
function fechaLarga(fecha) {
  return new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString("es-UY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Montevideo",
  });
}

function escaparHTML(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Resend permite pocos envíos por segundo: esperamos un poco entre mails
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export default async () => {
  const manana = fechaDeManana();
  console.log(`Buscando reservas para ${manana}`);

  const snapshot = await db.collection("reservas").where("fecha", "==", manana).get();

  let enviados = 0;
  let fallidos = 0;

  for (const docSnap of snapshot.docs) {
    const reserva = docSnap.data();

    // Si ya se le mandó el recordatorio, no lo repetimos
    if (reserva.recordatorio) continue;

    const fecha = fechaLarga(reserva.fecha);
    const linkCancelar = `${SITIO}/cancelar.html?id=${encodeURIComponent(docSnap.id)}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; color: #2b2420;">
        <h2 style="margin-bottom: 4px;">¡Mañana tenés clase!</h2>
        <p>Hola ${escaparHTML(reserva.nombre)}, te recordamos tu clase en ${ESTUDIO.nombre}.</p>
        <table style="margin: 16px 0; border-collapse: collapse;">
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Día</td><td><strong>${fecha}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Hora</td><td><strong>${escaparHTML(reserva.hora)}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Dónde</td><td>${ESTUDIO.direccion}</td></tr>
        </table>
        <p style="color: #6b5f57; font-size: 14px;">
          Si al final no podés venir, podés cancelar hasta 2 horas antes
          <a href="${linkCancelar}" style="color: #7a3e2b;">desde este link</a>
          y tu lugar queda libre para otra persona.
        </p>
      </div>
    `;

    try {
      const respuesta = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: ESTUDIO.remitente,
          to: [reserva.email],
          subject: `Recordatorio: mañana a las ${reserva.hora} en ${ESTUDIO.nombre}`,
          html,
        }),
      });

      if (!respuesta.ok) {
        fallidos++;
        console.error(`No se pudo enviar a la reserva ${docSnap.id}:`, await respuesta.text());
      } else {
        await docSnap.ref.update({ recordatorio: new Date().toISOString() });
        enviados++;
      }
    } catch (error) {
      fallidos++;
      console.error(`Error con la reserva ${docSnap.id}:`, error);
    }

    await esperar(600);
  }

  console.log(`Recordatorios: ${enviados} enviados, ${fallidos} fallidos, ${snapshot.size} reservas para mañana`);
};

// Todos los días a las 23:00 UTC = 20:00 en Uruguay
export const config = {
  schedule: "0 23 * * *",
};