
const crypto = require("crypto");

function reponse(statusCode, contenu) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(contenu)
  };
}

function hashValide(hash, masterKey) {
  if (
    typeof hash !== "string" ||
    !/^[a-f0-9]{128}$/i.test(hash)
  ) {
    return false;
  }

  const attendu = crypto
    .createHash("sha512")
    .update(masterKey, "utf8")
    .digest();

  const recu = Buffer.from(hash, "hex");

  return crypto.timingSafeEqual(attendu, recu);
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return reponse(405, { success: false });
  }

  try {
    const {
      PAYDUNYA_MASTER_KEY,
      PAYDUNYA_PRIVATE_KEY,
      PAYDUNYA_TOKEN,
      PAYDUNYA_MODE,
      SUPABASE_URL,
      SUPABASE_SECRET_KEY
    } = process.env;

    if (
      !PAYDUNYA_MASTER_KEY ||
      !PAYDUNYA_PRIVATE_KEY ||
      !PAYDUNYA_TOKEN ||
      !SUPABASE_URL ||
      !SUPABASE_SECRET_KEY ||
      PAYDUNYA_MODE !== "sandbox"
    ) {
      throw new Error("Configuration serveur incorrecte.");
    }

    // 1. Lire la notification PayDunya
    const corps = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";

    const formulaire = new URLSearchParams(corps);
    let notification = {};

    const donneesBrutes = formulaire.get("data");

    if (donneesBrutes) {
      try {
        notification = JSON.parse(donneesBrutes);
      } catch {
        return reponse(400, {
          success: false,
          error: "Format de notification invalide."
        });
      }
    } else {
      for (const [cle, valeur] of formulaire.entries()) {
        const correspondance = cle.match(
          /^data\[([^\]]+)\](?:\[([^\]]+)\])?$/
        );

        if (!correspondance) continue;

        const parent = correspondance[1];
        const enfant = correspondance[2];

        if (enfant) {
          if (
            !notification[parent] ||
            typeof notification[parent] !== "object"
          ) {
            notification[parent] = {};
          }

          notification[parent][enfant] = valeur;
        } else {
          notification[parent] = valeur;
        }
      }
    }

    if (
      !notification.hash ||
      !notification.status ||
      !notification.invoice
    ) {
      return reponse(400, {
        success: false,
        error: "Notification incomplète."
      });
    }

    // 2. Vérifier l'authenticité de la notification
    if (!hashValide(notification.hash, PAYDUNYA_MASTER_KEY)) {
      return reponse(401, { success: false });
    }

    const token = notification.invoice?.token;

    if (
      typeof token !== "string" ||
      !/^[a-zA-Z0-9_-]{1,255}$/.test(token)
    ) {
      return reponse(400, { success: false });
    }

    // Aucun accès si le paiement n'est pas terminé
    if (notification.status !== "completed") {
      return reponse(200, {
        success: true,
        message: "Paiement non terminé."
      });
    }

    // 3. Confirmer directement la facture auprès de PayDunya
    const confirmationResponse = await fetch(
      `https://app.paydunya.com/sandbox-api/v1/checkout-invoice/confirm/${encodeURIComponent(token)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "PAYDUNYA-MASTER-KEY": PAYDUNYA_MASTER_KEY,
          "PAYDUNYA-PRIVATE-KEY": PAYDUNYA_PRIVATE_KEY,
          "PAYDUNYA-TOKEN": PAYDUNYA_TOKEN
        }
      }
    );

    if (!confirmationResponse.ok) {
      throw new Error("Confirmation PayDunya indisponible.");
    }

    const confirmation = await confirmationResponse.json();

    // 4. Vérifier toutes les données de confirmation
    if (
      confirmation.response_code !== "00" ||
      confirmation.status !== "completed" ||
      !hashValide(confirmation.hash, PAYDUNYA_MASTER_KEY) ||
      confirmation.invoice?.token !== token ||
      confirmation.invoice?.total_amount === undefined
    ) {
      throw new Error("Confirmation du paiement invalide.");
    }

    const montant = Number(confirmation.invoice.total_amount);

    if (
      !Number.isSafeInteger(montant) ||
      montant !== 5000
    ) {
      throw new Error("Montant du paiement incorrect.");
    }

    // 5. Valider le paiement dans Supabase
    const validationResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/valider_paiement_paydunya`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`
        },
        body: JSON.stringify({
          p_invoice_token: token,
          p_confirmed_amount: montant
        })
      }
    );

    if (!validationResponse.ok) {
      const erreur = await validationResponse.text();

      console.error("Validation Supabase refusée :", erreur);

      throw new Error("Validation Supabase impossible.");
    }

    const autorisationId = await validationResponse.json();

    if (!autorisationId) {
      throw new Error("Aucune autorisation de module retournée.");
    }

    return reponse(200, {
      success: true,
      message: "Paiement confirmé."
    });

  } catch (erreur) {
    console.error("Notification PayDunya :", erreur.message);

    return reponse(500, {
      success: false,
      error: "Traitement du paiement impossible."
    });
  }
};
