/**
 * Fabrique le projet de demonstration de l'atelier de reglage.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * L'atelier promet huit directions sur les sept etapes. Sans projet charge, il
 * n'en montre qu'une : l'import. Juger le Casting, le Script, le Storyboard et
 * le Livre demanderait d'importer un roman entier puis de lancer une vingtaine
 * de generations, donc du temps et des credits, pour ne regarder que des
 * couleurs. Ce fichier produit un projet complet dont toutes les images sont
 * des SVG dessines ici meme : les sept etapes s'affichent, et rien n'est
 * demande a Google.
 *
 * CE QU'IL CONTIENT VOLONTAIREMENT DE PENIBLE
 *
 * Un banc d'essai qui ne montre que des cas heureux ne prouve rien. Le projet
 * porte donc, deliberement : un personnage en echec avec son message, un
 * personnage sans image, une scene au reperage incertain, une scene en echec,
 * les trois niveaux d'importance, les quatre types de decor, un nom trop long
 * pour sa carte, et des accents partout. Une direction se juge sur ses etats
 * d'erreur autant que sur sa page d'accueil.
 *
 * Usage : node scripts/projet-demo.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import LZString from 'lz-string';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- Les images ---------------------------------------------------
   Volontairement peu saturees. Une planche placee la pour juger une direction
   ne doit pas apporter sa propre couleur dominante, sinon c'est elle qu'on
   juge. Les teintes restent entre 14 et 22 % de saturation.
   ------------------------------------------------------------------------- */

const svg = (contenu, l = 900, h = 600) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l} ${h}" width="${l}" height="${h}">${contenu}</svg>`
  );

/** La planche a trois vues : face, profil, trois quarts, comme l'app la demande. */
const planche = (teinte, initiales) => {
  const fond = `hsl(${teinte},16%,86%)`;
  const corps = `hsl(${teinte},20%,58%)`;
  const trait = `hsl(${teinte},14%,40%)`;
  const vues = ['FACE', 'PROFIL', '3/4'];
  const cellules = vues
    .map((vue, i) => {
      const x = i * 300;
      const cx = x + 150;
      return (
        `<g>` +
        (i > 0 ? `<line x1="${x}" y1="0" x2="${x}" y2="600" stroke="${trait}" stroke-width="2" opacity="0.35"/>` : '') +
        `<circle cx="${cx}" cy="215" r="62" fill="${corps}"/>` +
        `<path d="M ${cx - 92} 600 L ${cx - 70} 380 Q ${cx} 318 ${cx + 70} 380 L ${cx + 92} 600 Z" fill="${corps}"/>` +
        `<text x="${cx}" y="566" font-family="monospace" font-size="20" fill="${trait}" text-anchor="middle" opacity="0.75">${vue}</text>` +
        `</g>`
      );
    })
    .join('');
  return svg(
    `<rect width="900" height="600" fill="${fond}"/>${cellules}` +
      `<text x="22" y="44" font-family="monospace" font-size="26" fill="${trait}" opacity="0.6">${initiales}</text>`
  );
};

/** Un decor : des bandes d'horizon, un astre, une masse au premier plan. */
const decor = (teinte, astre) => {
  const ciel = `hsl(${teinte},18%,80%)`;
  const fond = `hsl(${teinte},16%,66%)`;
  const median = `hsl(${teinte},18%,52%)`;
  const proche = `hsl(${teinte},20%,36%)`;
  return svg(
    `<rect width="900" height="600" fill="${ciel}"/>` +
      (astre ? `<circle cx="700" cy="150" r="66" fill="hsl(${teinte},22%,90%)" opacity="0.9"/>` : '') +
      `<path d="M0 330 L210 236 L400 322 L610 220 L900 320 L900 600 L0 600 Z" fill="${fond}"/>` +
      `<path d="M0 420 L250 356 L520 430 L900 370 L900 600 L0 600 Z" fill="${median}"/>` +
      `<path d="M0 508 L320 470 L660 520 L900 486 L900 600 L0 600 Z" fill="${proche}"/>`
  );
};

