
const headers = {
  "Content-Type": "application/json"
};

function reponse(statusCode, contenu) {
  return {
    statusCode,
    headers: {
      ...headers,
      "Access-Control-Allow-Origin": process.env.SITE_URL,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(contenu)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return reponse(200, { success: true });
  }

  if (event.httpMethod !== "POST") {
    return reponse(405, {
      success: false,
      error: "Méthode non autorisée."
    });
  }

  let reservationId = null;
let factureCreee = false;

  try {
    const {
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      SUPABASE_SECRET_KEY,
      PAYDUNYA_MASTER_KEY,
      PAYDUNYA_PRIVATE_KEY,
      PAYDUNYA_TOKEN,
      PAYDUNYA_MODE,
      SITE_URL
    } = process.env;

    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      !SUPABASE_SECRET_KEY ||
      !PAYDUNYA_MASTER_KEY ||
      !PAYDUNYA_PRIVATE_KEY ||
      !PAYDUNYA_TOKEN ||
      !SITE_URL
    ) {
      throw new Error("Configuration serveur incomplète.");
    }

    if (PAYDUNYA_MODE !== "sandbox") {
      throw new Error("Le mode de paiement autorisé est Sandbox.");
    }

    const authorization = event.headers.authorization ||
      event.headers.Authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return reponse(401, {
        success: false,
        error: "Connecte-toi à ton compte."
      });
    }

    const body = JSON.parse(event.body || "{}");
    const courseId = body.course_id;
    const moduleId = body.module_id;

    if (
      courseId !== "informatique" ||
      !["module-1", "module-2", "module-3", "module-4"].includes(moduleId)
    ) {
      return reponse(400, {
        success: false,
        error: "Formation ou module non autorisé."
      });
    }

    // 1. Réserver le paiement avec la session réelle de l'apprenant.
    const reservationResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/reserver_paiement_paydunya`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": authorization
        },
        body: JSON.stringify({
          p_course_id: courseId,
          p_module_id: moduleId
        })
      }
    );

    const reservationData = await reservationResponse.json();

    if (!reservationResponse.ok) {
      console.error("Réservation Supabase :", reservationData);
      throw new Error("Impossible de réserver ce paiement.");
    }

    const reservation = Array.isArray(reservationData)
      ? reservationData[0]
      : reservationData;

    if (!reservation || !reservation.reservation_id) {
      throw new Error("Réservation invalide.");
    }

    reservationId = reservation.reservation_id;

    // 2. Créer la facture chez PayDunya.
    const paydunyaResponse = await fetch(
      "https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYDUNYA-MASTER-KEY": PAYDUNYA_MASTER_KEY,
          "PAYDUNYA-PRIVATE-KEY": PAYDUNYA_PRIVATE_KEY,
          "PAYDUNYA-TOKEN": PAYDUNYA_TOKEN
        },
        body: JSON.stringify({
          invoice: {
            total_amount: reservation.amount_xof,
            description:
              `${reservation.course_title} - ${reservation.module_title}`
          },
          store: {
            name: "EDUCONNECT CI"
          },
          actions: {
            return_url: `${SITE_URL}/paiement.html`,
            cancel_url: `${SITE_URL}/paiement.html`,
            callback_url:
              `${SITE_URL}/.netlify/functions/notification-paydunya`
          }
        })
      }
    );

    const facture = await paydunyaResponse.json();

    if (
      !paydunyaResponse.ok ||
      facture.response_code !== "00" ||
      !facture.token ||
      !facture.response_text
    ) {
      console.error("Réponse PayDunya :", facture);
      throw new Error("PayDunya n'a pas pu créer la facture.");
    }
    factureCreee = true;

    // 3. Associer la facture à la réservation.
    const associationResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/associer_facture_paydunya`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SECRET_KEY
        },
        body: JSON.stringify({
          p_reservation_id: reservationId,
          p_invoice_token: facture.token,
          p_invoice_url: facture.response_text
        })
      }
    );

    const associationData = await associationResponse.json();

    if (!associationResponse.ok) {
      console.error("Association facture :", associationData);
      throw new Error(
        "Facture créée, mais son association nécessite une vérification."
      );
    }

    return reponse(200, {
      success: true,
      payment_url: facture.response_text
    });

  } catch (error) {
  console.error("Erreur création facture :", error);

  // Ne jamais clôturer une réservation si une facture existe déjà.
  if (reservationId && !factureCreee) {
    try {
      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/rpc/echouer_reservation_paydunya`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": process.env.SUPABASE_SECRET_KEY
          },
          body: JSON.stringify({
            p_reservation_id: reservationId,
            p_error_note: "Échec avant création de la facture PayDunya."
          })
        }
      );
    } catch (e) {
      console.error("Erreur de clôture réservation :", e);
    }
  }

    return reponse(500, {
    success: false,
    error: factureCreee
      ? "Facture créée, mais association à vérifier auprès de l'administration."
      : "La création de la facture a échoué. Réessaie plus tard."
  });
  }
};