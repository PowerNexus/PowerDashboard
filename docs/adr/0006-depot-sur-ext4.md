# 0006 — Le dépôt vit sur ext4, pas sur `drvfs`

- **État** : acceptée
- **Date** : 2026-09
- **Références** : README « Dépendances », `CLAUDE.md` ; `apps/web/next.config.ts`

## Contexte

Le poste de développement est un WSL (Codiax) sous Windows. Le dépôt vivait
sur `/mnt/c`, c'est-à-dire sur le montage `drvfs`, qui **n'émet aucun
événement `inotify`**. Un fichier modifié depuis Windows change bien sur le
disque, mais le veilleur Linux ne l'apprend jamais.

Next 16 active Turbopack par défaut, et une configuration `webpack` résiduelle
fait échouer le build (d'où la section `turbopack` vide dans
`next.config.ts`, qui vaut adhésion explicite). Le contournement par scrutation
que webpack permettait n'existe donc plus.

Résultat : le rechargement à chaud cessait de fonctionner **sans rien
signaler**. L'erreur qu'on finissait par lire accusait le code, par exemple un
export pourtant bien présent, parce que le graphe de modules datait du
démarrage du serveur.

## Décision

**Le dépôt vit dans le système de fichiers de WSL**
(`/root/workspace/GameDashboard`, ext4), et toute exécution passe par
Codiax, jamais par le shell Windows.

## Options écartées

- **`watchOptions.pollIntervalMs`** : essayé et mesuré, sans effet sur le web.
  Ne pas le réintroduire.
- **Revenir à webpack** pour garder la scrutation : on irait contre le défaut
  de Next 16 pour compenser un problème de système de fichiers.

## Conséquences

- On édite depuis Windows par `\\wsl.localhost\Codiax\root\workspace\GameDashboard`
  ou par un éditeur connecté à WSL, jamais par une copie sous `C:`.
- Un symptôme du type « l'export existe mais le serveur de dev ne le voit
  pas » doit d'abord faire vérifier *où* vit le dépôt.
- Sans objet en CI et en session distante : elles tournent sur un Linux natif.