/** Une scene : un decor plus deux silhouettes, pour qu'on lise une action. */
const planche_scene = (teinte, numero) => {
  const ciel = `hsl(${teinte},18%,78%)`;
  const sol = `hsl(${teinte},18%,50%)`;
  const figure = `hsl(${teinte},22%,26%)`;
  const trait = `hsl(${teinte},14%,34%)`;
  const silhouette = (cx, echelle) =>
    `<g transform="translate(${cx},0) scale(${echelle}) translate(${-cx},0)">` +
    `<circle cx="${cx}" cy="352" r="34" fill="${figure}"/>` +
    `<path d="M ${cx - 52} 600 L ${cx - 40} 424 Q ${cx} 382 ${cx + 40} 424 L ${cx + 52} 600 Z" fill="${figure}"/>` +
    `</g>`;
  return svg(
    `<rect width="900" height="600" fill="${ciel}"/>` +
      `<path d="M0 392 L900 356 L900 600 L0 600 Z" fill="${sol}"/>` +
      silhouette(330, 1) +
      silhouette(576, 0.86) +
      `<text x="864" y="566" font-family="monospace" font-size="24" fill="${trait}" text-anchor="end" opacity="0.65">PL. ${numero}</text>`
  );
};

/* ---------- Le recit ------------------------------------------------------ */

const RECIT = `LA MAISON DE LA DOUANE

Chapitre premier

La pluie tombait sur Kervarec depuis onze jours. Maelle Trevidic remonta le
col de son cire et poussa la porte de la maison de la douane, dont personne
n'avait tourne la clef depuis la mort du vieux Corentin. A l'interieur,
l'odeur du sel et du bois mouille avait remplace celle du tabac.

Elle posa sa lampe sur la table. Le registre etait la, ouvert a la page du
douze novembre, et quelqu'un y avait ecrit apres lui.

Chapitre deux

Au matin, le brouillard avait mange la jetee. Ivan Bourdelot l'attendait
devant le phare, les mains dans les poches, avec cette facon qu'il avait de
regarder la mer comme si elle lui devait de l'argent.

Rentre chez toi, dit-il. Cette histoire n'est pas la tienne.

Maelle lui montra la page arrachee. Il ne la prit pas.

Chapitre trois

La cave du presbytere sentait la craie. Soeur Anne-Lise descendit la premiere,
sa lanterne au bout du bras, et s'arreta net devant la porte muree. On
l'avait fermee proprement, avec de la chaux fraiche, et cela ne faisait pas
trente ans que le vieux Corentin etait mort.

Chapitre quatre

Le fils Kerdraon parlait peu. Il conduisait sa barque a travers les cailloux
comme d'autres traversent leur salon, et quand Maelle lui demanda ce qu'il
avait vu la nuit du douze, il regarda longtemps l'horizon avant de repondre
qu'il n'avait rien vu du tout, ce qui, chez lui, voulait dire le contraire.

Chapitre cinq

La tempete arriva le jeudi. Elle emporta le hangar a filets, deux barques et
la moitie du toit de la maison de la douane, et decouvrit sous les ardoises
une caisse de bois cerclee de fer que personne n'avait cherchee parce que
personne ne savait qu'elle existait.

Chapitre six

Ils se retrouverent tous les quatre dans la salle basse, autour de la caisse
ouverte. Dedans, il n'y avait pas d'or. Il y avait cent quarante lettres,
toutes de la meme ecriture, toutes adressees a une femme morte en 1943.

Chapitre sept

Au petit jour, Maelle brula les lettres une a une dans l'atre du presbytere.
Ivan la regarda faire sans rien dire. Quand la derniere eut pris, il posa sa
main sur son epaule, et ce fut la seule chose qu'il trouva a faire.`;

/* ---------- Les personnages ---------------------------------------------- */

