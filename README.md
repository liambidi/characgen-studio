# CharacGen Studio

Transforme un récit en livre illustré. On importe un PDF ou un fichier texte,
l'outil en extrait les personnages, les décors et les scènes, génère les
illustrations correspondantes, puis compose un livre exportable en PDF.

## Ce dont vous avez besoin

- Node.js 20 ou plus récent
- Une clé API Google Gemini, à créer sur [Google AI Studio](https://aistudio.google.com/apikey)

## Démarrer

```bash
npm install
npm run dev               # démarre l'interface
```

L'application s'ouvre sur `http://localhost:3000`.

**Où passent les appels à Google ?** Par une Edge Function
(`netlify/edge-functions/gemini.ts`), la seule à connaître la clé API. `npm run dev`
ne lance que Vite, qui ignore tout de cette fonction : l'adresse `/api/gemini`
répondait donc 404 dès qu'on importait un récit. `vite.config.ts` renvoie
désormais ces appels vers le site déployé, où la fonction tourne pour de bon.
Aucune clé n'est nécessaire en local, mais ces appels consomment le quota du site
en ligne.

**Pour travailler sur la fonction serveur elle-même**, il faut la vraie pile
Netlify, donc une clé locale :

```bash
cp .env.example .env      # puis coller votre clé dans le fichier .env
npx netlify dev           # interface + Edge Function, sur http://localhost:8888
```

## Comment l'analyse d'un récit fonctionne

Deux serveurs se partagent le travail, pour une raison de durée.

| Serveur | Budget | Ce qu'il fait |
|---|---|---|
| Edge Function `netlify/edge-functions/gemini.ts` | environ 35 s | Images, fiches courtes, discussion, recherche d'éléments manquants |
| Fonction d'arrière-plan `netlify/functions/analyse-background.mts` | 15 min | Analyse d'un récit importé, qui construit la bible graphique |

L'analyse vivait au départ dans l'Edge Function. Elle en a été sortie le
25 août 2026 : le seul appel final au modèle demande une trentaine de secondes,
même sur un texte court, et le résumé des tranches d'un vrai PDF faisait déborder.
L'import échouait alors en `Erreur serveur (500)`, dont le corps disait
`the edge function timed out`.

Une fonction d'arrière-plan ne peut rien renvoyer à celui qui l'appelle : Netlify
lui répond `202` tout de suite. Elle dépose donc son avancement puis son résultat
dans Netlify Blobs, et le navigateur vient les lire toutes les deux secondes via
`netlify/functions/analyse-statut.mts`. C'est ce qui alimente le texte
« Lecture du récit : 4 tranches sur 12 » pendant l'attente.

Les consignes envoyées au modèle et la liste des modèles vivent dans
`netlify/shared/analyse.ts`, importé par les deux serveurs : il n'y a qu'un seul
endroit à modifier.

## La clé API

La clé vit uniquement côté serveur, dans la variable `GEMINI_API_KEY`. Elle
n'est jamais envoyée au navigateur et n'apparaît pas dans le code compilé.

En production, elle se règle dans Netlify, sous *Site configuration*,
*Environment variables*.

> **Fixez un plafond de dépense** sur la console Google Cloud. Le point d'appel
> de la fonction est public : la validation des entrées et la limite de trente
> requêtes par minute et par adresse freinent les abus, mais seul un plafond
> côté Google garantit qu'aucune facture ne s'emballe.

## Le parcours en sept étapes

| Étape | Ce qui se passe |
|---|---|
| Importer | Lecture du PDF ou du texte, puis analyse du récit |
| Casting | Révision des personnages détectés, choix du style artistique |
| Décors | Révision des lieux détectés |
| Galerie | Génération des fiches personnages et des décors |
| Script | Découpage en scènes, choix du format de livre |
| Storyboard | Génération des illustrations de chaque scène |
| Livre | Mise en page finale, export PDF ou HTML |

Le projet s'enregistre tout seul dans le navigateur après chaque modification.
Le menu *Sauvegarder* permet en plus d'exporter un fichier `.json` rechargeable
et une archive `.zip` de toutes les images.

## Organisation des fichiers

```
App.tsx                       Parcours, état du projet, files de génération
index.css                     Styles globaux et Tailwind
tailwind.config.js            Palette, polices, animations
components/                   Un composant par écran, plus les fenêtres
services/
  geminiService.ts            Appels à la fonction serveur
  dataService.ts              Sauvegarde IndexedDB, imports et exports
  pdfService.ts               Lecture des PDF
  notifications.ts            Messages et confirmations
  fichiers.ts                 Gardes communes sur les fichiers importés
netlify/
  shared/analyse.ts           Découpage, validation, prompts, liste des modèles
  edge-functions/gemini.ts    Images, fiches courtes, discussion (Deno)
  functions/
    analyse-background.mts    Analyse d'un récit, 15 minutes de budget
    analyse-statut.mts        Avancement et résultat de l'analyse
tests/                        Tests des prompts et du découpage
```

`netlify/shared/analyse.ts` est importé par les deux serveurs. Il ne fait
**aucun import** lui-même, et cela ne doit pas changer : l'Edge Function tourne
sous Deno et charge le SDK Google depuis une URL, la fonction d'arrière-plan
tourne sous Node et le charge depuis `node_modules`. Un test garde cette règle.

## Commandes

```bash
npm run dev          # interface, appels IA renvoyés vers le site déployé (usuel)
npx netlify dev      # interface + Edge Function en local, pour modifier la fonction
npm run build        # compile dans dist/
npm run type-check   # vérifie les types du navigateur et des fonctions Node
npm run check:edge   # vérifie les types de l'Edge Function, sous Deno
npm test             # découpage du texte, prompts, gardes d'entrée
npm run verify       # les quatre d'affilée, avant de déployer
```

**`npm run check:edge` demande Deno.** Le `tsconfig.json` exclut
`netlify/edge-functions` : ce code tourne sous Deno, importe le SDK Google par
URL et utilise le global `Netlify`, trois choses que le TypeScript du navigateur
ne sait pas résoudre. Le fichier le plus sensible du projet, le seul à manipuler
la clé API, n'était donc vérifié par rien avant d'être mis en ligne. Deno le
vérifie avec la carte d'imports de `netlify/edge-functions/deno.check.json`,
qui reproduit celle que Netlify fournit à l'exécution. Ce fichier ne s'appelle
pas `deno.json` exprès : il ne doit rien changer au build ni au déploiement.

## À propos des tests

Ils ne testent pas l'intelligence artificielle, qui n'est pas prévisible, mais
la **construction des questions qu'on lui pose**. C'est là que se logent les
pannes silencieuses : pendant plusieurs mois, les trois fonctions de recherche
recevaient le texte du récit sans jamais le transmettre au modèle, qui répondait
donc en inventant. Le premier test du fichier détecte exactement ce cas.

Depuis le 25 août 2026, ils ne se contentent plus de relire le texte des
fichiers : ils appellent réellement les fonctions de `netlify/shared/analyse.ts`
et vérifient leur sortie. C'est ce qui permet de détecter une perte de contenu,
qu'une simple lecture de chaîne ne voit pas.

Lancez `npm run verify` après toute modification du dossier `netlify/`.

## Quand Google retire un modèle

C'est déjà arrivé, et cela avait mis toute l'application à l'arrêt. Les noms de
modèles sont maintenant regroupés en haut de `netlify/shared/analyse.ts`,
dans la constante `MODELES`, et chaque rôle liste plusieurs modèles par ordre de
préférence. Si le premier n'existe plus, le code bascule tout seul sur le
suivant et le signale dans les journaux.

Pour voir les modèles réellement disponibles avec votre clé :

```bash
node -e "import('@google/genai').then(async ({GoogleGenAI}) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  for await (const m of await ai.models.list()) console.log(m.name);
})"
```
