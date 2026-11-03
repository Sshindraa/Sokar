# Reprise de confirmation après une question pratique

Correctif du scénario de l'appel test `3d6e51c6` (25 octobre 2026) : après la
question sur la terrasse et le refus du transfert, l'agent demandait de nouveau
l'accord mais gardait `awaiting=none`. Le oui déclenchait `create_reservation`,
refusé comme `recap_not_read`, puis un nouveau récapitulatif via un second passage.

Le tour structuré distingue désormais :

- `confirmation` : lecture du récapitulatif complet suivie de la demande d'accord ;
- `humanFallback` : accord demandé pour un transfert ou un message ;
- `confirmationResume` : demande courte d'accord après une parenthèse, uniquement
  si le récapitulatif complet a été entendu et reste identique au brouillon.

`resumableRecapKey` reste en mémoire dans la session. Le modèle ne reçoit que
`canResumeConfirmation`, calculé à partir de cette empreinte et de la lecture
interrompue éventuelle. Aucun mot-clé de transcription ne décide du consentement.
Une correction de date, heure, convives ou nom, un refus de réserver ou une
lecture coupée invalident la reprise. Une disponibilité vérifiée et une
affirmation en réponse à la demande de confirmation restent indispensables.
Un oui à une autre question, y compris au transfert, ne peut pas créer la réservation.

La création conserve son passage normal de formulation du résultat réel après
succès ; seul le passage inutile de refus/relecture est évité. Aucun délai de
silence, fournisseur, clé, réglage de synthèse ou contrat public n'est modifié.
La portée du refus final ambigu reste un sujet distinct.

## Vérification

- Test moteur : récapitulatif → terrasse → proposition du gérant → refus du
  transfert → demande courte → oui → une seule création, sans refus de garde-fou.
- Tests négatifs : récapitulatif absent/coupé, changement de chacun des quatre
  champs, refus de réserver, absence de disponibilité et oui à une autre question.
- Suite voix : 1 555 tests passés ; typecheck et lint ciblé sans erreur.
- Rejeu du modèle réel GPT-6 Luna avec prompt et schéma locaux, clé staging :
  question terrasse → `humanFallback`, refus du transfert → `confirmationResume`, oui à la réservation →
  `create_reservation`, oui au transfert → `transfer`. Aucune action métier
  exécutée. Résultats temporaires hors dépôt : `/tmp/sokar-confirmation-model-results.jsonl`.

Après livraison, contrôler sur un appel de test informé : question pratique,
refus du transfert puis accord de réservation ; une seule réservation, aucun
`actionDecision=recap_not_read` sur ce parcours, durée jusqu'au premier audio.
Ne pas confondre ce rejeu de modèle avec une recette téléphonique réelle ni
promettre un gain de latence chiffré avant cette mesure. Retour arrière : rollback
applicatif habituel ; aucun changement de schéma ou de données à restaurer.