const personnages = [
  {
    id: 'p1',
    name: 'Maëlle Trévidic',
    role: 'Douanière, revenue au pays après quinze ans',
    importance: 'principal',
    shortDescription: "Elle rouvre une maison que tout le village préférait fermée.",
    personality: "Obstinée sans être bruyante. Elle pose les questions que les autres contournent, et supporte mal qu'on lui réponde par le silence.",
    physicalDescription: "Femme de quarante ans, cheveux châtains coupés court, ciré jaune délavé, mains abîmées par le sel.",
    imageUrl: planche(28, 'MT'),
    status: 'completed',
  },
  {
    id: 'p2',
    name: 'Ivan Bourdelot',
    role: 'Gardien du phare',
    importance: 'principal',
    shortDescription: "Il sait, et il a décidé il y a longtemps de ne pas dire.",
    personality: "Taiseux par habitude plus que par nature. Loyal à un mort.",
    physicalDescription: "Homme massif, barbe grise taillée court, veste de quart bleu marine, une cicatrice sur le dos de la main gauche.",
    imageUrl: planche(206, 'IB'),
    status: 'completed',
  },
  {
    id: 'p3',
    name: 'Sœur Anne-Lise Le Goaziou de Kernévez',
    role: 'Religieuse, archiviste du presbytère',
    importance: 'secondaire',
    shortDescription: "Un nom volontairement trop long : il faut bien qu'une carte apprenne à se taire.",
    personality: "Méthodique, ironique, peu impressionnée par les autorités civiles.",
    physicalDescription: "Femme âgée, petite, lunettes rondes, habit gris, lanterne tempête toujours à portée.",
    imageUrl: planche(140, 'AL'),
    status: 'completed',
  },
  {
    id: 'p4',
    name: 'Le fils Kerdraon',
    role: 'Pêcheur',
    importance: 'secondaire',
    shortDescription: "Il répond non quand il veut dire oui.",
    personality: "Méfiant, précis, économe de ses mots comme de son carburant.",
    physicalDescription: "Jeune homme sec, bonnet de laine noire, vareuse rapiécée, toujours pieds nus dans ses bottes.",
    imageUrl: planche(18, 'FK'),
    status: 'completed',
  },
  {
    id: 'p5',
    name: 'Corentin Trévidic',
    role: 'Ancien douanier, mort avant le récit',
    importance: 'figurant',
    shortDescription: "Il n'apparaît jamais, et tout le livre tourne autour de lui.",
    personality: "Rigoureux jusqu'à la manie, secret jusqu'au mensonge.",
    physicalDescription: "Homme de soixante-dix ans sur une photographie jaunie, uniforme des douanes, casquette à la main.",
    imageUrl: undefined,
    status: 'pending',
  },
  {
    id: 'p6',
    name: 'Yveline Corre',
    role: 'Postière',
    importance: 'figurant',
    shortDescription: "Elle a lu toutes les enveloppes sans jamais ouvrir une lettre.",
    personality: "Curieuse, bavarde, parfaitement honnête à sa façon.",
    physicalDescription: "Femme d'une soixantaine d'années, chignon, blouse bleue, lunettes remontées sur le front.",
    imageUrl: undefined,
    status: 'error',
    errorMessage:
      "La génération a été refusée par le modèle.\nLa description mentionne une personne réelle identifiable : reformulez-la en termes physiques généraux, puis relancez.",
  },
];

/* ---------- Les décors ---------------------------------------------------- */

const decors = [
  {
    id: 'd1',
    name: 'La maison de la douane',
    importance: 'principal',
    type: 'indoor',
    description:
      "Salle basse aux murs chaulés, table de chêne massif, registre ouvert, lampe à pétrole, sol de dalles inégales, fenêtre à petits carreaux donnant sur la jetée.",
    mood: "Lumière rasante et froide, poussière en suspension, odeur de sel et de bois mouillé.",
    imageUrl: decor(30, false),
    status: 'completed',
  },
  {
    id: 'd2',
    name: 'La jetée et le phare',
    importance: 'principal',
    type: 'outdoor',
    description:
      "Digue de granit battue par la houle, phare trapu à bandes blanches et rouges, bittes d'amarrage rongées, brouillard bas.",
    mood: "Gris uniforme, horizon absent, embruns, lumière diffuse sans source visible.",
    imageUrl: decor(205, true),
    status: 'completed',
  },
  {
    id: 'd3',
    name: 'La cave du presbytère',
    importance: 'secondaire',
    type: 'indoor',
    description:
      "Voûte basse en pierre, murs de craie, porte murée à la chaux fraîche, marches usées, casiers à bouteilles vides.",
    mood: "Noir presque total percé par une lanterne, ombres portées immenses, humidité.",
    imageUrl: decor(96, false),
    status: 'completed',
  },
  {
    id: 'd4',
    name: 'Le souvenir de 1943',
    importance: 'figurant',
    type: 'abstract',
    description:
      "Superposition de fragments : écriture manuscrite, timbre oblitéré, silhouette de femme à contre-jour, papier brûlé aux bords.",
    mood: "Sépia délavé, contours instables, tout est à demi effacé.",
    imageUrl: decor(42, true),
    status: 'completed',
  },
];

/* ---------- Les scènes ---------------------------------------------------- */

