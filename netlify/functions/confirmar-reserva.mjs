// ================= MAIL DE CONFIRMACIÓN DE RESERVA =================
// La página llama a esta función con el id de una reserva recién creada.
// La función lee la reserva directo de Firestore (no confía en lo que
// manda el navegador) y le envía el mail de confirmación al alumno.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Conexión a Firebase con la cuenta de servicio (variables de Netlify)
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // En Netlify los saltos de línea quedan como "\n": los convertimos
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

// Datos del estudio que aparecen en el mail
const ESTUDIO = {
  nombre: "Espacio Pilates",
  direccion: "La Cumparsita 1475, Palermo, Montevideo",
  // Mientras no haya dominio propio en Resend, el remitente tiene que ser este
  remitente: "Espacio Pilates <onboarding@resend.dev>",
};

// Evita que un nombre con símbolos raros se interprete como HTML en el mail
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

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }

  // 1. Leer el id de la reserva que manda la página
  let reservaId;
  try {
    ({ reservaId } = await req.json());
  } catch {
    return new Response("Datos inválidos", { status: 400 });
  }
  if (typeof reservaId !== "string" || reservaId.length === 0) {
    return new Response("Falta la reserva", { status: 400 });
  }

  try {
    // 2. Buscar la reserva en Firestore
    const reservaRef = db.collection("reservas").doc(reservaId);
    const snapshot = await reservaRef.get();
    if (!snapshot.exists) {
      return new Response("Reserva no encontrada", { status: 404 });
    }
    const reserva = snapshot.data();

    // 3. Protecciones: no mandar el mail dos veces, ni para reservas viejas
    if (reserva.mailConfirmacion) {
      return new Response("El mail ya se había enviado", { status: 200 });
    }
    const minutosDesdeQueSeCreo = (Date.now() - new Date(reserva.creado).getTime()) / 60000;
    if (minutosDesdeQueSeCreo > 10) {
      return new Response("Reserva demasiado antigua", { status: 200 });
    }

        // 4. Armar el mail
    const fecha = fechaLarga(reserva.fecha);
    // Link para que el alumno cancele (usa la misma dirección del sitio)
    const linkCancelar = `${new URL(req.url).origin}/cancelar.html?id=${encodeURIComponent(reservaId)}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; color: #2b2420;">
        <h2 style="margin-bottom: 4px;">¡Tu clase está reservada!</h2>
        <p>Hola ${escaparHTML(reserva.nombre)}, te esperamos en ${ESTUDIO.nombre}.</p>
        <table style="margin: 16px 0; border-collapse: collapse;">
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Día</td><td><strong>${fecha}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Hora</td><td><strong>${escaparHTML(reserva.hora)}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b5f57;">Dónde</td><td>${ESTUDIO.direccion}</td></tr>
        </table>
        <p style="color: #6b5f57; font-size: 14px;">
          Si no podés venir, podés cancelar hasta 2 horas antes
          <a href="${linkCancelar}" style="color: #7a3e2b;">desde este link</a>
          y tu lugar queda libre para otra persona.
        </p>
      </div>
    `;

    // 5. Enviarlo con Resend
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ESTUDIO.remitente,
        to: [reserva.email],
        subject: `Reserva confirmada: ${fecha} a las ${reserva.hora}`,
        html,
      }),
    });

    if (!respuesta.ok) {
      console.error("Resend respondió con error:", await respuesta.text());
      return new Response("No se pudo enviar el mail", { status: 502 });
    }

    // 6. Marcar la reserva como "mail enviado"
    await reservaRef.update({ mailConfirmacion: new Date().toISOString() });

    return new Response("Mail enviado", { status: 200 });
  } catch (error) {
    console.error("Error en confirmar-reserva:", error);
    return new Response("Error", { status: 500 });
  }
};