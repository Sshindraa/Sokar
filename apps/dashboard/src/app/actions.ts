'use server';

export async function joinWaitlistAction(email: string) {
  if (!email || !email.includes('@')) {
    return { success: false, error: 'Veuillez fournir une adresse email valide.' };
  }

  const brevoKey = process.env.BREVO_API_KEY;
  const brevoListIdStr = process.env.BREVO_LIST_ID;
  const resendKey = process.env.RESEND_API_KEY;

  console.log(`[Waitlist] Nouvelle inscription pour : ${email}`);

  // 1. Intégration BREVO (Contacts API v3)
  if (brevoKey) {
    try {
      const listIds = brevoListIdStr ? [parseInt(brevoListIdStr)] : undefined;
      const response = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: {
          'api-key': brevoKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          email,
          ...(listIds && { listIds }),
          updateEnabled: true,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('[Waitlist] Erreur de Brevo:', errData);
      } else {
        console.log('[Waitlist] Contact enregistré avec succès sur Brevo.');
      }
    } catch (err) {
      console.error('[Waitlist] Erreur réseau avec Brevo:', err);
    }
  }

  // 2. Intégration RESEND (Envoi d'un email de bienvenue premium)
  if (resendKey) {
    try {
      const emailFrom = process.env.EMAIL_FROM || 'Sokar <welcome@sokar.tech>';
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [email],
          subject: 'Bienvenue dans la liste d\'attente de Sokar 🚀',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #070709; color: #ffffff; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
              <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #ffffff; font-size: 28px; font-weight: bold; margin: 0; text-shadow: 0 0 10px rgba(255,255,255,0.1);">Sokar</h1>
              </div>
              <h2 style="color: #f97316; font-size: 22px; font-weight: bold; text-align: center; margin-top: 10px;">Bienvenue dans notre accès prioritaire !</h2>
              <p style="font-size: 15px; color: #a1a1aa; line-height: 1.6; text-align: center;">Merci d'avoir rejoint la liste d'attente officielle de Sokar.</p>
              
              <div style="margin: 30px 0; padding: 25px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); text-align: center;">
                <span style="font-size: 11px; color: #f97316; font-weight: bold; letter-spacing: 0.15em; text-transform: uppercase; display: block; margin-bottom: 5px;">Statut de votre demande</span>
                <span style="font-size: 18px; color: #ffffff; font-weight: bold; display: block;">Accès Prioritaire Activé</span>
              </div>

              <p style="font-size: 15px; color: #a1a1aa; line-height: 1.6; margin-bottom: 20px;">
                Sokar est le premier assistant vocal intelligent conçu pour les restaurants. Grâce à notre IA, votre salle reste connectée et gère 100% de vos appels et réservations directement dans votre tableau de bord, même pendant les coups de feu du service.
              </p>
              
              <p style="font-size: 14px; color: #71717a; text-align: center; font-style: italic; margin-top: 25px;">
                Vous recevrez une notification par email dès que nous ouvrirons la plateforme à votre établissement.
              </p>
              
              <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 30px 0;" />
              <p style="font-size: 12px; color: #52525b; text-align: center; margin: 0;">&copy; ${new Date().getFullYear()} Sokar OS. Tous droits réservés.</p>
            </div>
          `
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('[Waitlist] Erreur de Resend:', errData);
      } else {
        console.log('[Waitlist] Email de bienvenue envoyé avec succès via Resend.');
      }
    } catch (err) {
      console.error('[Waitlist] Erreur réseau avec Resend:', err);
    }
  }

  // Si aucune clé n'est fournie, on simule une réussite pour le dev local
  if (!brevoKey && !resendKey) {
    console.log('[Waitlist] [Dev Info] Aucun jeton API Brevo ou Resend défini dans le fichier .env. Mode simulation activé.');
  }

  return { success: true };
}