const scenesBrutes = [
  ['s1', "L'ouverture de la maison", 'La maison de la douane', 'd1', "Maëlle pousse la porte restée fermée depuis la mort de Corentin et pose sa lampe sur la table.", ['Maëlle Trévidic'], 30, false, 'completed'],
  ['s2', 'Une écriture après la sienne', 'La maison de la douane', 'd1', "Penchée sur le registre, Maëlle découvre que quelqu'un a écrit après la dernière ligne du vieux douanier.", ['Maëlle Trévidic'], 34, false, 'completed'],
  ['s3', "L'avertissement du phare", 'La jetée et le phare', 'd2', "Ivan barre le chemin à Maëlle dans le brouillard et lui dit de rentrer chez elle.", ['Maëlle Trévidic', 'Ivan Bourdelot'], 205, false, 'completed'],
  ['s4', 'La porte murée', 'La cave du presbytère', 'd3', "Sœur Anne-Lise descend la première et s'arrête net devant un mur de chaux trop fraîche pour son âge supposé.", ['Sœur Anne-Lise Le Goaziou de Kernévez'], 96, false, 'completed'],
  ['s5', "Ce que le fils Kerdraon n'a pas vu", 'La jetée et le phare', 'd2', "Interrogé sur la nuit du douze, le pêcheur regarde l'horizon longtemps avant de répondre qu'il n'a rien vu.", ['Le fils Kerdraon', 'Maëlle Trévidic'], 200, true, 'completed'],
  ['s6', 'La tempête découvre le toit', 'La maison de la douane', 'd1', "Le vent arrache la moitié des ardoises et met au jour une caisse de bois cerclée de fer.", ['Maëlle Trévidic'], 24, false, 'completed'],
  ['s7', 'Cent quarante lettres', 'La maison de la douane', 'd1', "Les quatre personnages entourent la caisse ouverte, remplie non pas d'or mais de lettres.", ['Maëlle Trévidic', 'Ivan Bourdelot', 'Sœur Anne-Lise Le Goaziou de Kernévez', 'Le fils Kerdraon'], 38, false, 'completed'],
  ['s8', "L'âtre du presbytère", 'Le souvenir de 1943', 'd4', "Maëlle brûle les lettres une à une pendant qu'Ivan la regarde faire sans rien dire.", ['Maëlle Trévidic', 'Ivan Bourdelot'], 42, false, 'error'],
];

const extraits = RECIT.split(/\n\nChapitre[^\n]*\n\n/).filter(p => p.trim().length > 60);

const scenes = scenesBrutes.map(([id, title, location, environmentId, description, charactersPresent, teinte, incertain, status], i) => ({
  id,
  title,
  location,
  environmentId,
  environmentDetail: decors.find(d => d.id === environmentId)?.description ?? '',
  description,
  originalTextExcerpt: (extraits[i % extraits.length] || '').trim().slice(0, 420),
  ...(incertain ? { reperageIncertain: true } : {}),
  charactersPresent,
  imageUrl: status === 'completed' ? planche_scene(teinte, i + 1) : undefined,
  status,
  ...(status === 'error'
    ? {
        errorMessage:
          "Le service a répondu 429, trop de demandes.\nLa scène n'a pas été facturée : relancez-la seule dans une minute.",
      }
    : {}),
}));

/* ---------- Assemblage ---------------------------------------------------- */

const projet = {
  version: '2.0',
  /* Date fixe : un horodatage tire de l'horloge rendrait le fichier different
     a chaque execution, pour rien. */
  timestamp: Date.UTC(2026, 7, 26, 6, 0, 0),
  project: {
    titre: 'La maison de la douane, projet de démonstration',
    characters: personnages,
    environments: decors,
    scenes,
    stylePrompt:
      "Illustration au lavis, palette désaturée de gris bleutés et de sables, lumière du nord, traits d'encre fins, ambiance de littoral breton en novembre.",
    fullText: LZString.compressToBase64(RECIT),
    /* On ouvre sur le Casting : c'est le premier ecran ou une direction se
       joue vraiment, et toutes les autres etapes sont deja accessibles
       puisque personnages et scenes sont remplis. */
    currentStep: 2,
    formatId: 'moyen_p',
    cadrage: 'paysage',
    resolution: '2K',
  },
};

mkdirSync(join(RACINE, 'docs'), { recursive: true });
const chemin = join(RACINE, 'docs', 'projet-demo-atelier.json');
writeFileSync(chemin, JSON.stringify(projet), 'utf8');

const octets = JSON.stringify(projet).length;
console.log(`Ecrit : ${chemin}`);
console.log(`${personnages.length} personnages, ${decors.length} decors, ${scenes.length} scenes, ${(octets / 1024).toFixed(0)} ko.`);
console.log(`Etats couverts : ${[...new Set([...personnages, ...decors, ...scenes].map(o => o.status))].join(', ')}.`);
