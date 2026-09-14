# P0 Usage — paquet comptable fichier du 14 septembre 2026

Le paquet d'août est le premier artefact aval exploitable sans choisir un
éditeur comptable. Il est généré localement à partir du CSV opérateur, du
rapport de rapprochement réel et de la facture Telnyx téléchargée ; aucune
requête réseau ni écriture de base n'est effectuée par le constructeur.

Commande exécutée :

```zsh
pnpm --filter @sokar/api usage:accounting:package -- \
  --month 2026-08 \
  --usage-csv ./private/sokar-usage-accounting-2026-08.csv \
  --invoice ./private/telnyx-invoice-2026-08.json \
  --invoice-pdf ./private/telnyx-invoice-2026-08.pdf \
  --reconciliation ./private/telnyx-reconciliation-2026-08.json \
  --mrc-amount 1.00 --mrc-currency USD \
  --output-dir ./private/accounting/2026-08
```

Le résultat est dans `private/accounting/2026-08/` (répertoire ignoré par
Git) :

- `sokar-usage-accounting-2026-08.csv` : export ledger en EUR, avec l'en-tête
  versionné et aucune ligne d'usage sur août ; SHA-256
  `57f7c3a69d3ac0b604aab8957483119873028844c7b1bff966975b9fd4a0ab6d` ;
- `sokar-vendor-invoices-2026-08.csv` : une ligne `MRC`, `1,00 USD`, facture
  Telnyx `e1d3f6aa-db84-43b9-87d7-6c5331a68cb1`, statut `PAID` ; SHA-256
  `e45f863e999007be42275834ca28e1bdc8a0a76652938356be1837128e372076` ;
- `sokar-reconciliation-2026-08.json` : `MATCH=2`, tous les autres statuts
  à zéro, `reportHash`
  `9db94f1930d99979ee97fc538cca2d6e96faf4d7641ae41610a0d1ec79f36087` ;
- `telnyx-invoice-2026-08.pdf` : pièce jointe fournisseur, SHA-256
  `684e7026b10a8001b8d522f41071f469459d5ed171ab232083585d3eb23ae4fe` ;
- `sokar-accounting-package-2026-08.json` : manifeste, package ID
  `sokar-accounting-2026-08-d8a10ba20b03fe95`, statut
  `READY_FOR_IMPORT`.

Le MRC USD est donc dans le fichier fournisseur, séparé du CSV d'usage EUR ;
aucune conversion implicite n'est appliquée. Le statut reste
`READY_FOR_IMPORT` car aucun outil comptable ni identifiant de réception n'a
été configuré. Ce paquet reste un artefact interne disponible pour une étape
ultérieure ; son absence d'import ne bloque ni le cockpit admin ni le produit
restaurateur. Après choix de la destination, l'import devra conserver le
`packageId`, le manifeste et le reçu dans le dossier de preuve.
