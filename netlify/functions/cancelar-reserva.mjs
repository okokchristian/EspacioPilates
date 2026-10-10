import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Conexión a Firebase con la cuenta de servicio
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

// Hasta cuántas horas antes de la clase se puede cancelar
const HORAS_MINIMAS = 2;

// "2026-10-10" + "10:00" → fecha y hora real en Uruguay
function horasQueFaltan(fecha, hora) {
  const inicio = new Date(`${fecha}T${hora}:00-03:00`);
  return (inicio - Date.now()) / (1000 * 60 * 60);
}

function responder(datos, status = 200) {
  return Response.json(datos, { status });
}

export default async (req) => {
  if (req.method !== "POST") {
    return responder({ error: "metodo" }, 405);
  }

  let id, accion;
  try {
    ({ id, accion } = await req.json());
  } catch {
    return responder({ error: "pedido-invalido" }, 400);
  }

  // El ID tiene que tener formato de ID de Firestore
  if (typeof id !== "string" || !/^[A-Za-z0-9]{15,40}$/.test(id)) {
    return responder({ error: "link-invalido" }, 400);
  }

  const reservaRef = db.collection("reservas").doc(id);

  try {
    // 1) Consultar: para mostrar los datos en la página antes de cancelar
    if (accion === "consultar") {
      const snap = await reservaRef.get();
      if (!snap.exists) return responder({ error: "no-existe" }, 404);

      const r = snap.data();
      const faltan = horasQueFaltan(r.fecha, r.hora);

      return responder({
        nombre: r.nombre,
        fecha: r.fecha,
        hora: r.hora,
        cancelable: faltan >= HORAS_MINIMAS,
        horasMinimas: HORAS_MINIMAS,
      });
    }

    // 2) Cancelar: borra la reserva y libera el cupo, todo junto
    if (accion === "cancelar") {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(reservaRef);
        if (!snap.exists) throw new Error("no-existe");

        const r = snap.data();
        if (horasQueFaltan(r.fecha, r.hora) < HORAS_MINIMAS) {
          throw new Error("fuera-de-plazo");
        }

        const ocupacionRef = db.collection("ocupacion").doc(`${r.fecha}_${r.turnoId}`);
        const ocupacionSnap = await tx.get(ocupacionRef);

        tx.delete(reservaRef);

        if (ocupacionSnap.exists && ocupacionSnap.data().reservados > 0) {
          tx.update(ocupacionRef, {
            reservados: ocupacionSnap.data().reservados - 1,
          });
        }
      });

      return responder({ ok: true });
    }

    return responder({ error: "accion-invalida" }, 400);
  } catch (err) {
    if (err.message === "no-existe") return responder({ error: "no-existe" }, 404);
    if (err.message === "fuera-de-plazo") return responder({ error: "fuera-de-plazo" }, 409);
    console.error("Error en cancelar-reserva:", err);
    return responder({ error: "error-interno" }, 500);
  }
};