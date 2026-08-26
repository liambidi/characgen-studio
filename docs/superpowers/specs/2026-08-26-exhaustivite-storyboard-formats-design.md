# CharacGen, trois chantiers : exhaustivite, storyboard, formats

Date : 2026-08-26
Statut : execute le 2026-08-26. `npm run verify` au vert, 94 tests. Rien n'est commite ni deploye.

## Ce qui a ete constate

Trois defauts rapportes, un quatrieme trouve pendant la lecture du code.

1. Les recherches de personnages, decors et scenes ne sont pas assez exhaustives.
2. La generation d'images derive, surtout au storyboard : hallucinations, derive de style,
   personnage duplique dans un plan, decor impose au lieu d'etre un repere.
3. Les propositions de format sont mauvaises et l'interface de choix est penible.
4. (Trouve pendant la lecture) Les decors sont generes a l'etape Galerie, avant que le format
   soit choisi a l'etape Scenes. Ils sortent donc tous en 4:3 par defaut, meme si un format
   portrait est choisi ensuite.

## Diagnostic, avec le niveau de certitude

### Chantier 1, exhaustivite

**Verifie** `analyserRecit` (netlify/shared/analyse.ts:624) fait un seul appel avec le recit
entier. Aucune seconde passe, aucun balayage, aucune verification. Un modele a qui on donne
300 000 caracteres d'un coup produit une synthese, pas un inventaire.

**Verifie** Le prompt demande explicitement un tri : « TOUS les personnages importants »,
« les Lieux/Decors recurrents ». Les deux adjectifs autorisent le modele a ecarter.

**Verifie** Le reperage des scenes (analyse.ts:706) est aussi un appel unique sur le texte entier.

**Deduit** Quand le modele saute une scene, `construireSegmentsDepuisCarte` decoupe le texte
entre les citations restantes. Le passage oublie est donc absorbe dans la scene precedente.
L'oubli ne laisse aucune trace, ni en logs ni a l'ecran. C'est le mecanisme central du defaut.

### Chantier 2, storyboard

**Verifie** `presentChars.slice(0, 2)` (gemini.ts:216). Seuls deux personnages sont envoyes en
reference. Au dela, ni image ni description : les visages sont inventes.

**Deduit** La reference envoyee est la planche modele a trois vues (gemini.ts:155). On donne au
modele une image contenant trois fois la meme personne, sans jamais lui dire que c'est la meme.
C'est la piste la plus probable pour le personnage duplique, elle n'est pas mesuree.

**Deduit** Le decor est envoye en image de reference avec la consigne « LOW PRIORITY, DO NOT COPY
THE LAYOUT ». Dans un modele image vers image, une image pese plus qu'une phrase qui dit de ne
pas la suivre.

**Verifie** La derive de style vient de ce que `stylePrompt` est une phrase en texte libre
inventee a l'etape 1, replacee en fin de prompt a chaque image. Aucun ancrage, aucun seed.

**Verifie** Des qu'un `customVisualPrompt` existe (gemini.ts:225), toute la hierarchie de priorite
disparait du prompt. Une retouche manuelle supprime les garde-fous.

### Chantier 3, formats

**Verifie** Dix formats (App.tsx:54) mappes sur quatre ratios. A4, Moyen, A5 et Digest en portrait
donnent tous 3:4, donc exactement la meme image. Idem pour les quatre paysages en 4:3. Dix boutons,
quatre resultats visuels.

**Verifie par calcul** Les ratios annonces sont faux. A4 vaut 0,707 et est annonce 3:4 soit 0,750.
Digest vaut 0,648 pour le meme 3:4, 16 pour cent d'ecart. L'image ne remplit jamais la page.

**Verifie** `resolution` est figee a 1K (App.tsx:134, unique `setGenConfig` du fichier) et n'est
jamais reglable, y compris pour un A4 imprime.

**Verifie** Le choix apparait en bas de l'ecran de relecture des scenes, en dix boutons text-xs,
sans apercu de proportion, sans separation portrait paysage, alors qu'il conditionne les images.

