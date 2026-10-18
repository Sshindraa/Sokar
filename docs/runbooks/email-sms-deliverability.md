# Délivrabilité des e-mails et des SMS

Audit du 17 octobre 2026 (production).

## E-mails

| Élément                     | État                                                                                                                   | Action                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Envoi applicatif            | Resend, `noreply@sokar.tech`, signature DKIM `resend._domainkey` et retour `send.sokar.tech` (SPF Amazon SES) présents | Rien                                                      |
| Nom affiché                 | Adresse nue, affichée « noreply »                                                                                      | Corrigé : `Sokar <noreply@sokar.tech>` (`emailSender`)    |
| Réponses                    | Partaient vers `noreply`                                                                                               | Corrigé : `Reply-To: hello@sokar.tech` (`EMAIL_REPLY_TO`) |
| Adresse de secours du code  | `noreply@sokar.fr` (domaine non vérifié)                                                                               | Corrigé                                                   |
| Clerk (connexion)           | DKIM `clk`/`clk2` et `clkmail` présents                                                                                | Rien                                                      |
| Google Workspace (`hello@`) | DKIM `google._domainkey` présent, mais **SPF racine sans Google**                                                      | DNS ci-dessous                                            |
| DMARC                       | **Absent** (exigé par Gmail et Yahoo pour les envois en volume)                                                        | DNS ci-dessous                                            |

### Enregistrements à poser chez Cloudflare

1. Remplacer le SPF racine `sokar.tech` (TXT) par :

   ```text
   v=spf1 include:_spf.google.com include:mail.qald09162xf0.clerk.services ~all
   ```

2. Ajouter `_dmarc.sokar.tech` (TXT) :

   ```text
   v=DMARC1; p=none; rua=mailto:hello@sokar.tech; adkim=r; aspf=r
   ```

   Lire les rapports deux à quatre semaines, puis passer à `p=quarantine` quand Resend, Clerk et
   Google sortent tous alignés.

## SMS

| Élément                     | État                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Numéro `TELNYX_FROM_NUMBER` | Numéro fixe (« longcode »), **rattaché à aucun profil de messagerie**, compteur Telnyx à 0 : aucun SMS n'est parti en production |
| Profil de messagerie        | « Sokar transactional » existe (destinations FR), mais `TELNYX_MESSAGING_PROFILE_ID` n'est pas configuré                         |
| WhatsApp                    | `TELNYX_WHATSAPP_FROM` configuré ; le rappel J-1 tente WhatsApp puis bascule sur SMS                                             |

Le code accepte désormais `TELNYX_SMS_FROM`, distinct du numéro d'appel.

### Réglage recommandé

1. Dans la console Telnyx, profil « Sokar transactional » : activer un identifiant alphanumérique
   `SOKAR` (vérifier les conditions françaises affichées par Telnyx).
2. Dans `/opt/sokar/apps/api/.env` (et staging) : `TELNYX_MESSAGING_PROFILE_ID=<id du profil>` et
   `TELNYX_SMS_FROM=SOKAR`, puis redémarrer l'API et les workers.
3. Envoyer un SMS de test vers un téléphone de l'équipe et vérifier sa réception.

Un identifiant alphanumérique ne reçoit pas de réponse : les clients ne peuvent plus répondre OUI
ou NON par SMS (le rappel ne le demande pas ; WhatsApp reste possible). Pour des réponses par SMS,
il faut un numéro dédié à la messagerie, à demander à Telnyx pour la France.
