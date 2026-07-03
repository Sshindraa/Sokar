# Widget embarqué Sokar

Le widget de réservation Sokar peut être intégré sur n'importe quel site web
via un simple snippet JavaScript. Il s'affiche dans un iframe auto-redimensionné
et reprend le flow hold/confirm/idempotency déjà utilisé sur Sokar Connect.

## Intégration

Copiez le snippet depuis le dashboard (`/dashboard/widget`) et collez-le dans le
HTML de votre site, à l'endroit où vous souhaitez afficher le formulaire :

```html
<script
  src="https://sokar.tech/embed.js"
  data-slug="chez-sokar-demo"
  data-primary="#0f172a"
  data-accent="#f97316"
></script>
```

Seul l'attribut `data-slug` est obligatoire. Les couleurs `data-primary` (texte
et bordures) et `data-accent` (boutons et focus) sont optionnelles et valent par
défaut le thème Sokar.

## Hôte personnalisé (local / staging)

Par défaut le snippet charge le widget depuis `https://sokar.tech`. Pour tester en
local ou sur un autre environnement, ajoutez `data-host` :

```html
<script
  src="http://localhost:3000/embed.js"
  data-slug="chez-sokar-demo"
  data-host="http://localhost:3000"
  data-primary="#0f172a"
  data-accent="#f97316"
></script>
```

## Fonctionnement

`/embed.js` injecte un iframe pointant vers `/widget/:slug?embedded=1`. Le widget
envoie sa hauteur au parent via `postMessage` (type `sokar-widget-resize`) ; le
script ajuste alors la hauteur de l'iframe automatiquement. Le middleware Connect
autorise explicitement le framing de `/widget/*` depuis n'importe quel domaine via
la directive CSP `frame-ancestors *`.

## Limites et prochaines étapes

Pour le MVP, n'importe quel domaine peut embarquer le widget d'un restaurant
public. En production, on pourra restreindre `frame-ancestors` aux domaines
enregistrés dans les paramètres du restaurant. La customisation reste limitée aux
deux couleurs ; le multi-langue et les analytics avancés sont hors scope.
