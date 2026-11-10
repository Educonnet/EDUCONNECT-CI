
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
  let etape = "initialisation";

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

    const authorization =
      event.headers.authorization ||
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

    // 1. Réserver le paiement
    etape = "reservation_supabase";

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

    // 2. Créer la facture PayDunya
    etape = "creation_facture_paydunya";

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
      console.error("Réponse PayDunya :", {
        httpStatus: paydunyaResponse.status,
        responseCode: facture.response_code || null,
        tokenPresent: Boolean(facture.token),
        urlPresent: Boolean(facture.response_text)
      });

      throw new Error("PayDunya n'a pas pu créer la facture.");
    }

    factureCreee = true;

    // 3. Diagnostic sécurisé de l'adresse de facture
    try {
      const urlFacture = new URL(facture.response_text);
      const segments = urlFacture.pathname.split("/").filter(Boolean);
      const dernierSegment = segments[segments.length - 1];

      const diagnosticURL = {
        protocole: urlFacture.protocol,
        domaine: urlFacture.hostname,
        chemin: urlFacture.pathname.replace(
          /[^/]+$/,
          "[JETON_MASQUE]"
        ),
        aucunParametre: !urlFacture.search,
        aucunFragment: !urlFacture.hash,
        cheminAttendu:
          urlFacture.pathname.startsWith(
            "/sandbox-checkout/invoice/"
          ) && segments.length === 3,
        jetonPresent: Boolean(facture.token),
        jetonCorrespond: dernierSegment === facture.token
      };

      console.log("Diagnostic URL PayDunya :", diagnosticURL);

    } catch (erreur) {
      console.error("URL PayDunya non analysable :", {
        message: erreur.message
      });

      throw new Error("Adresse de facture PayDunya invalide.");
    }

    // 4. Associer la facture à la réservation
    etape = "association_supabase";

   
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

    const association = Array.isArray(associationData)
      ? associationData[0]
      : associationData;

    if (
  !association ||
  association.reservation_status !== "invoice_created" ||
  !association.payment_id
) 
    {
      console.error("Association à vérifier :", {
        status: association.reservation_status || null,
        paymentPresent: Boolean(association?.payment_id)
      });

      throw new Error(
        "Facture créée, mais association à vérifier auprès de l'administration."
      );
    }

    return reponse(200, {
      success: true,
      payment_url: facture.response_text
    });

  } catch (error) {
    console.error("Erreur création facture :", {
      etape,
      message: error.message
    });

    // Clôturer uniquement si aucune facture PayDunya n'a été créée.
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
              p_error_note:
                "Échec avant création de la facture PayDunya."
            })
          }
        );

      } catch (e) {
        console.error("Erreur de clôture réservation :", e.message);
      }
    }

    return reponse(500, {
      success: false,
      etape,
      error: factureCreee
        ? "Facture créée, mais association à vérifier auprès de l'administration."
        : "La création de la facture a échoué. Réessaie plus tard."
    });
  }
};
