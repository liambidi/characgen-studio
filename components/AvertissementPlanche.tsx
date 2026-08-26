import React from 'react';

/**
 * Avertissement sur le personnage qui apparaît en double dans un plan.
 *
 * POURQUOI CET ENCART EXISTE
 *
 * Chaque personnage est décrit au modèle par sa planche modèle, une image qui
 * le montre trois fois : de face, de profil, en mouvement. C'est une condition
 * du travail, la planche reste. Mais elle a un effet de bord mesurable à
 * l'usage : le modèle recopie parfois deux de ces vues dans la même scène, et
 * le personnage se retrouve dédoublé.
 *
 * Le prompt a été durci pour le limiter, il dit maintenant explicitement que la
 * planche montre une seule personne et que chaque personnage n'apparaît qu'une
 * fois. Rien ne garantit qu'il disparaisse pour autant. Plutôt que de laisser
 * découvrir le défaut sur une vignette ratée, on l'annonce, et on dit quoi
 * faire : relancer.
 *
 * `avecRelance` change la dernière phrase selon l'écran : avant la génération,
 * il n'y a encore rien à relancer.
 */
const AvertissementPlanche: React.FC<{ className?: string; avecRelance?: boolean }> = ({
  className = '',
  avecRelance = false,
}) => (
  <div
    className={`bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 flex items-start gap-3 ${className}`}
  >
    <i className="fas fa-clone text-amber-300 mt-0.5" aria-hidden="true"></i>
    <div className="flex flex-col gap-1 min-w-0">
      <p className="text-sm font-semibold text-amber-200">
        Un personnage peut apparaître en double
      </p>
      <p className="text-xs text-amber-100/80 leading-relaxed">
        Chaque personnage est présenté au modèle par sa planche à trois vues, de face, de profil
        et en mouvement. Il lui arrive d'en recopier deux dans la même image.{' '}
        {avecRelance
          ? 'Si vous voyez un personnage en double, relancez cette vignette : le tirage suivant est presque toujours correct.'
          : 'Si cela arrive, la vignette concernée pourra être relancée seule, sans refaire tout le storyboard.'}
      </p>
    </div>
  </div>
);

export default AvertissementPlanche;
