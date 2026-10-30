# Revue des réponses SMS et WhatsApp Telnyx

Les réponses entrantes reçues par les webhooks Telnyx ne modifient aucune réservation tant que leur rattachement n'est pas fiable. Un identifiant fournisseur et le canal sont placés dans `dead-letter`, sans numéro ni texte du message. Les accusés de livraison restent traités normalement.

Pour repérer les éléments à examiner, depuis l'environnement API :

```sh
pnpm --filter @sokar/api ops:dead-letter list --queue inbound-reply-review --json
```

`originalJobId` et `dataPreview.providerMessageId` identifient le message chez Telnyx. Les entrées sont volontairement non rejouables. L'opérateur doit vérifier son accès aux messages ou aux événements Telnyx et établir le restaurant et la réservation avant toute action manuelle. Ne pas copier le numéro, le texte ou une capture dans un journal applicatif. Une entrée ne se retire qu'après traitement ou décision documentée.

Si la file est inaccessible ou si le message n'a pas d'identifiant, le webhook répond 503 ; cela ne garantit pas que le message pourra être récupéré. Vérifier les échecs dans Telnyx et sa configuration de secours. Aucun retour automatique n'est envoyé au client ; les restaurants doivent traiter les demandes par leur canal habituel. Tester la consultation et le suivi en staging avant de compter sur cette procédure.