**Verifie** Les decors sont generes a GENERATION_HUB (App.tsx:658) avant que ce choix existe.

## Ce qui a ete tranche par Liam

| Question | Reponse |
|---|---|
| Exhaustivite | Balayage par tranches plus passe de completion, cout assume |
| Planche a trois vues | Elle reste, c'est une condition du workflow. Limiter le bug, avertir au storyboard, laisser relancer |
| Formats | Separer le format du livre et le cadrage de l'image |
| Ordre | Un spec complet des trois, puis execution |

## Conception

### Chantier 1, extraction exhaustive

#### 1A, bible graphique par tranches

Le recit est decoupe en tranches d'environ 40 000 caracteres, en respectant les fins de paragraphe.
`decouperEnParagraphes` (analyse.ts:281) fait deja exactement cela, il est reutilise tel quel.

Chaque tranche part en un appel `texteExpert` qui inventorie les personnages et les decors de cette
tranche seulement. Les tranches partent en parallele, par lots de 4, comme les fiches de scenes le
font deja.

Une passe de consolidation reunit ensuite les inventaires bruts. Elle fusionne les doublons
deguises, un personnage nomme « le vieil homme » dans une tranche et « Maitre Aldric » dans une
autre, tranche les descriptions contradictoires, et redige la fiche finale. `memePersonnage`
(analyse.ts:181) et `memeLieu` (analyse.ts:223) font une premiere passe mecanique avant l'appel,
pour reduire ce que le modele doit traiter.

Les mots « importants » et « recurrents » disparaissent des consignes. A la place, chaque fiche
porte un champ `importance` valant `principal`, `secondaire` ou `figurant`. Le tri passe du modele
a l'utilisateur : l'inventaire est complet, l'interface filtre.

**A confirmer par Liam** : l'ajout du champ `importance` touche `types.ts`, les cartes de relecture
des personnages et des decors, et le choix de ce qu'on genere par defaut. C'est ce qui rend
l'exhaustivite tenable, sinon quarante personnages dont vingt-cinq figurants noient l'ecran.

#### 1B, scenes, carte par tranches et controle de couverture

Le reperage des scenes passe lui aussi par tranches : chaque tranche renvoie les debuts de scene
qu'elle contient, et les cartes sont recollees dans l'ordre du recit.

S'ajoute un controle de couverture, qui est le vrai correctif de l'oubli invisible. Une fois les
segments construits, leur longueur est mesuree. Un segment nettement plus long que la mediane, au
dela de trois fois, signale une scene manquee a l'interieur. Un reperage cible est relance sur ce
segment seul, et les scenes trouvees sont inserees.

Ce que l'utilisateur voit : les scenes issues d'un segment anormal ou d'une citation approximative
(`segment.approche` existe deja) portent un lisere et une phrase qui dit pourquoi.

#### Cout et duree

**Verifie** Aujourd'hui : un appel pour la bible, un appel pour la carte, un appel par scene.

**Deduit** Demain, pour un roman de 300 000 caracteres : huit appels pour la bible plus un de
consolidation, huit appels pour la carte plus les relances ciblees, un appel par scene inchange.

**Suppose** Entre 60 et 120 secondes de plus sur l'analyse complete, dans les 15 minutes de la
fonction d'arriere plan. A mesurer sur un vrai recit avant de conclure.

### Chantier 2, storyboard

#### 2A, dire au modele ce qu'est la planche

Le prompt actuel ne dit jamais que l'image de reference contient trois vues de la meme personne.
Nouveau libelle, explicite :

> REFERENCE IMAGE #n is a CHARACTER MODEL SHEET. It shows the SAME SINGLE PERSON drawn three
> times (front, profile, action) for identification only. X is ONE person, not three.

Et une regle de casting comptee, absente aujourd'hui :

> CAST OF THIS SHOT: exactly N people. [noms]. Each named character appears EXACTLY ONCE.
> No duplicates, no twins, no background copies of the same face.

#### 2B, lever la limite de deux personnages

`slice(0, 2)` passe a 3 images de reference. Les personnages au dela recoivent leur description
physique en texte, ce qu'ils n'ont pas du tout aujourd'hui.

**Suppose** Trois references plutot que deux augmente aussi le risque de melange d'identites.
Trois est un compromis, pas une valeur mesuree.

**A verifier avant execution** Le poids du message. Chaque image en base64 est plafonnee a 12 Mo
cote validation, mais la limite reelle de charge utile de la fonction Netlify n'a pas ete mesuree.

#### 2C, le decor devient un repere

Par defaut, l'image du decor n'est plus envoyee. A la place, sa description texte et son mood, deja
disponibles, entrent dans le prompt. Une case a cocher par scene, « verrouiller le decor sur
l'image de reference », retablit l'ancien comportement quand on veut vraiment la meme piece.

Quand l'image est envoyee, elle passe apres les personnages dans l'ordre des parties du message,
avec une consigne reecrite : nuancier de style et de palette seulement, ne pas reproduire la
composition, l'angle ni le cadrage.

#### 2D, ancrer le style

`suggestedStyle` cesse d'etre une phrase libre. Il devient une charte compacte en champs separes :
medium, traitement du trait, palette dominante, traitement de la lumiere, niveau de detail. Ces
champs sont reinjectes a l'identique dans chaque prompt image, en tete et non en queue.

#### 2E, le prompt personnalise n'ecrase plus la hierarchie

Le bloc `customVisualPrompt` devient un ajout en priorite 1, pas un remplacement du prompt entier.
La hierarchie, la regle de casting et la charte de style restent en place.

#### 2F, avertissement au storyboard, demande par Liam

Un encart persistant sur l'ecran de generation du storyboard :

> La reference de chaque personnage est une planche a trois vues, front, profil, action. Il arrive
> que le modele en recopie deux dans la meme image. Si un personnage apparait en double, relancez
> cette image : le tirage suivant est presque toujours correct.

Le bouton de relance existe deja (`onRetry`, App.tsx:1287), il est simplement rendu accessible
depuis l'encart.

### Chantier 3, formats

#### 3A, deux reglages au lieu d'un

**Le format du livre**, physique, pilote le PDF. Le ratio n'est plus une valeur figee du catalogue,
il est calcule : `largeurMm / hauteurMm`. Le champ `ratio` de `BookFormat` disparait.

**Le cadrage de l'illustration**, ce que l'image occupe dans la page : pleine page, portrait,
carre, paysage.

**A verifier avant execution** L'API Gemini n'accepte que des ratios discrets. Le type actuel liste
1:1, 3:4, 4:3, 9:16, 16:9. Si la liste est bien celle la, « pleine page » choisit le ratio
disponible le plus proche du ratio physique et le PDF recadre. C'est acceptable a condition de le
dire dans l'interface, pas de le taire comme aujourd'hui.

#### 3B, resolution reglable

1K, 2K, 4K, avec la consequence dite en clair a cote de chaque choix : duree de generation et poids
du PDF. Aujourd'hui figee a 1K, y compris pour un A4 imprime.

#### 3C, le choix remonte dans le parcours

Le choix de format quitte le bas de l'ecran des scenes et remonte avant l'etape des decors, donc
juste apres l'analyse du recit. C'est ce qui corrige le quatrieme defaut : les decors ne peuvent
plus etre generes dans un cadrage qui sera contredit ensuite.

Le format retenu reste visible dans l'en-tete, modifiable a tout moment. Le changer apres coup
affiche ce que cela implique : les images deja generees ne sont pas reprises, elles gardent leur
cadrage.

#### 3D, l'interface de choix

Apercu de proportion dessine a l'echelle reelle, pas une icone FontAwesome. Groupement portrait,
paysage, carre. Un format par ratio reellement distinct mis en avant, les tailles voisines
regroupees dessous.

**A confirmer par Liam** Combien de formats garder : dix, avec leurs vrais ratios, ou une liste
plus courte. Ce chantier contient un choix visuel qui appartient a Liam, il passera par le skill
`atelier-de-reglage` au moment de l'execution.

## Ordre d'execution propose

1. **Formats**, le plus court et le plus sur. Il conditionne le cadrage de toutes les images qui
   serviront a tester la suite.
2. **Storyboard**, le plus visible sur le rendu final.
3. **Exhaustivite**, le plus lourd, il touche le serveur et la duree de traitement.

## Verification

Chaque chantier se verifie sur un vrai recit, pas sur un cas fabrique.

- **Formats** : choisir un format portrait avant les decors, verifier que le decor genere sort dans
  ce cadrage et non en 4:3. Exporter le PDF, verifier que la page fait bien les millimetres annonces.
- **Storyboard** : generer dix plans d'un meme recit avant et apres, compter les personnages
  dupliques dans chaque lot. C'est une mesure, pas une impression.
- **Exhaustivite** : sur un recit dont on connait le contenu, compter les personnages et les lieux
  trouves avant et apres. Verifier qu'aucun segment de scene ne depasse trois fois la mediane.

## Points laisses ouverts, tranches et appliques

Liam a repondu « execute tout en suivant tes recommandations » le 2026-08-26.

1. Champ `importance` : **ajoute**, avec un filtre dans les deux ecrans de relecture.
2. Images de reference par scene : **trois**, les suivants en description ecrite.
3. Decor en texte par defaut : **oui**, avec une case de verrouillage par scene.
4. Catalogue de formats : **les dix gardes**, avec leurs vrais ratios, groupes par famille.

## Ce qui a change par rapport a ce spec pendant l'execution

**Verifie, et ca ameliore le chantier 3.** L'API Gemini accepte **huit** ratios et non cinq :
`1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9` (documentation du SDK Google Gen AI, interface
`ImageConfig`). Les deux que le code ignorait, `2:3` et `3:2`, sont celles des livres imprimes.
Le Digest passe de 16 % d'ecart a 2,9 %, le format Moyen tombe a zero, et les dix formats
donnent six proportions distinctes au lieu de deux. `imageSize` accepte bien `1K`, `2K` et `4K`.

**Verifie, defaut supplementaire trouve en cours de route.** La planche personnage etait demandee
« wide » dans le prompt, generee en `1:1`, puis affichee recadree en `aspect-[3/4]` avec
`object-cover` : on n'en voyait qu'un tiers, alors que c'est elle qui sert de reference a tout le
storyboard. Les trois choix ont ete remis d'accord sur `3:2`, affichage en `object-contain`.

**Ecart assume sur le point 2D.** Le spec prevoyait une charte de style en champs separes.
Elle est restee **une chaine unique**, mais dont le contenu est contraint a cinq axes nommes,
medium, trait, palette, lumiere, detail. Raison : Liam edite deja ce champ librement dans l'ecran
du casting, et le decouper en cinq champs lui aurait retire cette liberte pour un gain nul cote
prompt, qui recoit la meme chaine dans les deux cas.

**Retire apres coup.** Un garde-fou levant une erreur quand l'inventaire revient vide a ete
supprime : il affirmait une cause non mesuree, « le fichier ne contient pas de texte », alors que
le symptome est seulement que le modele n'a rien renvoye.

## Ce qui est verifie, et ce qui ne l'est pas

**Verifie** `npm run verify` en entier : types du navigateur, types de l'Edge Function sous Deno,
94 tests dont 33 nouveaux, build de production. Le serveur de developpement transforme sans erreur
chacun des dix modules touches.

**Non verifie** Le rendu reel dans le navigateur : Chrome tournait deja avec le profil du pilote,
et le tuer aurait ferme la session en cours.

**Non verifie** La qualite des images produites. Elle demande un vrai recit, un vrai passage chez
Gemini, et un comptage avant contre apres. C'est le seul juge qui compte pour les chantiers 1 et 2.
